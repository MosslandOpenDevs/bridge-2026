# Deployment

Production runs like ao/algora: nginx on the Lightsail box terminates SSL for
`bridge.moss.land` and reverse-proxies (over Tailscale) to the application
server, which runs `oracle-web` (port 3100) and `oracle-api` (port 3101) from
[`ecosystem.config.cjs`](../ecosystem.config.cjs).

## Auto-deploy

Same mechanism as `algora-deploy` / `moss-ao-deploy` on the shared box: a
one-shot script, [`scripts/deploy.sh`](../scripts/deploy.sh), registered as the
pm2 app **`bridge-deploy`** with `cron_restart: '3-59/5 * * * *'` — every 5
minutes it fetches `origin/main` and, only when the remote moved, rebuilds and
restarts what changed. Push CI can't reach the app server (Tailscale-only,
no public inbound), so the server pulls.

What a deploy tick does:

1. `git fetch` — exits immediately when the **last successful deploy**
   (recorded in `.git/bridge-deployed-sha`, written only after a fully healthy
   tick) already equals the remote tip. HEAD alone is not trusted: a tick
   killed mid-deploy leaves HEAD moved but the state file behind, so the next
   tick finishes the job instead of calling it done
2. Classifies the diff (last success → tip) — **docs-only merges (README,
   docs, nexus/) are synced, not deployed**: the checkout is reset to the tip
   so on-server docs stay current, but nothing is built, restarted, or
   snapshotted (logged as `SYNCED`). `oracle/apps/api` → API,
   `oracle/apps/web` → web, `oracle/packages` → both; `oracle/scripts` /
   `ecosystem.config.cjs` update the checkout without build or restart
3. Guards: refuses to touch a checkout that is on another branch, has local
   tracked-file edits, or has **local commits not on the remote** (the reset
   would destroy them); optional CI-green gate (`DEPLOY_REQUIRE_CI=1`); a
   commit that failed `DEPLOY_MAX_FAILURES` (3) deploys is **parked** — one
   alert, then no retries until a new commit lands (`--force` overrides)
4. Best-effort SQLite snapshot to `apps/api/data/backup/` before API changes.
   Retries of a failing commit do not snapshot again, and rotation (keep 5)
   always spares the snapshot taken before the last successful deploy — a
   long incident cannot rotate the pre-incident restore point away
5. `git reset --hard` to the tip (untracked `.env` / `data/` are never touched;
   the script never runs `git clean`)
6. Build and `pm2 restart` only the affected app — never `pm2 restart all` on
   this shared box. The API compiles to `apps/api/dist` (what PM2 runs — a
   commit that does not compile never reaches a restart); the web app builds
   into `.next.new` and is swapped over the live `.next` only on success, so
   a failed build cannot blank the running site
7. Health checks (`/api/health?strict=1`, web `/`); on failure it **rolls back** to the
   last successful deploy, rebuilds, and alerts (`DEPLOY_ALERT_WEBHOOK`).
   `strict=1` answers 503 only when the API reports `down` (its database
   cannot be read); `degraded` — e.g. no signal collected yet right after the
   restart — passes

Concurrent ticks are excluded by a PID-carrying lock: a lock whose owner died
is reclaimed immediately, one whose owner is alive is never stolen (a deploy
running longer than 90 minutes is only logged for an operator to inspect).

One-time registration on the app server:

```bash
cd ~/bridge-2026/oracle
pm2 start ecosystem.config.cjs --only bridge-deploy
pm2 save
```

When `ecosystem.config.cjs` itself changes, the deploy log prints a NOTE:
process definitions are not re-registered automatically. From a **login
shell** (never from inside a PM2-managed process — PM2 injects config keys
like `cron_restart` into the environment and `--update-env` would copy them
onto every app):

```bash
cd ~/bridge-2026/oracle
pnpm --filter "@oracle/api..." build   # oracle-api runs apps/api/dist
pm2 restart ecosystem.config.cjs --only oracle-api,oracle-web,bridge-deploy --update-env
pm2 save
```

