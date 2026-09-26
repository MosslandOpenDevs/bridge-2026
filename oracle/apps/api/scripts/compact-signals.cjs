#!/usr/bin/env node
// Opt-in compaction of the legacy duplicate rows in the `signals` table.
//
// Usage (from oracle/, with oracle-api STOPPED -- see below):
//
//   node apps/api/scripts/compact-signals.cjs <oracle.db>            # dry run
//   node apps/api/scripts/compact-signals.cjs <oracle.db> --apply \
//        --snapshot-verified apps/api/data/backup/<snapshot>.db \
//        --i-stopped-the-api \
//        [--export-synthetic <file.jsonl.gz>] [--drop-unused-index] [--vacuum]
//        [--keep-recent-days <n>]   # default 7
//
// Nothing runs this automatically -- not deploy.sh, not the API, not a cron.
// Removing history is a governance decision (MIP-1), so it is an operator's
// deliberate act with a written policy: oracle/deploy/README.md, "Data
// retention & compaction".
//
// WHY. The collectors write one row per category per minute whether or not
// anything changed. On the 2026-09-26 production snapshot ~99% of the 880k
// observed rows repeat the previous minute (github_commit, mossland_disclosure
// and mossland_roadmap have ONE distinct value in 7 days), signals plus their
// indexes are 96% of the file, and the file grows ~7.5 MB/day. The repeats
// carry no information a change point does not, but every full-table read and
// every backup pays for them.
//
// WHAT IS KEPT, per observed category, walking rows in (timestamp, id) order:
//
//   - change points: a row whose (value, description, severity) differs from
//     the row immediately before it. The series stays a faithful step
//     function -- a value holds until the next kept row says otherwise.
//   - the first and last row of each UTC day, so the daily cadence ("the
//     collector was alive on this day, from .. to ..") stays visible even for
//     a category that never changes.
//   - every row referenced from any other table. Issues point at their
//     evidence through issues.signal_ids and /api/issues embeds it by looking
//     each id up (populateIssueSignals in src/index.ts); anomaly evidence and
//     proposal decision packets carry signal ids too, and packets carry
//     original_id as well. Rather than trust a hand-written list of columns,
//     every TEXT value in every other table is scanned for UUIDs, and
//     issues.signal_ids is additionally parsed as JSON so a non-UUID id there
//     is still honoured. A row whose id OR original_id appears is kept.
//   - everything newer than --keep-recent-days (default 7) before the newest
//     observed row. Issue detection reads the newest 1000 rows
//     (detectAndSaveIssues) and /api/signals serves the newest N; keeping the
//     recent window verbatim means compaction cannot change what the running
//     detector or the monitors see. Measured from the newest row rather than
//     the clock so a run against an older snapshot behaves like production.
//   - any row whose timestamp does not parse (never guessed about).
//
// Everything else in an observed category is deleted, one transaction per
// category, so an interrupted run leaves whole categories done or untouched.
//
// SYNTHETIC ROWS (the demo adapter's, synthetic = 1) are left alone unless
// --export-synthetic <file.jsonl.gz> is given. Then every synthetic row is
// first streamed to that file (one JSON object per line, columns verbatim,
// gzip), the file is read back and its line count checked, and only then are
// they deleted -- except those an issue still references, which stay for the
// same reason as above: no issue loses its evidence, synthetic or not.
//
// --drop-unused-index drops idx_signals_severity: no query in apps/ or
// packages/ filters, orders or groups signals by severity in SQL (severity is
// only compared in JS after the rows are loaded), and it was 13.5 MB on the
// snapshot. NOTE: src/db.ts still has CREATE INDEX IF NOT EXISTS for it, so
// the API rebuilds it at the next boot until that line is removed; after
// compaction the rebuild is small and quick.
//
// --vacuum finishes with VACUUM. Deleting rows only moves pages to the
// freelist; the file shrinks only when it is rebuilt. VACUUM needs exclusive
// access to the database and temporary disk space about the size of the
// result.
//
// SAFETY GATES for --apply:
//
//   --snapshot-verified <path>  a snapshot file of this database, modified in
//                               the last 24h, that is not this file, whose
//                               PRAGMA quick_check says ok, AND that holds the
//                               database's current state: signal row count,
//                               newest signal timestamp, issue count and newest
//                               issues.updated_at must equal the live file's
//                               (all checked here, not taken on trust). It is
//                               the restore path, and restoring an older copy
//                               would lose everything written after it -- a
//                               pre-deploy-*.db from hours ago, or an old
//                               snapshot whose mtime a cp/scp refreshed, passes
//                               the age check but not this one. Since the API
//                               is stopped for --apply, a snapshot taken after
//                               the stop always matches.
//   --i-stopped-the-api         the operator's statement that oracle-api is
//                               stopped. VACUUM and a long delete need the
//                               database to themselves; a live API would keep
//                               writing (and blocking) mid-run. The procedure is
//                               stop oracle-api -> snapshot -> run -> start it.
//                               When `lsof` is available the claim is also
//                               checked, and a run is refused while any other
//                               process holds the file.
//
// The dry run needs neither: it opens the database read-only and changes
// nothing, so it is safe to run against the live file to size the job.
//
// CommonJS and better-sqlite3 only, like db-snapshot.cjs: apps/api is
// "type": "module", and this has to run from source with no build step.

