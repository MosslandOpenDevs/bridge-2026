/**
 * The verdict behind GET /api/health, kept free of the database and of Express
 * so the rule can be exercised directly — a staleness threshold that is only
 * testable by waiting three minutes is a threshold nobody tests.
 *
 * Contract: links.moss.land HEALTH_CONTRACT.md v1. `status` is one of
 * ok | degraded | down, and rule 7 asks for "what you can prove": this process
 * can prove it reads its database, and — when collection is on — that an
 * observed signal landed recently. It cannot prove anything about freshness
 * when collection is switched off, so it does not pretend to.
 */

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthConfig {
  /** Collection runs on a timer only when SIGNAL_COLLECT_INTERVAL > 0. */
  collecting: boolean;
  /** Seconds between collection ticks; null when collection is off. */
  intervalSeconds: number | null;
  /** Age after which the newest observed signal counts as stale; null when collection is off. */
  staleAfterSeconds: number | null;
}

export interface HealthVerdict {
  status: HealthStatus;
  /** Newest observed (non-synthetic) signal, ISO 8601. null is "unknown", never "just now". */
  lastObservedSignalAt: string | null;
  /** Why the status is not "ok"; null when it is. Human-readable, not an API. */
  reason: string | null;
}

/**
 * Floor for the default threshold. Three missed ticks at the shipped 60 s
 * interval; it also keeps a short dev interval (say 5 s) from flapping to
 * degraded whenever one slow upstream holds a tick up for a few seconds.
 */
export const MIN_STALE_AFTER_SECONDS = 180;

/**
 * Resolve the freshness expectation from the same inputs the scheduler uses.
 *
 * `collectInterval` is SIGNAL_COLLECT_INTERVAL exactly as index.ts parsed it,
 * and "collecting" means exactly what the scheduler means by it (> 0; NaN and
 * negatives start no timer). Deriving it here separately would let the two
 * disagree, and a health check that disagrees with the scheduler about whether
 * the scheduler is running reports fiction.
 *
 * The default threshold is max(180 s, 3 × interval): one missed tick is noise
 * (an upstream timing out, a tick skipped because the previous one is still in
 * flight), three in a row is an outage. `staleAfterOverride` is
 * HEALTH_STALE_AFTER_SECONDS; anything that is not a positive number falls
 * back to the default rather than disabling the check.
 */
export function resolveHealthConfig(
  collectInterval: number,
  staleAfterOverride?: string,
): HealthConfig & { overrideRejected: boolean } {
  if (!(collectInterval > 0)) {
    return {
      collecting: false,
      intervalSeconds: null,
      staleAfterSeconds: null,
      overrideRejected: false,
    };
  }

  const fallback = Math.max(MIN_STALE_AFTER_SECONDS, 3 * collectInterval);
  const raw = staleAfterOverride?.trim();
  if (!raw) {
    return {
      collecting: true,
      intervalSeconds: collectInterval,
      staleAfterSeconds: fallback,
      overrideRejected: false,
    };
  }
  const parsed = Number(raw);
  const valid = Number.isFinite(parsed) && parsed > 0;
  return {
    collecting: true,
    intervalSeconds: collectInterval,
    staleAfterSeconds: valid ? parsed : fallback,
    overrideRejected: !valid,
  };
}

/**
 * Decide the status from one database read.
 *
 * `readLatestObserved` returns the stored timestamp of the newest observed
 * signal (or null/undefined when there is none) and throws when the database
 * cannot be read at all. A throw is "down": every other endpoint answers from
 * the same database, so a process that cannot read it cannot do its job.
 */
export function deriveHealth(
  readLatestObserved: () => string | null | undefined,
  config: HealthConfig,
  now: Date,
): HealthVerdict {
  let stored: string | null | undefined;
  try {
    stored = readLatestObserved();
  } catch {
    // The error itself goes to the server log, not the public body.
    return { status: "down", lastObservedSignalAt: null, reason: "database read failed" };
  }

  // Drop an unparseable value instead of emitting "Invalid Date": an
  // unreadable time is an unknown time.
  const at = stored ? new Date(stored) : null;
  const valid = at && !Number.isNaN(at.getTime()) ? at : null;
  const lastObservedSignalAt = valid ? valid.toISOString() : null;

  // Collection is off on purpose (tests, a read-only replica, a demo box).
  // An old or missing signal is then expected, not a fault, and calling it
  // degraded would make the one state an operator chose look like a failure.
  if (!config.collecting || config.staleAfterSeconds === null) {
    return { status: "ok", lastObservedSignalAt, reason: null };
  }

  if (!valid) {
    // Also what a fresh deploy says until its first collection lands. That is
    // why degraded must stay HTTP 200 even under ?strict=1: the deploy gate
    // polls right after a restart, and rolling back for a tick that has not
    // happened yet would roll back every deploy.
    return {
      status: "degraded",
      lastObservedSignalAt: null,
      reason: "no observed signal recorded",
    };
  }

  // A timestamp in the future (clock skew between adapters) reads as fresh:
  // negative age says nothing about the pipeline being stalled.
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - valid.getTime()) / 1000));
  if (ageSeconds > config.staleAfterSeconds) {
    return {
      status: "degraded",
      lastObservedSignalAt,
      reason: `newest observed signal is ${ageSeconds}s old; stale after ${config.staleAfterSeconds}s`,
    };
  }

  return { status: "ok", lastObservedSignalAt, reason: null };
}
