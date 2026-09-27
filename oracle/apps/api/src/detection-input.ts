/**
 * What issue detection reads: a time window of readings, not the newest rows.
 *
 * Detection used to read the newest 1,000 rows of any category. While every
 * reading was stored every minute, that was 2-2.5 h of one-row-per-minute
 * series across 7-8 categories — the input the detectors and their thresholds
 * were tuned on. Since unchanged readings are no longer stored
 * (signal-dedupe.ts), the same 1,000 rows reach back 2-4.5 days of change
 * points (replayed on the 2026-09-26 snapshot), and three things went wrong at
 * once: a condition that holds without changing (production's medium_activity
 * = 0, "Low blog activity") fell out of the rows and its issue stopped being
 * re-seen while it was still true; a condition that had ended (a price alert)
 * kept being detected for days instead of ~2 h;
 * and z-scores and trend fits ran over change points, where one reading that
 * held for a day weighs the same as one that held for a minute.
 *
 * So the detectors get back the series they were built for:
 *
 * - A gauge (a level that holds until it changes) is rebuilt as a step
 *   function from its change points and sampled every collection interval
 *   across the window — the per-minute series the collector used to store.
 * - Anything else is an event, and goes in as stored. Resampling an event
 *   would repeat it once per sample: one price alert or one disclosure would
 *   become a series of repeats, the bug #37 removed at the source.
 *
 * Kept free of the database and of Express, like signal-dedupe.ts, so the rule
 * can be exercised directly. db.ts supplies the queries (detectionRowSource).
 */

/** A `signals` row as better-sqlite3 returns it. */
export interface StoredSignalRow {
  id: string;
  original_id: string;
  source: string;
  timestamp: string;
  category: string;
  severity: string;
  value: number;
  unit: string;
  description: string;
  metadata: string | null;
  synthetic: number;
  /** NULL on synthetic rows and on rows stored before change-only storage. */
  stream?: string | null;
}

interface Gauge {
  category: string;
  /** The adapter's `data.type`, which signalStream() appends to the category. */
  kind: string;
}

/**
 * Every reading that is a level, keyed as signalStream() keys it.
 *
 * An entry is here because its adapter emits it on every pass that reaches the
 * source, whatever the value — so an absent row since the last stored one
 * means "unchanged", not "nothing happened". Read from the adapters in
 * packages/reality-oracle/src/adapters/ as of #39:
 *
 *   MosslandAdapter  price, market_overview, blockchain_stats, disclosure_stats
 *                    (the running total; per-document events have had their
 *                    own category since #37), release_schedule
 *   GitHubAdapter    commit (the newest commit of each configured repo),
 *                    org_stats, activity_summary
 *   SocialAdapter    blog_activity (posts in the last week), twitter_profile,
 *                    twitter_engagement
 *   EtherscanAdapter gas_price
 *
 * Production stores the first seven (the 2026-09-26 snapshot, back to
 * 2026-06-17). The Twitter and Etherscan ones need credentials it does not
 * configure, and org_stats/activity_summary appear nowhere in that history;
 * they are listed because their adapters emit them the same way.
 *
 * Deliberately not here, so read as events:
 *
 *   mossland_disclosure_published, moc_price_alert, medium_post, twitter_tweet,
 *   github_release, moc_transfer, foundation_transfer, foundation_activity —
 *   one row per thing that happened.
 *   moc_tx_alert, github_push — emitted on every pass only while a condition
 *   holds (daily tx > 1000, a push in the last hour). Their silence is the
 *   condition ending, which change-only storage cannot tell from "unchanged",
 *   so carrying their last row forward would keep an ended alert alive.
 *   moc_transactions — dormant (see MosslandAdapter.fetchBlockchainStats).
 *
 * Anything not listed — a new adapter, an APIAdapter endpoint, a category
 * added later — is an event by default. Misreading a gauge as an event costs
 * what the detectors had before this module (its changes in the window);
 * misreading an event as a gauge invents repeats of it, which is worse.
 */
const GAUGES: readonly Gauge[] = [
  { category: "moc_price", kind: "price" },
  { category: "moc_market", kind: "market_overview" },
  { category: "moc_blockchain", kind: "blockchain_stats" },
  { category: "mossland_disclosure", kind: "disclosure_stats" },
  { category: "mossland_roadmap", kind: "release_schedule" },
  { category: "github_commit", kind: "commit" },
  { category: "medium_activity", kind: "blog_activity" },
  { category: "github_overview", kind: "org_stats" },
  { category: "github_activity", kind: "activity_summary" },
  { category: "twitter_profile", kind: "twitter_profile" },
  { category: "twitter_engagement", kind: "twitter_engagement" },
  { category: "network_gas", kind: "gas_price" },
];