"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = DAY_MS;
const UNUSED_INDEX = "idx_signals_severity";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    "usage: compact-signals.cjs <db> [--apply --snapshot-verified <snapshot.db> --i-stopped-the-api]\n" +
      "                                [--export-synthetic <file.jsonl.gz>] [--drop-unused-index] [--vacuum]\n" +
      "                                [--keep-recent-days <n>]\n" +
      "Dry run unless --apply. Read the header of this file before using --apply.",
  );
  process.exit(64);
}

function parseArgs(argv) {
  const opts = {
    db: null,
    apply: false,
    snapshot: null,
    apiStopped: false,
    exportSynthetic: null,
    dropIndex: false,
    vacuum: false,
    keepRecentDays: 7,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) usage(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--apply": opts.apply = true; break;
      case "--snapshot-verified": opts.snapshot = value(); break;
      case "--i-stopped-the-api": opts.apiStopped = true; break;
      case "--export-synthetic": opts.exportSynthetic = value(); break;
      case "--drop-unused-index": opts.dropIndex = true; break;
      case "--vacuum": opts.vacuum = true; break;
      case "--keep-recent-days": {
        const n = Number(value());
        if (!Number.isFinite(n) || n < 1) usage("--keep-recent-days must be a number >= 1");
        opts.keepRecentDays = n;
        break;
      }
      case "-h":
      case "--help": usage();
      // falls through (usage exits)
      default:
        if (arg.startsWith("--")) usage(`unknown option ${arg}`);
        if (opts.db) usage("only one database path");
        opts.db = arg;
    }
  }
  if (!opts.db) usage("database path required");
  return opts;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function fileBytes(p) {
  let total = 0;
  for (const f of [p, `${p}-wal`]) {
    try { total += fs.statSync(f).size; } catch { /* absent */ }
  }
  return total;
}

function fail(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

/** The snapshot is the restore path, so it is checked rather than trusted. */
function verifySnapshot(snapshotPath, dbPath) {
  let stat;
  try { stat = fs.statSync(snapshotPath); } catch { fail(`snapshot ${snapshotPath} does not exist`); }
  if (!stat.isFile()) fail(`snapshot ${snapshotPath} is not a file`);
  if (fs.realpathSync(snapshotPath) === fs.realpathSync(dbPath)) {
    fail("--snapshot-verified points at the database being compacted");
  }
  const age = Date.now() - stat.mtimeMs;
  if (age > SNAPSHOT_MAX_AGE_MS) {
    fail(`snapshot is ${(age / 3600000).toFixed(1)}h old; take a fresh one (limit 24h)`);
  }
  const snap = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const t0 = Date.now();
    const result = snap.pragma("quick_check").map((r) => r.quick_check);
    if (result.length !== 1 || result[0] !== "ok") {
      const lines = result.join("\n").split("\n");
      fail(`snapshot quick_check failed (${lines.length} lines): ${lines.slice(0, 3).join(" | ")}`);
    }
    const snapState = currentState(snap);
    const live = new Database(dbPath, { readonly: true, fileMustExist: true });
    let liveState;
    try { liveState = currentState(live); } finally { live.close(); }
    const diff = Object.keys(liveState).filter((k) => snapState[k] !== liveState[k]);
    if (diff.length > 0) {
      fail(
        `snapshot is not of the current state of ${dbPath}; take a fresh one after stopping oracle-api ` +
          `(${diff.map((k) => `${k}: snapshot ${snapState[k]}, live ${liveState[k]}`).join("; ")})`,
      );
    }
    console.log(
      `snapshot ok: ${snapshotPath} (${mb(stat.size)}, ${(age / 3600000).toFixed(1)}h old, ` +
        `quick_check ok, matches the live file: ${snapState.signals} signals up to ${snapState.newestSignal}, ` +
        `${snapState.issues} issues; ${secs(Date.now() - t0)})`,
    );
  } catch (error) {
    fail(`snapshot ${snapshotPath} could not be read as a BRIDGE database: ${error.message}`);
  } finally {
    snap.close();
  }
}