Always name the apps with `--only` (add `bridge-db-backup` once it is
enabled): given the whole file, pm2 restarts the apps that are running and
then **starts every other app in the file** ("Applications … not running,
starting…" — `_startJson` in pm2's `lib/API.js`), which would switch on
opt-in apps such as `bridge-db-backup` as a side effect. The command the
deploy log's NOTE prints does not have `--only` yet; use this one.

Useful invocations on the server:

```bash
oracle/scripts/deploy.sh --check   # dry run: report what would happen
oracle/scripts/deploy.sh           # deploy now if the remote moved
oracle/scripts/deploy.sh --force   # override guards (discards local edits!)
tail -f ~/bridge-2026/oracle/logs/deploy.log
```

## Scheduled backups & restore

The pre-deploy snapshots above are not a backup schedule: they are taken only
when an API change deploys, only five are kept, and they sit on the same disk
as the database. A quiet month without API merges leaves no fresh restore
point at all. **`bridge-db-backup`** is the daily job for that — defined in
[`ecosystem.config.cjs`](../ecosystem.config.cjs), **off until an operator
registers it**.

What one run of
[`apps/api/scripts/db-backup.cjs`](../apps/api/scripts/db-backup.cjs) does:

1. Removes a `.daily-*.partial` left by an interrupted run, then refuses to
   start if the copy (1.5× the database with gzip, while the uncompressed and
   compressed copies coexist) would leave less than `BACKUP_MIN_FREE_MB`
   (1024) free — the backups share a disk with the live database, and SQLite
   on a full disk fails the API's writes
2. `VACUUM INTO` from a read-only handle (the same online copy as the
   pre-deploy snapshot; safe while the API is writing)
3. `PRAGMA quick_check` on the **copy**; anything but `ok` deletes the copy,
   rotates nothing, and exits non-zero
4. gzip (on by default; `BACKUP_GZIP=0` keeps a plain `.db`), then
   `data/backup/daily-YYYYMMDD-HHMMSS.db[.gz]` (UTC) with a
   `sha256sum`-format `.sha256` sidecar, mode 0600
5. Rotation, only after a verified copy exists: the newest backup of each of
   the 7 most recent (UTC) days that have one, plus the newest of each of the
   4 most recent ISO weeks that have one (10 files in steady state), plus every
   backup from the 24 hours before the newest — so extra runs on one day
   (manual ones, `pm2 restart`) never push older days out, and a backup taken
   before a risky change survives one taken after it.
   Only `daily-*` files are ever considered — `pre-deploy-*.db` (rotated by
   deploy.sh) and `manual-*.db` are never touched
6. Optional rsync off the host (`BACKUP_RSYNC_TARGET`); a failed transfer keeps
   the local copy and makes the run exit non-zero
7. Writes `data/backup/.last-backup.json` — `ok`, `file`, `bytes`, `sha256`,
   `quickCheck`, `offsite`, `rotation`, `finishedAt`, `error`, and `lastGood`
   (the newest verified backup, carried across failed runs)

Settings are `BACKUP_*` in `apps/api/.env`; see the "Scheduled database
backups" section of [`apps/api/.env.example`](../apps/api/.env.example).

Size, measured on the production copy of 2026-09-26: 124MB per backup gzipped
(the default), 418MB with `BACKUP_GZIP=0`, so ~1.3GB or ~4.2GB for ten files —
check `df -h ~/bridge-2026` first. A run took 17s on a running API (copy 3.0s,
quick_check 0.8s, gzip 13s); without gzip, under 4s.

### Enable

From a **login shell** on the app server:

```bash
cd ~/bridge-2026/oracle
pm2 start ecosystem.config.cjs --only bridge-db-backup
pm2 save
```

`pm2 start` runs one backup right away; after that `cron_restart: '17 4 * * *'`
runs it daily at 04:17 in the **server's local time** (pm2's timezone). Between
runs `pm2 ls` shows it `stopped` — that is normal for a one-shot cron app, as
for `bridge-deploy`.