/** Gauge stream key -> its category. */
export const GAUGE_STREAMS: ReadonlyMap<string, string> = new Map(
  GAUGES.map((g) => [`${g.category}|${g.kind}`, g.category]),
);

/** Gauge category -> the stream a row without one belongs to. */
const GAUGE_STREAM_OF_CATEGORY: ReadonlyMap<string, string> = new Map(
  GAUGES.map((g) => [g.category, `${g.category}|${g.kind}`]),
);

/**
 * The gauge stream a row belongs to, or null when it is an event or synthetic.
 *
 * Rows stored before change-only storage have no stream: the raw signal's
 * `data.type` it was derived from was never stored. Each gauge category above
 * receives exactly one kind of reading from its adapter, so such a row is
 * taken as the category's own stream. The one category that ever mixed two
 * kinds is mossland_disclosure, which also held per-document events (value 1)
 * until #37; the newest of those in the 2026-09-26 production snapshot is from
 * 2026-09-09, weeks outside any window this reads, so it is not special-cased.
 */
export function gaugeStreamOf(row: Pick<StoredSignalRow, "category" | "stream" | "synthetic">): string | null {
  if (row.synthetic) return null;
  if (row.stream) return GAUGE_STREAMS.has(row.stream) ? row.stream : null;
  return GAUGE_STREAM_OF_CATEGORY.get(row.category) ?? null;
}

/**
 * The time span one detection pass reads, as ISO strings so they compare with
 * stored timestamps as text.
 */
export interface DetectionWindow {
  /** The pass time minus the window length. */
  start: string;
  /** The pass time. Events and synthetic rows are read up to here. */
  end: string;
  /**
   * The last observation, capped at `end`. Gauges are sampled up to here and
   * no further: a stalled collector has not seen the level hold, so the
   * detectors must not be told it did. Null when nothing was ever observed.
   */
  sampleEnd: string | null;
  /** Sampling step. Null when collection is off: nothing is resampled. */
  stepMs: number | null;
  /** How far before `start` a pre-#39 row may still be in force; see readDetectionRows. */
  legacyLookbackMs: number;
}

export interface DetectionWindowOptions {
  now: Date;
  windowMinutes: number;
  /** SIGNAL_COLLECT_INTERVAL; 0 (or anything not a positive number) means off. */
  collectIntervalSeconds: number;
  /** When the collectors last observed the world, stored or not. */
  lastObservedAt: string | null;
}

export function detectionWindow(options: DetectionWindowOptions): DetectionWindow {
  const endMs = options.now.getTime();
  const lengthMs = options.windowMinutes * 60_000;
  const observedMs = options.lastObservedAt ? Date.parse(options.lastObservedAt) : Number.NaN;
  const interval = options.collectIntervalSeconds;
  return {
    start: new Date(endMs - lengthMs).toISOString(),
    end: new Date(endMs).toISOString(),
    sampleEnd: Number.isNaN(observedMs) ? null : new Date(Math.min(observedMs, endMs)).toISOString(),
    // Collection off (the e2e suite, a read-only replica): no cadence to
    // sample at and no collector vouching that a stored level still holds, so
    // every row goes in as stored — gauges included, and nothing carried in
    // from before the window.
    stepMs: Number.isFinite(interval) && interval > 0 ? interval * 1000 : null,
    legacyLookbackMs: lengthMs,
  };
}

/** The rows a window needs, as index.ts reads them. */
export interface DetectionRows {
  /** Every row, observed or synthetic, stamped in [start, end]. */
  inWindow: StoredSignalRow[];
  /** At most one per gauge stream: the row in force when the window opens. */
  carriedIn: StoredSignalRow[];
}

/** The three indexed reads behind a window. */
export interface DetectionRowSource {
  /** Every row stamped in [from, to]. */
  between(from: string, to: string): StoredSignalRow[];
  /** Newest row of a stream stamped before `before`. */
  latestInStream(stream: string, before: string): StoredSignalRow | undefined;
  /** Newest observed row with no stream, of a category, stamped in [from, before). */
  latestLegacy(category: string, from: string, before: string): StoredSignalRow | undefined;
}