/**
 * Cheap summary of what the collectors and the governance loop have written.
 * Every write path moves at least one of these, so a snapshot that matches
 * the (stopped) live file on all of them holds its current state. rowid is
 * deliberately not used: VACUUM INTO may renumber it.
 */
function currentState(db) {
  const one = (sql) => db.prepare(sql).pluck().get();
  return {
    signals: one("SELECT COUNT(*) FROM signals"),
    newestSignal: one("SELECT MAX(timestamp) FROM signals"),
    issues: one("SELECT COUNT(*) FROM issues"),
    newestIssueUpdate: one("SELECT MAX(updated_at) FROM issues"),
  };
}

/** Best-effort check behind --i-stopped-the-api: who else has the file open. */
function checkNoOtherHolder(dbPath) {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((f) => fs.existsSync(f));
  const r = spawnSync("lsof", ["-t", "--", ...files], { encoding: "utf8" });
  if (r.error) {
    console.log("note: lsof not available; relying on --i-stopped-the-api alone");
    return;
  }
  const pids = r.stdout.split(/\s+/).filter((p) => p && Number(p) !== process.pid);
  if (pids.length > 0) {
    fail(`database is held open by pid(s) ${pids.join(", ")} -- stop oracle-api (and bridge-deploy) first`);
  }
}

/**
 * Every signal id (or original_id) any other table mentions. Scans all TEXT
 * values of all other tables so a reference added later in some new column
 * is still honoured; issues.signal_ids is parsed exactly as well.
 */
function collectReferences(db) {
  const refs = new Set();
  const perColumn = new Map(); // "table.column" -> tokens found there
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name <> 'signals' AND name NOT LIKE 'sqlite_%'`,
    )
    .pluck()
    .all();
  for (const table of tables) {
    const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).pluck().all(table);
    for (const col of cols) {
      const q = `"${col.replace(/"/g, '""')}"`;
      const t = `"${table.replace(/"/g, '""')}"`;
      const found = new Set();
      const stmt = db.prepare(`SELECT ${q} FROM ${t} WHERE typeof(${q}) = 'text'`).pluck();
      for (const value of stmt.iterate()) {
        for (const m of value.match(UUID_RE) || []) found.add(m.toLowerCase());
        if (table === "issues" && col === "signal_ids") {
          try {
            const ids = JSON.parse(value);
            if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") found.add(id);
          } catch { /* the regex pass above still covers it */ }
        }
      }
      for (const token of found) refs.add(token);
      if (found.size > 0) perColumn.set(`${table}.${col}`, found);
    }
  }
  return { refs, perColumn };
}

function isReferenced(refs, row) {
  return refs.has(row.id) || refs.has(String(row.id).toLowerCase()) ||
    refs.has(row.original_id) || refs.has(String(row.original_id).toLowerCase());
}

/** Tokens in `refs` that resolve to a signal row -- the invariant to preserve. */
function resolvedReferences(db, refs) {
  const resolved = new Set();
  const stmt = db.prepare(`SELECT id, original_id FROM signals`);
  for (const row of stmt.iterate()) {
    for (const v of [row.id, row.original_id]) {
      if (refs.has(v)) resolved.add(v);
      const lower = String(v).toLowerCase();
      if (refs.has(lower)) resolved.add(lower);
    }
  }
  return resolved;
}

