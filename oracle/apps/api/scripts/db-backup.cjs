#!/usr/bin/env node
// Scheduled, verified backup of the API's SQLite database.
//
// Usage: node apps/api/scripts/db-backup.cjs [--gzip] [--db <path>]
//          [--dir <path>] [--now <ISO time>] [--no-offsite]
//
// Why this exists: the only copies of oracle.db were the pre-deploy snapshots
// deploy.sh takes, and those happen only when an API change is deployed and
// rotate after five. A quiet month without API merges meant no fresh restore
// point at all, and every copy lived on the same disk as the database. This is
// the daily job an operator can switch on (pm2 app `bridge-db-backup`, see
// oracle/deploy/README.md "Scheduled backups & restore").
//
// What one run does, in this order, and why the order matters:
//   1. refuse to start if the disk would be left with less than
//      BACKUP_MIN_FREE_MB free -- the backup shares a disk with the live
//      database, and SQLite on a full disk fails the API's writes, not ours;
//   2. VACUUM INTO a hidden .partial file from a read-only handle (the same
//      online-backup approach as db-snapshot.cjs);
//   3. PRAGMA quick_check on the copy -- a copy that is not "ok" is deleted,
//      because an unverified file in the backup directory is worse than none:
//      it is what someone restores from at 3am;
//   4. optionally gzip, then rename into place and write a sha256sum-format
//      sidecar, so a restore can be checked with `sha256sum -c`;
//   5. rotate -- only after a verified copy exists, so a failing job never
//      eats the good backups it failed to replace;
//   6. optionally rsync the file off the host (BACKUP_RSYNC_TARGET);
//   7. write data/backup/.last-backup.json for a future health field.
//
// Rotation only ever considers files named daily-YYYYMMDD-HHMMSS.db[.gz].
// pre-deploy-*.db (deploy.sh owns their rotation) and manual-*.db (an
// operator's) are never touched, nor is anything else in the directory.
//
// Exit codes: 0 ok; 1 backup not taken (disk, lock, VACUUM); 2 copy failed
// quick_check (deleted); 3 backup kept but the off-host copy failed; 4 backup
// kept but rotation could not remove an expired file; 64 bad argument or
// BACKUP_* value.
//
// CommonJS and dependency-free beyond better-sqlite3/dotenv for the same reason
// as db-snapshot.cjs: it runs straight from source, before or without a build,
// and `require` resolves through this package's node_modules.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const { spawnSync } = require("child_process");

const API_ROOT = path.join(__dirname, "..");

// The API reads apps/api/.env (dotenv/config from its cwd); read the same file
// so DB_PATH and the BACKUP_* settings mean the same thing to both. Values
// already in the environment win, as they do for the API.
try {
  require("dotenv").config({ path: path.join(API_ROOT, ".env"), quiet: true });
} catch {
  // No dotenv (or no .env) -- defaults and the real environment still apply.
}

const Database = require("better-sqlite3");

const DAILY_RE = /^daily-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db(\.gz)?$/;

function log(level, msg) {
  const line = `${new Date().toISOString()} db-backup ${level} ${msg}`;
  if (level === "FAIL" || level === "WARN") console.error(line);
  else console.log(line);
}

function parseArgs(argv) {
  const out = { gzip: undefined, db: undefined, dir: undefined, now: undefined, offsite: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage(`${a} needs a value`);
      return v;
    };
    if (a === "--gzip") out.gzip = true;
    else if (a === "--no-gzip") out.gzip = false;
    else if (a === "--db") out.db = next();
    else if (a === "--dir") out.dir = next();
    else if (a === "--now") out.now = next();
    else if (a === "--no-offsite") out.offsite = false;
    else usage(`unknown argument: ${a}`);
  }
  return out;
}

function usage(err) {
  console.error(`db-backup: ${err}`);
  console.error(
    "usage: db-backup.cjs [--gzip|--no-gzip] [--db <path>] [--dir <path>] [--now <ISO time>] [--no-offsite]",
  );
  process.exit(64);
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  usage(`${name} must be a boolean (1/0, true/false, yes/no, on/off), got "${raw}"`);
}

function envInt(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) usage(`${name} must be an integer >= ${min}, got "${raw}"`);
  return n;
}