`pm2 start ecosystem.config.cjs --only oracle-api,oracle-web` (the README Quick
start) and the `--only` re-registration command above do not register it. Any
pm2 command given the whole file **without** `--only` does — pm2 starts every
app in the file that is not running, which takes a backup at once and
schedules the daily one. Once it is enabled, add `bridge-db-backup` to that
`--only` list so re-registration picks up changes to its definition.

Off-host copy (optional): add to `apps/api/.env`

```bash
BACKUP_RSYNC_TARGET=backup@backup-host:/srv/backups/bridge/
BACKUP_RSYNC_SSH=ssh -i /home/<user>/.ssh/bridge_backup -o BatchMode=yes
```

rsync is spawned without a shell, so use absolute paths (no `~`), and the key
must work non-interactively. The script does not rotate the remote side; give
it its own retention. Try it with a manual run before relying on it.

To switch backups off again: `pm2 delete bridge-db-backup && pm2 save`.
Existing files stay where they are.

### Verify

```bash
tail -n 20 ~/bridge-2026/oracle/logs/db-backup-out.log
grep -h 'db-backup FAIL\|db-backup WARN' ~/bridge-2026/oracle/logs/db-backup-*.log
cat ~/bridge-2026/oracle/apps/api/data/backup/.last-backup.json
cd ~/bridge-2026/oracle/apps/api/data/backup && sha256sum -c daily-*.sha256
```

Every line starts `<ISO time> db-backup <LEVEL>`: `START`, `INFO` (per-phase
sizes and timings), `OK` (the verified file, its bytes and sha256), `WARN`,
`FAIL` (on stderr, so also in `db-backup-error.log`), then `DONE` or
`DONE-WITH-ERRORS` with the exit code — 0 ok; 1 no backup taken (disk, lock,
VACUUM); 2 copy failed quick_check and was deleted; 3 backup kept, off-host
copy failed; 4 backup kept, rotation could not delete an expired file; 64 bad
argument or `BACKUP_*` value.

A backup by hand, e.g. before a risky manual change:
`node ~/bridge-2026/oracle/apps/api/scripts/db-backup.cjs` (or
`pm2 restart bridge-db-backup` once registered). A second run started while
one is in progress refuses rather than racing it.

### Restore

Everything written after the backup was taken is lost — signals collected
since, and any issue or proposal change. Move the damaged files aside rather
than deleting them, so the restore itself can be undone.

Rehearsed on 2026-09-26 against a copy of production data and a local API
boot: backup taken while the API was running, database then damaged
(`quick_check` failing), restored with these steps (on a Mac, so `kill` for
`pm2 stop`/`start` and `shasum -a 256` for `sha256sum`); afterwards
`/api/health` was `ok`, `?strict=1` answered 200, and `/api/stats` matched the
pre-backup numbers exactly (signals 881,519, issues 754, proposals 21).
gunzip took 0.6s and the quick_check under a second. The auto-deployer pause
in steps 2 and 6 was not part of that rehearsal (no pm2 on the test machine);
it follows pm2's source: `pm2 stop` leaves a cron app's job registered and the
job restarts the app, while `pm2 delete` removes it.

