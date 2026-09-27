/**
 * Seed the Mossland collector with what earlier runs already reported.
 *
 * The adapter kept "which disclosure did I last announce" in memory, so every
 * deploy or restart announced the newest disclosure again, and those repeats
 * fed the anomaly detector that opened 18 of BRIDGE's 21 real proposals; the
 * day's price alert had the same problem. The stored signals are the only
 * record that survives a restart, so the state is read back from them. Takes
 * the database as a parameter so tests can hand it a throwaway one.
 */

import type { Database as SqliteDatabase } from "better-sqlite3";
import {
  MosslandAdapter,
  DISCLOSURE_EVENT_CATEGORY,
  DISCLOSURE_TOTAL_CATEGORY,
  PRICE_ALERT_CATEGORY,
  type MosslandAdapterState,
  type StoredMosslandSignal,
} from "@oracle/reality-oracle";

/** Price alerts older than this cannot share a trading day with today. */
const PRICE_ALERT_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

function hasKey(metadata: StoredMosslandSignal["metadata"]): boolean {
  if (!metadata) return false;
  try {
    const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    return typeof parsed?.key === "string" && parsed.key.length > 0;
  } catch {
    return false;
  }
}

export function loadMosslandAdapterState(
  db: SqliteDatabase,
  now: Date = new Date(),
): MosslandAdapterState {
  try {
    // Separate selects rather than one OR so each uses idx_signals_category.
    const events = db
      .prepare(
        `SELECT category, value, description, metadata
           FROM signals WHERE category = ?`,
      )
      .all(DISCLOSURE_EVENT_CATEGORY) as StoredMosslandSignal[];
    const alerts = db
      .prepare(
        `SELECT category, value, description, metadata
           FROM signals
          WHERE category = ? AND timestamp >= ? AND metadata IS NOT NULL`,
      )
      .all(
        PRICE_ALERT_CATEGORY,
        new Date(now.getTime() - PRICE_ALERT_LOOKBACK_MS).toISOString(),
      ) as StoredMosslandSignal[];

    // Transition only: before events had their own category they were value = 1
    // rows among the total's, and finding them walks every gauge row (value is
    // not indexed; ~143k rows now, one more a minute). Once a keyed event is
    // stored it is newer than all of them, and the adapter only needs the
    // newest known document to tell new from old, so the scan is skipped.
    // DISTINCT because each legacy announcement was repeated on every restart.
    const legacy = events.some((row) => hasKey(row.metadata))
      ? []
      : (db
          .prepare(
            `SELECT DISTINCT category, value, description, NULL AS metadata
               FROM signals WHERE category = ? AND value = 1`,
          )
          .all(DISCLOSURE_TOTAL_CATEGORY) as StoredMosslandSignal[]);

    return MosslandAdapter.stateFromStoredSignals([...events, ...legacy, ...alerts]);
  } catch (error) {
    // Starting without state costs at most one missed announcement (the
    // adapter takes an unrecognised list as its baseline); refusing to start
    // over it would cost all collection.
    console.error(
      "⚠️  Could not read Mossland collector state; starting without it:",
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}