// Relative paths resolve against apps/api, which is the API's cwd under pm2 --
// so a relative DB_PATH names the same file for both processes whatever cwd
// this script happens to be started from.
function resolveFromApi(p) {
  return path.isAbsolute(p) ? p : path.resolve(API_ROOT, p);
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

// ISO-8601 week key ("2026-W39") in UTC: weeks start on Monday and belong to
// the year that holds their Thursday.
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function secs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// A second run (a manual one during the cron one) would VACUUM the same
// database twice and race on rotation. The lock carries the owner's PID so a
// lock left by a killed run is reclaimed rather than blocking every later day.
function acquireLock(lockFile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const pid = Number(fs.readFileSync(lockFile, "utf8").trim());
      let alive = false;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (e) {
          alive = e.code === "EPERM";
        }
      }
      if (alive) return false;
      log("WARN", `reclaiming stale lock from pid ${pid || "?"}`);
      fs.rmSync(lockFile, { force: true });
    }
  }
  return false;
}

// Grandfather-father-son, by count rather than by calendar. Kept:
//   - the newest backup, always;
//   - every backup within RECENT_MS of the newest one, so a manual backup
//     taken before a risky change is not pruned by a second one taken after
//     the change went wrong;
//   - the newest backup of each of the `keepDaily` most recent UTC days that
//     have one -- days, not files, so extra runs on one day (manual ones,
//     `pm2 restart`, a resurrect after a reboot) cannot push older days out;
//   - the newest backup of each of the `keepWeekly` most recent ISO weeks
//     that have one.
// Counting days/weeks that have a backup (rather than "days since today")
// means a job that was off for a month does not come back and delete the only
// copies left from before the gap.
const RECENT_MS = 24 * 3600 * 1000;

function planRotation(names, keepDaily, keepWeekly) {
  const backups = names
    .map((name) => {
      const m = DAILY_RE.exec(name);
      if (!m) return null;
      const [, y, mo, d, h, mi, s] = m;
      const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
      return { name, at, key: `${y}${mo}${d}${h}${mi}${s}` };
    })
    .filter(Boolean)
    // Name order == time order; the name breaks ties between .db and .db.gz.
    .sort((a, b) => (a.key === b.key ? (a.name < b.name ? 1 : -1) : a.key < b.key ? 1 : -1));
  if (backups.length === 0) return { keep: [], remove: [] };

  const keep = new Set([backups[0].name]);
  const newestAt = backups[0].at.getTime();
  for (const b of backups) {
    if (newestAt - b.at.getTime() < RECENT_MS) keep.add(b.name);
  }
  // Newest-first order means the first backup seen in a bucket is its newest.
  const keepNewestPer = (bucketOf, limit) => {
    const seen = new Set();
    for (const b of backups) {
      const bucket = bucketOf(b);
      if (seen.has(bucket)) continue;
      if (seen.size >= limit) break;
      seen.add(bucket);
      keep.add(b.name);
    }
  };
  keepNewestPer((b) => b.key.slice(0, 8), keepDaily); // UTC date
  keepNewestPer((b) => isoWeek(b.at), keepWeekly);
  return {
    keep: backups.filter((b) => keep.has(b.name)).map((b) => b.name),
    remove: backups.filter((b) => !keep.has(b.name)).map((b) => b.name),
  };
}