```bash
cd ~/bridge-2026/oracle/apps/api
ls -lt data/backup/ && cat data/backup/.last-backup.json
B=data/backup/daily-YYYYMMDD-HHMMSS.db.gz          # the backup to restore

# 1. Check the file before taking anything down.
(cd data/backup && sha256sum -c "$(basename "$B").sha256")

# 2. Pause the auto-deployer, then stop the API -- never `pm2 stop all` on
#    this shared box. A deploy tick that changes the API runs
#    `pm2 restart oracle-api`, and with oracle.db moved aside the API would
#    create a fresh, empty database. `pm2 stop` does not pause a cron app
#    (pm2 keeps its cron job and restarts it on schedule), so deregister it
#    with `pm2 delete` -- after checking no deploy is running right now, and
#    without `pm2 save`, so a reboot mid-restore still brings it back.
#    bridge-db-backup can stay: it opens the database read-only and fails
#    cleanly if the file is missing.
if [ -d ../../logs/.deploy.lock ]; then echo "deploy running -- retry shortly"; else pm2 delete bridge-deploy; fi
pm2 stop oracle-api

# 3. Move the live database AND its -wal/-shm aside, together. A -wal left
#    next to the restored file would be replayed onto it at the next open.
#    (A missing -wal/-shm is fine; mv just says so.)
ASIDE="data/aside-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$ASIDE"
mv data/oracle.db data/oracle.db-wal data/oracle.db-shm "$ASIDE"/; ls -la "$ASIDE"

# 4. Copy the backup in under a temporary name.
gunzip -c "$B" > data/oracle.db.restoring          # for a .db.gz
# cp "$B" data/oracle.db.restoring                 # for a .db -- then also:
# echo "$(cut -d' ' -f1 "$B.sha256")  data/oracle.db.restoring" | sha256sum -c

# 5. Check the restored file (no sqlite3 CLI on the server; this uses the
#    API's own better-sqlite3), then put it in place. Must print: ok
node -e 'const D=require("better-sqlite3");const d=new D(process.argv[1],{readonly:true});console.log(d.pragma("quick_check",{simple:true}));d.close()' data/oracle.db.restoring
#    Before the mv: oracle-api must still be stopped and the only oracle.db*
#    file must be oracle.db.restoring. If the API was started meanwhile, it
#    has created an empty oracle.db with its own -wal/-shm: `pm2 stop
#    oracle-api` and move those aside too (a foreign -wal next to the
#    restored file would be replayed onto it).
pm2 ls | grep oracle-api; ls -la data/oracle.db*
mv data/oracle.db.restoring data/oracle.db

# 6. Start it (`pm2 restart oracle-api` instead if `pm2 ls` shows it online
#    here -- a running API would keep using the file it opened before the
#    mv), check, then re-register the auto-deployer, which runs one tick at
#    once.
pm2 start oracle-api
curl -s localhost:3101/api/health; echo
curl -s localhost:3101/api/stats | head -c 300; echo
(cd ../.. && pm2 start ecosystem.config.cjs --only bridge-deploy)
```

`/api/health` may say `degraded` (no signal within the staleness window) until
the first collection tick after the restart, about a minute; `down` means the
database cannot be read — go back to step 2 and restore the aside files or
another backup. `signals.total` in `/api/stats` should equal the count at
backup time. Delete the `aside-*` directory once satisfied; it is as large as
the database.

## nginx (Lightsail box)

`bridge.moss.land` proxies `/api` and `/socket.io` to the app server's port
3101 and everything else to port 3100. The API's health endpoint is exposed at
`/api/health` for external uptime monitoring. Plain `/api/health` answers 200
whenever the process is up and carries the verdict in the body — `status`
(`ok` | `degraded` | `down`) and `reason` — so a monitor that parses the body
should read those. A monitor that reads only the HTTP code should poll
`/api/health?strict=1`, which answers 503 when the database cannot be read;
on plain `/api/health` it would never alarm.

Two known gaps, both in nginx rather than in this repo:

- **No `listen 80` block**, so `http://bridge.moss.land` returns nginx's default
  404 instead of redirecting. Every other vhost on that box has one. HSTS
  (`preload`) covers anyone who has already visited over https; a first-time
  visitor typing the bare host does not get redirected.
- **API responses are not compressed.** `gzip on` is set globally but
  `gzip_types` and `gzip_proxied` are commented out in `nginx.conf`, and the
  defaults cover neither `application/json` nor proxied responses — so
  `GET /api/proposals` ships 3.36MB uncompressed (873KB gzipped). Fixing it in
  the API instead was tried and rejected: adding the `compression` package makes
  pnpm re-resolve peers across the workspace, moving `ws` 7→8 and `zod` 4→3 in
  the wallet stack, which is not a trade worth making for one endpoint. It also
  spends event-loop time this process does not have (see the /api/stats note in
  `db.ts`). Scoped to the bridge server block so the other ~20 sites on that box
  are untouched:

  ```nginx
  gzip_proxied any;
  gzip_types application/json;
  gzip_min_length 1024;
  ```

  Apply with `sudo nginx -t && sudo systemctl reload nginx`.

## Data retention & compaction