/**
 * Read one window: a range read, plus one seek per gauge for the row in force
 * at its start — at most 1 + 2 × GAUGE_STREAMS.size indexed queries, however
 * large the table.
 *
 * The row carried in prefers the stream-tagged row. A row with no stream is
 * consulted only when the stream has no tagged row before the window — the
 * first window after upgrading to change-only storage — and only within one
 * window length before it: until then every observed reading was stored on
 * every pass, so a gauge that was still being observed has a legacy row that
 * recent, and an older one is a reading the collector had stopped making.
 */
export function readDetectionRows(source: DetectionRowSource, window: DetectionWindow): DetectionRows {
  const inWindow = source.between(window.start, window.end);
  const carriedIn: StoredSignalRow[] = [];
  if (window.stepMs === null || window.sampleEnd === null) return { inWindow, carriedIn };

  const legacyFrom = new Date(Date.parse(window.start) - window.legacyLookbackMs).toISOString();
  for (const [stream, category] of GAUGE_STREAMS) {
    const row =
      source.latestInStream(stream, window.start) ??
      source.latestLegacy(category, legacyFrom, window.start);
    if (row) carriedIn.push(row);
  }
  return { inWindow, carriedIn };
}

/**
 * The detector input for a window, as stored rows: events and synthetic rows
 * as they are, each gauge stream as one sample per step, newest first (the
 * order the old newest-1,000 read returned).
 *
 * A sample is the row in force at the sample time with the sample time as its
 * timestamp. It keeps the row's id and original id, so an issue's evidence
 * resolves to the stored reading; collapseRepeatedSignals then keeps one
 * reference per row.
 *
 * Samples are aligned on `sampleEnd` rather than on `start`, so the newest
 * sample is the newest observation whatever the window length. A stream whose
 * first row falls inside the window has no samples before it.
 */
export function buildDetectionInput(rows: DetectionRows, window: DetectionWindow): StoredSignalRow[] {
  const out: StoredSignalRow[] = [];
  const series = new Map<string, StoredSignalRow[]>();
  const resample = window.stepMs !== null;

  for (const row of rows.inWindow) {
    if (row.timestamp < window.start || row.timestamp > window.end) continue;
    const stream = resample ? gaugeStreamOf(row) : null;
    if (stream === null) {
      out.push(row);
      continue;
    }
    let list = series.get(stream);
    if (!list) series.set(stream, (list = []));
    list.push(row);
  }
  if (resample) {
    for (const row of rows.carriedIn) {
      const stream = gaugeStreamOf(row);
      if (stream === null || row.timestamp >= window.start) continue;
      let list = series.get(stream);
      if (!list) series.set(stream, (list = []));
      list.push(row);
    }
  }

  if (resample && window.sampleEnd !== null && series.size > 0) {
    const stepMs = window.stepMs!;
    const startMs = Date.parse(window.start);
    const times: number[] = [];
    for (let t = Date.parse(window.sampleEnd); t >= startMs; t -= stepMs) times.push(t);
    times.reverse();

    for (const list of series.values()) {
      // Oldest first; at the same instant a tagged row wins over a legacy one,
      // being the later-written of the two.
      list.sort(
        (a, b) =>
          (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0) ||
          Number(Boolean(a.stream)) - Number(Boolean(b.stream)),
      );
      let next = 0;
      let inForce: StoredSignalRow | undefined;
      for (const t of times) {
        const at = new Date(t).toISOString();
        while (next < list.length && list[next].timestamp <= at) inForce = list[next++];
        if (inForce) out.push({ ...inForce, timestamp: at });
      }
    }
  }

  return out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}

interface IssueWithSignals {
  signals?: { id: string }[];
  evidence?: { data?: unknown }[];
}

/**
 * One reference per stored row in a detected issue.
 *
 * A gauge that held for the whole window is ~120 samples of one row, and the
 * detectors hand every sample back — as the issue's signals, which become
 * `signal_ids` and what GET /api/issues embeds, and as one anomaly evidence
 * entry per sample. Repeating the id says nothing the first reference does
 * not. The counts the detectors computed (triggeredCount, anomalyCount,
 * totalSamples, dataPoints) stay as they are: they describe the series.
 */
export function collapseRepeatedSignals<T extends IssueWithSignals>(issue: T): T {
  const seen = new Set<string>();
  const signals = issue.signals?.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const cited = new Set<string>();
  const evidence = issue.evidence?.filter((e) => {
    const id = (e.data as { signalId?: unknown } | undefined)?.signalId;
    if (typeof id !== "string") return true;
    if (cited.has(id)) return false;
    cited.add(id);
    return true;
  });
  return {
    ...issue,
    ...(signals ? { signals } : {}),
    ...(evidence ? { evidence } : {}),
  };
}