/**
 * Walk one observed category in (timestamp, id) order and decide each row.
 * A row's "last of its UTC day" status is only known once the next row is
 * seen, so decisions lag by one row.
 */
function planObservedCategory(db, category, refs, cutoffMs) {
  const stmt = db.prepare(
    `SELECT rowid AS rid, id, original_id, timestamp, severity, value, description
       FROM signals
      WHERE synthetic = 0 AND category = ?
      ORDER BY timestamp, id`,
  );
  const stat = { rows: 0, keep: 0, del: 0, change: 0, dayEdge: 0, referenced: 0, recent: 0 };
  const doomed = [];
  let prev = null;

  // Keep reasons are counted per row when the row is settled, so a row that
  // is both the first and the last of its day counts once as a day edge.
  const settle = (p) => {
    if (p.dayEdge) stat.dayEdge++;
    if (p.keep) stat.keep++;
    else { stat.del++; doomed.push(p.rid); }
  };

  for (const row of stmt.iterate(category)) {
    stat.rows++;
    const ms = Date.parse(row.timestamp);
    const day = Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
    const cur = { rid: row.rid, day, keep: false, dayEdge: false };

    const changed =
      !prev ||
      row.value !== prev.value ||
      row.description !== prev.description ||
      row.severity !== prev.severity;
    const dayFirst = !prev || day !== prev.day;
    const referenced = isReferenced(refs, row);
    const recent = Number.isNaN(ms) || ms >= cutoffMs;

    if (changed) stat.change++;
    if (referenced) stat.referenced++;
    if (recent) stat.recent++;
    cur.dayEdge = dayFirst;
    cur.keep = changed || dayFirst || referenced || recent || day === null;

    if (prev) {
      if (dayFirst) {
        prev.keep = true; // last row of the previous UTC day
        prev.dayEdge = true;
      }
      settle(prev);
    }
    prev = Object.assign(cur, {
      value: row.value,
      description: row.description,
      severity: row.severity,
    });
  }
  if (prev) {
    prev.keep = true; // last row of the last day
    prev.dayEdge = true;
    settle(prev);
  }
  return { stat, doomed };
}

function planSynthetic(db, category, refs) {
  const stmt = db.prepare(
    `SELECT rowid AS rid, id, original_id FROM signals WHERE synthetic = 1 AND category = ?`,
  );
  const stat = { rows: 0, keep: 0, del: 0, referenced: 0 };
  const doomed = [];
  for (const row of stmt.iterate(category)) {
    stat.rows++;
    if (isReferenced(refs, row)) { stat.referenced++; stat.keep++; }
    else { stat.del++; doomed.push(row.rid); }
  }
  return { stat, doomed };
}

function deleteRowids(db, rowids) {
  const del = db.prepare(`DELETE FROM signals WHERE rowid = ?`);
  db.transaction(() => {
    for (const rid of rowids) del.run(rid);
  })();
}