The collectors write one row per category per minute whether or not anything
changed. On the 2026-09-26 production snapshot that was 881,519 observed rows,
~99% of them a repeat of the previous minute (`github_commit`,
`mossland_disclosure` and `mossland_roadmap` had one distinct value in seven
days), plus 223,074 rows from the retired demo adapter. Signals and their
indexes were 96% of the file, which grows ~7.5 MB/day.

[`apps/api/scripts/compact-signals.cjs`](../apps/api/scripts/compact-signals.cjs)
removes the repeats. **It never runs on its own** — not from `deploy.sh`, not
from the API, not from a cron — and it has not been run on production. Running
it is an operator decision, taken and recorded like any other: MIP-1 says
archiving is not deletion and that deleting data takes its own agenda item.
BRIDGE is Lab rather than Archive, and what this removes is only rows that
repeat a row it keeps, but it is still removal of history, so the policy it
applies is written down here rather than left to a flag.

### Retention policy

For each **observed** category, walking rows in time order, a row is kept if
any of these holds; everything else is deleted:

- it is a **change point** — its `(value, description, severity)` differs from
  the row before it. The series stays a faithful step function: every deleted
  row equals the kept row before it (checked row by row on a copy, see below)
- it is the **first or last row of its UTC day**, so the collector's daily
  cadence stays visible even for a category that never changes
- it is **referenced from any other table** — `issues.signal_ids` (what
  `/api/issues` embeds), anomaly evidence in `issues.evidence`, signals inside
  `proposals.decision_packet`. The script scans every text column of every
  other table for ids, so no issue or proposal loses its evidence
- it is within the **last 7 days** (`--keep-recent-days`), so `/api/signals?limit=N`
  and the monitors read exactly what they read before. Issue detection reads
  the last `DETECTION_WINDOW_MINUTES` (120) plus, for each level, the row in
  force when that window opens — a reading this always keeps, since every
  row it deletes repeats a kept one (`apps/api/src/detection-input.ts`)

**Synthetic** (demo) rows are kept unless `--export-synthetic <file.jsonl.gz>`
is given; then all of them are written to that file first (verbatim columns,
read back and counted before anything is deleted) and removed, except the ones
an issue still references. Issues, proposals, decisions and every other table
are never modified.

What changes for readers: `/api/stats` keeps every field, but
`signals.total` counts the rows that remain — 881,519 → 103,857 on the
snapshot — and `signals.synthetic.total` 223,074 → 22,688. The moss.land
homepage widget shows `signals.total`. Nothing else in the public responses
changed (see the measurements).

This is a one-off cleanup of history, not a fix of the write path: the
collectors keep writing repeats (~9.4k rows/day) until they store on change.
Re-running later compacts the new history; a second run over an already
compacted copy deleted nothing.

### Procedure (on the app server)

```bash
cd ~/bridge-2026/oracle
# Step 3 pipes into tee; without pipefail the pipeline would report tee's
# status and a REFUSED or INVARIANT BROKEN run would look like success.
set -o pipefail

# 0. Size it. Read-only, safe while the API runs.
node apps/api/scripts/compact-signals.cjs apps/api/data/oracle.db

# 1. Stop the writers. bridge-deploy too, so a deploy tick cannot restart the API
#    mid-run -- and do not merge API changes to main during the window.
pm2 stop bridge-deploy oracle-api

# 2. Snapshot -- the restore path. Take it now, after the stop: the script refuses one
#    that is not of the current state (signal/issue counts and newest timestamps must
#    match the live file), as well as one that is > 24h old or fails quick_check.
SNAP=apps/api/data/backup/pre-compact-$(date -u +%Y%m%dT%H%M%SZ).db
node apps/api/scripts/db-snapshot.cjs apps/api/data/oracle.db "$SNAP"

# 3. Compact. Refuses without both gates, and while any process holds the file (lsof).
node apps/api/scripts/compact-signals.cjs apps/api/data/oracle.db --apply \
  --snapshot-verified "$SNAP" --i-stopped-the-api \
  --export-synthetic apps/api/data/backup/synthetic-signals-$(date -u +%Y%m%d).jsonl.gz \
  --vacuum 2>&1 | tee -a logs/compaction.log
rc=$?

# 4. Start again and check -- only if step 3 exited 0.
if [ "$rc" -eq 0 ]; then
  pm2 start oracle-api bridge-deploy
  curl -s 'http://localhost:3101/api/health?strict=1'
else
  echo "compaction exited $rc: do NOT start the API; see the exit codes below"
fi
```

