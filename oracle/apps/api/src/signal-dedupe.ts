/**
 * Store an observed signal only when the reading changed.
 *
 * The collectors poll every minute and emit a reading whether or not the world
 * moved. On the 2026-09-26 production copy, 7 days of observed signals were
 * 67,003 rows of which 2,413 differed from the previous row of the same
 * stream: github_commit, mossland_disclosure, mossland_roadmap and
 * medium_activity each held one value for the whole week. The rest was the
 * previous minute written again — ~9.5k rows a day into a table that, with
 * its indexes, was 96% of a 501 MB file, and a /signals page that showed
 * seven identical messages ~71 times.
 *
 * Kept free of the database and of Express, like health.ts, so the rule can be
 * exercised directly. index.ts owns the reads and writes.
 */

/** The fields that make one reading different from the previous one. */
export interface Reading {
  value: number;
  description: string;
  severity: string;
}

/** Newest stored reading of a stream, as the boot seed reads it back. */
export interface StreamSeed extends Reading {
  stream: string;
}

/** The part of a collected signal this module looks at. */
export interface CollectedSignal extends Reading {
  category: string;
  timestamp: Date | string;
  synthetic?: boolean;
}

/**
 * Identity of one series of readings: the category, plus the collector's own
 * name for the kind of reading when it has one.
 *
 * The category alone is not enough. MosslandAdapter emits a per-document "new
 * disclosure" event (value 1) and the disclosure total (value ~53) into the
 * same category, so comparing each reading with the previous row of its
 * category would see them alternate and store both every minute. The raw
 * signal's `data.type` ("disclosure" / "disclosure_stats") is what the adapter
 * itself switches on to build them, so it separates them without this module
 * knowing any adapter; APIAdapter names its endpoints in `data._endpoint`
 * instead. When the collectors later give such readings their own categories,
 * the key still holds — it only gains a redundant half.
 *
 * Neither the description nor the severity is part of the key: both change
 * with the reading itself (moc_price moves between low/medium/high with the
 * 24 h change), and keying on them would compare a reading with a stale row of
 * the same band instead of with the one before it.
 */
export function signalStream(
  category: string,
  raw?: { data?: Record<string, unknown> } | null,
): string {
  const data = raw?.data;
  const kind =
    typeof data?.type === "string"
      ? data.type
      : typeof data?._endpoint === "string"
        ? data._endpoint
        : "";
  return kind ? `${category}|${kind}` : category;
}

export function sameReading(a: Reading, b: Reading): boolean {
  return a.value === b.value && a.description === b.description && a.severity === b.severity;
}

function isoOf(at: Date | string): string | null {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The later of two ISO timestamps; null only when neither is readable. */
export function laterTimestamp(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : new Date(tb).toISOString();
  if (Number.isNaN(tb)) return new Date(ta).toISOString();
  return new Date(Math.max(ta, tb)).toISOString();
}

/** What one collection pass should write, decided before anything is written. */
export interface SignalWritePlan<T extends CollectedSignal> {
  /** Rows to insert. `stream` is null for synthetic signals, which are not deduplicated. */
  writes: { signal: T; stream: string | null }[];
  /** Observed readings stored because they changed (or their stream was new). */
  stored: number;
  /** Observed readings identical to the last stored row of their stream. */
  skipped: number;
  /** Synthetic readings, stored as before. */
  synthetic: number;
  /** Newest observed reading in the pass, stored or skipped. */
  observedAt: string | null;
  /**
   * What to persist as the last observation, in the same transaction as
   * `writes`: the filter's freshness as it will be once this pass commits.
   * Null when the pass observed nothing, which must not look like freshness.
   */
  lastObservedAt: string | null;
  updates: Map<string, Reading>;
}

/**
 * The last stored reading per stream, and when the world was last observed.
 *
 * `plan` decides and `commit` remembers, in two steps, so a pass whose write
 * fails leaves no trace: its readings are compared again on the next pass
 * instead of being taken as stored, and it does not count as an observation.
 */
export class SignalChangeFilter {
  private readonly last = new Map<string, Reading>();
  private observedAt: string | null;

  constructor(seed: Iterable<StreamSeed>, lastObservedAt: string | null) {
    for (const row of seed) {
      this.last.set(row.stream, {
        value: row.value,
        description: row.description,
        severity: row.severity,
      });
    }
    this.observedAt = laterTimestamp(lastObservedAt, null);
  }

  get streamCount(): number {
    return this.last.size;
  }

  /**
   * When an observed reading last arrived, whether or not it was stored. This
   * is what /api/health means by lastObservedSignalAt once unchanged readings
   * stop producing rows: "the collectors saw the world at this time".
   */
  get lastObservedAt(): string | null {
    return this.observedAt;
  }

  plan<T extends CollectedSignal>(
    signals: readonly T[],
    streamOf: (signal: T) => string,
  ): SignalWritePlan<T> {
    const updates = new Map<string, Reading>();
    const writes: SignalWritePlan<T>["writes"] = [];
    let stored = 0;
    let skipped = 0;
    let synthetic = 0;
    let observedAt: string | null = null;

    for (const signal of signals) {
      if (signal.synthetic) {
        // The demo adapter keeps its path: every value stored, none of it
        // counted as an observation.
        writes.push({ signal, stream: null });
        synthetic++;
        continue;
      }

      observedAt = laterTimestamp(observedAt, isoOf(signal.timestamp));
      const stream = streamOf(signal);
      const reading: Reading = {
        value: signal.value,
        description: signal.description,
        severity: signal.severity,
      };
      // Compare with this pass's own earlier reading first, so a stream that
      // emits twice in one pass is judged against what is about to be stored.
      const previous = updates.get(stream) ?? this.last.get(stream);
      if (previous && sameReading(previous, reading)) {
        skipped++;
        continue;
      }
      writes.push({ signal, stream });
      updates.set(stream, reading);
      stored++;
    }

    const lastObservedAt = observedAt ? laterTimestamp(this.observedAt, observedAt) : null;
    return { writes, stored, skipped, synthetic, observedAt, lastObservedAt, updates };
  }

  /** Call once the plan's writes are committed. */
  commit(plan: SignalWritePlan<CollectedSignal>): void {
    for (const [stream, reading] of plan.updates) this.last.set(stream, reading);
    this.observedAt = laterTimestamp(this.observedAt, plan.observedAt);
  }
}
