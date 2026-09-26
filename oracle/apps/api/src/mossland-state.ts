/**
 * Seed the Mossland collector with what earlier runs already reported.
 *
 * The adapter kept "which disclosure did I last announce" in memory, so every
 * deploy or restart announced the newest disclosure again, and those repeats
 * fed the anomaly detector that opened 18 of BRIDGE's 21 real proposals. The
 * stored signals are the only record that survives a restart, so the state is
 * read back from them. Takes the database as a parameter so tests can hand it
 * a throwaway one.
 */

import type { Database as SqliteDatabase } from "better-sqlite3";
import {
  MosslandAdapter,
  DISCLOSURE_EVENT_CATEGORY,
  DISCLOSURE_TOTAL_CATEGORY,
  type MosslandAdapterState,
  type StoredMosslandSignal,
} from "@oracle/reality-oracle";

export function loadMosslandAdapterState(db: SqliteDatabase): MosslandAdapterState {
  try {
    // Two selects rather than one OR so each uses idx_signals_category. The
    // legacy branch scans the total's rows (~143k in production) for the few
    // value = 1 announcements written before events had their own category;
    // DISTINCT because each was repeated on every restart.
    const rows = db
      .prepare(
        `SELECT category, value, description, metadata
           FROM signals WHERE category = @event
         UNION ALL
         SELECT DISTINCT category, value, description, NULL
           FROM signals WHERE category = @total AND value = 1`,
      )
      .all({
        event: DISCLOSURE_EVENT_CATEGORY,
        total: DISCLOSURE_TOTAL_CATEGORY,
      }) as StoredMosslandSignal[];
    return MosslandAdapter.stateFromStoredSignals(rows);
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