Exit codes of step 3:

- `0` — done; step 4 starts the API.
- `1` — a `REFUSED:` line means a gate failed before anything was changed: fix
  the cause (usually a fresh snapshot) and repeat from step 2. Any other error
  after the `APPLY` line: treat it like `2`.
- `2` — `INVARIANT BROKEN`: a referenced signal no longer resolves. **Restore
  from `$SNAP` (below) before starting anything**; starting the API or
  `bridge-deploy` first would add new rows on top of the broken file.
- `64` — bad arguments; nothing was opened.

VACUUM needs the database to itself (hence the stopped API) and free disk
about the size of the result. `pre-compact-*` snapshots are not rotated by
`deploy.sh` (it rotates only `pre-deploy-*`); both it and the export sit on
the same disk as the database, so copy them off the host before treating the
old rows as gone.

To undo: `pm2 stop oracle-api`, copy `$SNAP` over `apps/api/data/oracle.db`,
delete `oracle.db-wal` and `oracle.db-shm`, `pm2 start oracle-api`. Rows
collected after the snapshot are lost with the restore.

`--drop-unused-index` drops `idx_signals_severity`, which no query uses, but
`src/db.ts` still creates it at boot (`CREATE INDEX IF NOT EXISTS`), so it is
back after the next start — 1.5 MB after compaction instead of 13.5 MB. Leave
it out until that line is removed.

### Measured on a copy of the 2026-09-26 snapshot

Full run (`--export-synthetic --drop-unused-index --vacuum`) on a copy that
had been booted by the API first (WAL mode, as on production), on a MacBook SSD:

| | before | after |
|---|---:|---:|
| file | 418.4 MB | 61.8 MB (dry-run estimate 62.0 MB) |
| observed rows | 881,519 | 103,857 |
| synthetic rows | 223,074 | 22,688 (all referenced by issues) |
| referenced signal ids that resolve | 37,046 | 37,046 |
| wall time | | 16.0 s (plan 2.3 s, export 1.9 s, deletes ~10 s, VACUUM 0.2 s), 247 MB RSS |

The synthetic export was 15.4 MB. Without the export (observed rows only,
`--vacuum`) the file went to 136.2 MB. With the API booted on the compacted
copy: `/api/health` `ok`, the 500 issues of `/api/issues?limit=500` and of
`?status=detected` byte-identical to before including their embedded signals,
`/api/proposals`, `/api/outcomes` and `/api/signals?limit=50` identical, and
`/api/stats` identical outside `signals.*`. Checked directly against the
original: all 135,897 `signal_ids` references of all 3,811 issues resolve to
identical rows.

## Governance loop: issues have to be closed

Detection folds a repeat sighting into the open issue for the same condition and
only re-deliberates on an escalation — the loop is designed to stay quiet while
a condition persists, and to treat it as news again once the issue is
**resolved** (see `findOpenByFingerprint` in `apps/api/src/db.ts`).

Nothing in production ever resolves one. There is no scheduled job for it, and
the only writer of that status is the admin-gated route below. The result, as of
2026-09-09: 753 issues all in `detected`, one new issue row since 2026-08-08 and
one new proposal since 2026-08-14, while recurrence folding runs about a
thousand times a day. Signal collection is unaffected and healthy.

To re-arm detection for a condition:

```bash
curl -X PATCH https://bridge.moss.land/api/issues/<id> \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"status":"resolved"}'
```

The next detection pass then mints a fresh row for that condition and
deliberates it. **This re-opens recurring LLM spend** — five calls per
deliberation — which is what the fingerprint dedupe was written to stop. Decide
the policy before reaching for it; `GET /api/llm/usage` (admin) is how to see
what it actually costs, rather than estimating.