/** Stream every synthetic row to gzip JSONL, then read it back and count. */
async function exportSynthetic(db, file) {
  const out = fs.createWriteStream(file, { flags: "wx" });
  const gzip = zlib.createGzip();
  gzip.pipe(out);
  let written = 0;
  for (const row of db.prepare(`SELECT * FROM signals WHERE synthetic = 1`).iterate()) {
    if (!gzip.write(`${JSON.stringify(row)}\n`)) {
      await new Promise((resolve) => gzip.once("drain", resolve));
    }
    written++;
  }
  gzip.end();
  await new Promise((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
    gzip.on("error", reject);
  });

  let readBack = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) readBack++;
  if (readBack !== written) {
    fail(`export read back ${readBack} lines but wrote ${written}; nothing synthetic was deleted`);
  }
  return { written, bytes: fs.statSync(file).size };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dbPath = opts.db;
  if (!fs.existsSync(dbPath)) fail(`${dbPath} does not exist`);

  const modifying = opts.exportSynthetic || opts.dropIndex || opts.vacuum;
  if (modifying && !opts.apply) {
    console.log("note: --export-synthetic/--drop-unused-index/--vacuum only take effect with --apply\n");
  }

  if (opts.apply) {
    if (!opts.snapshot) fail("--apply needs --snapshot-verified <snapshot.db> (see the header)");
    if (!opts.apiStopped) {
      fail("--apply needs --i-stopped-the-api: stop oracle-api first; VACUUM and the deletes need the database to themselves");
    }
    if (opts.exportSynthetic && fs.existsSync(opts.exportSynthetic)) {
      fail(`${opts.exportSynthetic} already exists; refusing to overwrite an export`);
    }
    verifySnapshot(opts.snapshot, dbPath);
    checkNoOtherHolder(dbPath);
  }

  const started = Date.now();
  const sizeBefore = fileBytes(dbPath);
  const db = new Database(dbPath, { readonly: !opts.apply, fileMustExist: true });
  db.pragma("busy_timeout = 0");

  const hasSignals = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'signals'`)
    .get();
  if (!hasSignals) fail(`${dbPath} has no signals table`);

  // ---- plan -------------------------------------------------------------
  let t = Date.now();
  const { refs, perColumn } = collectReferences(db);
  const resolvedBefore = resolvedReferences(db, refs);
  const sources = [...perColumn]
    .map(([column, tokens]) => [column, [...tokens].filter((x) => resolvedBefore.has(x)).length])
    .filter(([, n]) => n > 0)
    .map(([column, n]) => `${column} ${n}`);
  console.log(
    `references: ${resolvedBefore.size} distinct signal ids/original_ids referenced ` +
      `(${sources.join(", ") || "none"}; ${secs(Date.now() - t)})`,
  );

  const newest = db
    .prepare(`SELECT MAX(timestamp) FROM signals WHERE synthetic = 0`)
    .pluck()
    .get();
  const newestMs = newest ? Date.parse(newest) : Date.now();
  const cutoffMs = newestMs - opts.keepRecentDays * DAY_MS;
  console.log(
    `newest observed row ${newest}; rows at or after ${new Date(cutoffMs).toISOString()} ` +
      `(${opts.keepRecentDays}d window) are kept verbatim\n`,
  );

  t = Date.now();
  const observedCats = db
    .prepare(`SELECT DISTINCT category FROM signals WHERE synthetic = 0 ORDER BY category`)
    .pluck()
    .all();
  const observed = observedCats.map((category) => ({
    category,
    ...planObservedCategory(db, category, refs, cutoffMs),
  }));
  const syntheticCats = db
    .prepare(`SELECT DISTINCT category FROM signals WHERE synthetic = 1 ORDER BY category`)
    .pluck()
    .all();
  const synthetic = syntheticCats.map((category) => ({
    category,
    ...planSynthetic(db, category, refs),
  }));
  const planMs = Date.now() - t;

  const header =
    `${pad("category", 26)}${lpad("rows", 10)}${lpad("delete", 10)}${lpad("keep", 9)}` +
    `  keep reasons (overlapping): change / day-edge / referenced / recent`;
  console.log("OBSERVED");
  console.log(header);
  const totals = { rows: 0, del: 0, keep: 0 };
  for (const { category, stat } of observed) {
    totals.rows += stat.rows; totals.del += stat.del; totals.keep += stat.keep;
    console.log(
      `${pad(category, 26)}${lpad(stat.rows, 10)}${lpad(stat.del, 10)}${lpad(stat.keep, 9)}` +
        `  ${stat.change} / ${stat.dayEdge} / ${stat.referenced} / ${stat.recent}`,
    );
  }
  console.log(`${pad("total", 26)}${lpad(totals.rows, 10)}${lpad(totals.del, 10)}${lpad(totals.keep, 9)}\n`);

  const synTotals = { rows: 0, del: 0, keep: 0 };
  for (const { stat } of synthetic) {
    synTotals.rows += stat.rows; synTotals.del += stat.del; synTotals.keep += stat.keep;
  }
  console.log(
    `SYNTHETIC ${synTotals.rows} rows in ${synthetic.length} categories; ${synTotals.keep} referenced by issues ` +
      `(always kept); ${synTotals.del} deletable ` +
      (opts.exportSynthetic ? `after export to ${opts.exportSynthetic}` : "-- left alone without --export-synthetic"),
  );

  // Proportional estimate: the signals b-tree and each of its indexes shrink
  // roughly with the row count. Only VACUUM turns this into a smaller file.
  const pageSize = db.pragma("page_size", { simple: true });
  const pageCount = db.pragma("page_count", { simple: true });
  const freePages = db.pragma("freelist_count", { simple: true });
  const signalObjects = db
    .prepare(`SELECT name FROM sqlite_master WHERE tbl_name = 'signals'`)
    .pluck()
    .all();
  const objBytes = new Map(
    db
      .prepare(`SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name`)
      .all()
      .map((r) => [r.name, r.bytes]),
  );
  const signalBytes = signalObjects.reduce((s, n) => s + (objBytes.get(n) || 0), 0);
  const allRows = totals.rows + synTotals.rows;
  const deletedRows = totals.del + (opts.exportSynthetic ? synTotals.del : 0);
  const remainFrac = allRows > 0 ? (allRows - deletedRows) / allRows : 1;
  let estimate = (pageCount - freePages) * pageSize - signalBytes * (1 - remainFrac);
  if (opts.dropIndex) estimate -= (objBytes.get(UNUSED_INDEX) || 0) * remainFrac;
  console.log(
    `\nsize: ${mb(sizeBefore)} now (signals + indexes ${mb(signalBytes)}); ` +
      `estimated ${mb(estimate)} after VACUUM${opts.dropIndex ? " without " + UNUSED_INDEX : ""} ` +
      `(plan took ${secs(planMs)})`,
  );

  if (!opts.apply) {
    console.log("\nDRY RUN -- nothing was changed. Add --apply (see the header) to perform it.");
    db.close();
    return;
  }

  // ---- apply ------------------------------------------------------------
  console.log("\nAPPLY");
  if (opts.exportSynthetic) {
    t = Date.now();
    const { written, bytes } = await exportSynthetic(db, opts.exportSynthetic);
    console.log(`exported ${written} synthetic rows to ${opts.exportSynthetic} (${mb(bytes)}, read back ok, ${secs(Date.now() - t)})`);
  }

  for (const { category, stat, doomed } of observed) {
    if (doomed.length === 0) continue;
    t = Date.now();
    deleteRowids(db, doomed);
    console.log(`deleted ${lpad(doomed.length, 8)} observed ${pad(category, 26)} (${secs(Date.now() - t)}, ${stat.keep} kept)`);
  }
  if (opts.exportSynthetic) {
    for (const { category, doomed } of synthetic) {
      if (doomed.length === 0) continue;
      t = Date.now();
      deleteRowids(db, doomed);
      console.log(`deleted ${lpad(doomed.length, 8)} synthetic ${pad(category, 25)} (${secs(Date.now() - t)})`);
    }
  }

  // Invariant: every reference that resolved before still resolves.
  const resolvedAfter = resolvedReferences(db, refs);
  const lost = [...resolvedBefore].filter((id) => !resolvedAfter.has(id));
  if (lost.length > 0) {
    console.error(`INVARIANT BROKEN: ${lost.length} referenced signal ids no longer resolve, e.g. ${lost.slice(0, 3).join(", ")}`);
    console.error(`Restore from ${opts.snapshot}.`);
    process.exit(2);
  }
  console.log(`references: all ${resolvedAfter.size} referenced signal ids still resolve`);

  if (opts.dropIndex) {
    db.exec(`DROP INDEX IF EXISTS ${UNUSED_INDEX}`);
    console.log(`dropped ${UNUSED_INDEX} (src/db.ts recreates it at the next API boot until its CREATE is removed)`);
  }

  if (opts.vacuum) {
    t = Date.now();
    const mode = db.pragma("journal_mode", { simple: true });
    if (mode === "wal") db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    if (mode === "wal") db.pragma("wal_checkpoint(TRUNCATE)");
    console.log(`VACUUM done (${secs(Date.now() - t)})`);
  } else {
    console.log("no --vacuum: freed pages stay in the file until a VACUUM");
  }

  const remaining = db.prepare(`SELECT COUNT(*) FROM signals`).pluck().get();
  db.close();
  console.log(
    `\nsize: ${mb(sizeBefore)} -> ${mb(fileBytes(dbPath))}; signals ${allRows} -> ${remaining} rows; ` +
      `total ${secs(Date.now() - started)}. Start oracle-api again.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