function rsyncOffsite(files, target, sshCmd, timeoutSec) {
  // Argument array, no shell: the target comes from the environment and must
  // never be interpreted as shell syntax. `--` ends option parsing so a file or
  // target starting with "-" cannot be read as a flag.
  const args = ["--times", `--timeout=${Math.max(30, Math.min(timeoutSec, 600))}`];
  if (sshCmd) args.push("-e", sshCmd);
  args.push("--", ...files, target);
  const started = Date.now();
  const res = spawnSync("rsync", args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutSec * 1000,
    encoding: "utf8",
  });
  const took = Date.now() - started;
  if (res.error) return { ok: false, error: `${res.error.code || ""} ${res.error.message}`.trim(), ms: took };
  if (res.status !== 0) {
    // The cause (e.g. ssh's "Could not resolve hostname") is usually on an
    // early line and rsync's own summary on the last, so keep a few.
    const detail = (res.stderr || res.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-3)
      .join(" | ");
    return {
      ok: false,
      error: `rsync exited ${res.status ?? res.signal}${detail ? `: ${detail}` : ""}`,
      ms: took,
    };
  }
  return { ok: true, error: null, ms: took };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const now = args.now ? new Date(args.now) : startedAt;
  if (Number.isNaN(now.getTime())) usage(`--now is not a valid time: ${args.now}`);

  const dbPath = resolveFromApi(args.db || process.env.DB_PATH || path.join("data", "oracle.db"));
  const dir = resolveFromApi(args.dir || process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backup"));
  const gzip = args.gzip ?? envBool("BACKUP_GZIP", false);
  const keepDaily = envInt("BACKUP_KEEP_DAILY", 7, 1);
  const keepWeekly = envInt("BACKUP_KEEP_WEEKLY", 4, 0);
  const minFreeMb = envInt("BACKUP_MIN_FREE_MB", 1024, 0);
  const rsyncTarget = args.offsite ? (process.env.BACKUP_RSYNC_TARGET || "").trim() : "";
  const rsyncSsh = (process.env.BACKUP_RSYNC_SSH || "").trim();
  const rsyncTimeout = envInt("BACKUP_RSYNC_TIMEOUT_SECONDS", 900, 30);

  const markerFile = path.join(dir, ".last-backup.json");
  const baseName = `daily-${stamp(now)}.db`;
  const finalName = gzip ? `${baseName}.gz` : baseName;
  const finalPath = path.join(dir, finalName);
  const partial = path.join(dir, `.${baseName}.partial`);

  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  } catch {
    // First run, or an unreadable marker -- it is only a report.
  }

  const marker = {
    ok: false,
    file: null,
    bytes: null,
    sha256: null,
    gzip,
    quickCheck: null,
    offsite: { target: rsyncTarget || null, ok: null, error: null },
    rotation: null,
    source: dbPath,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: null,
    error: null,
    // The newest verified backup, carried across failed runs so a reader can
    // tell "failed today" from "never worked".
    lastGood: previous && previous.ok ? { file: previous.file, finishedAt: previous.finishedAt } : previous?.lastGood ?? null,
  };

  const finish = (code) => {
    marker.finishedAt = new Date().toISOString();
    marker.durationMs = Date.now() - startedAt.getTime();
    if (marker.ok) marker.lastGood = { file: marker.file, finishedAt: marker.finishedAt };
    try {
      writeAtomic(markerFile, `${JSON.stringify(marker, null, 2)}\n`);
    } catch (err) {
      log("WARN", `could not write ${markerFile}: ${err.message}`);
    }
    return code;
  };

  log("START", `source=${dbPath} dir=${dir} file=${finalName} gzip=${gzip} offsite=${rsyncTarget ? "on" : "off"}`);

  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    marker.error = `source database not found: ${dbPath}`;
    log("FAIL", marker.error);
    return finish(1);
  }

  const lockFile = path.join(dir, ".backup.lock");
  if (!acquireLock(lockFile)) {
    log("FAIL", `another backup run holds ${lockFile}; not starting a second one`);
    return 1; // the running one owns the marker
  }

  try {
    if (fs.existsSync(finalPath)) {
      marker.error = `${finalName} already exists`;
      log("FAIL", `${finalName} already exists; refusing to overwrite a backup`);
      return finish(1);
    }

    // The copy is at most the size of the database file (VACUUM only drops
    // free pages), so that is the space it can take. The WAL is not counted:
    // its committed content is already inside that estimate once copied.
    const srcBytes = fs.statSync(dbPath).size;
    const fsStat = fs.statfsSync(dir);
    const freeBytes = fsStat.bavail * fsStat.bsize;
    const needBytes = srcBytes + minFreeMb * 1048576;
    if (freeBytes < needBytes) {
      marker.error = `insufficient disk: ${mb(freeBytes)} free, need ${mb(needBytes)}`;
      log(
        "FAIL",
        `not enough disk: ${mb(freeBytes)} free, backup needs up to ${mb(srcBytes)} and BACKUP_MIN_FREE_MB=${minFreeMb} must stay free`,
      );
      return finish(1);
    }

    // A .partial left by a killed run is ours and never a restore point.
    for (const n of fs.readdirSync(dir)) {
      if (/^\.daily-.*\.partial(\.gz)?$/.test(n)) fs.rmSync(path.join(dir, n), { force: true });
    }

    // 1. Copy. Read-only, as in db-snapshot.cjs: the backup must never be the
    // thing that writes to the database it protects.
    let t = Date.now();
    try {
      const src = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        src.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`);
      } finally {
        src.close();
      }
    } catch (err) {
      fs.rmSync(partial, { force: true });
      marker.error = `VACUUM INTO failed: ${err.message}`;
      log("FAIL", `VACUUM INTO failed: ${err.message}`);
      return finish(1);
    }
    const copyBytes = fs.statSync(partial).size;
    log("INFO", `copied ${mb(srcBytes)} -> ${mb(copyBytes)} in ${secs(Date.now() - t)}`);

    // 2. Verify the copy, not the source: the copy is what a restore will use.
    t = Date.now();
    let quick;
    try {
      const copy = new Database(partial, { readonly: true, fileMustExist: true });
      try {
        quick = copy
          .prepare("PRAGMA quick_check")
          .all()
          .map((r) => Object.values(r)[0]);
      } finally {
        copy.close();
      }
    } catch (err) {
      quick = [`error: ${err.message}`];
    }
    const quickOk = quick.length === 1 && quick[0] === "ok";
    marker.quickCheck = quickOk ? "ok" : quick.slice(0, 5).join("; ");
    if (!quickOk) {
      fs.rmSync(partial, { force: true });
      marker.error = `quick_check failed: ${marker.quickCheck}`;
      log("FAIL", `quick_check on the copy was not ok (${marker.quickCheck}); copy deleted, nothing rotated`);
      return finish(2);
    }
    log("INFO", `quick_check ok in ${secs(Date.now() - t)}`);

    // 3. Compress (optional), then move into place under its final name.
    let ready = partial;
    if (gzip) {
      t = Date.now();
      const gz = `${partial}.gz`;
      try {
        await pipeline(fs.createReadStream(partial), zlib.createGzip({ level: 6 }), fs.createWriteStream(gz));
      } catch (err) {
        fs.rmSync(gz, { force: true });
        fs.rmSync(partial, { force: true });
        marker.error = `gzip failed: ${err.message}`;
        log("FAIL", `gzip failed: ${err.message}`);
        return finish(1);
      }
      fs.rmSync(partial, { force: true });
      ready = gz;
      log("INFO", `gzipped ${mb(copyBytes)} -> ${mb(fs.statSync(gz).size)} in ${secs(Date.now() - t)}`);
    }

    t = Date.now();
    const digest = await sha256File(ready);
    fs.renameSync(ready, finalPath);
    // Owner-only, like the live database should be: a backup is a full copy of
    // it, and it may be rsynced to hosts with other users.
    fs.chmodSync(finalPath, 0o600);
    // sha256sum's own format, so `sha256sum -c daily-....sha256` checks it.
    writeAtomic(`${finalPath}.sha256`, `${digest}  ${finalName}\n`);
    const finalBytes = fs.statSync(finalPath).size;
    Object.assign(marker, { ok: true, file: finalName, bytes: finalBytes, sha256: digest });
    log("OK", `backup ${finalName} bytes=${finalBytes} (${mb(finalBytes)}) sha256=${digest} quick_check=ok`);

    let code = 0;

    // 4. Rotate, only now that a verified copy is in place.
    const plan = planRotation(fs.readdirSync(dir), keepDaily, keepWeekly);
    const removed = [];
    const failedRemovals = [];
    for (const name of plan.remove) {
      try {
        fs.rmSync(path.join(dir, name));
        fs.rmSync(path.join(dir, `${name}.sha256`), { force: true });
        removed.push(name);
      } catch (err) {
        failedRemovals.push(name);
        log("WARN", `rotation could not remove ${name}: ${err.message}`);
      }
    }
    marker.rotation = { kept: plan.keep, removed, keepDaily, keepWeekly };
    log(
      "INFO",
      `rotation kept=${plan.keep.length} removed=${removed.length}${removed.length ? ` (${removed.join(", ")})` : ""}`,
    );
    if (failedRemovals.length) {
      marker.error = `rotation could not remove: ${failedRemovals.join(", ")}`;
      code = 4;
    }

    // 5. Off-host copy. A failure leaves the local backup in place and is
    // reported, because a copy that only exists on this disk dies with it.
    if (rsyncTarget) {
      const res = rsyncOffsite([finalPath, `${finalPath}.sha256`], rsyncTarget, rsyncSsh, rsyncTimeout);
      marker.offsite = { target: rsyncTarget, ok: res.ok, error: res.error, durationMs: res.ms };
      if (res.ok) {
        log("INFO", `offsite copy to ${rsyncTarget} ok in ${secs(res.ms)}`);
      } else {
        log("FAIL", `offsite copy to ${rsyncTarget} failed (local backup kept): ${res.error}`);
        marker.error = `offsite copy failed: ${res.error}`;
        code = 3;
      }
    }

    log(code === 0 ? "DONE" : "DONE-WITH-ERRORS", `exit=${code} took=${secs(Date.now() - startedAt.getTime())}`);
    return finish(code);
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log("FAIL", `unexpected error: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  },
);
