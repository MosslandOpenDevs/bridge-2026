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
pm2 restart ecosystem.config.cjs --update-env
pm2 save
```

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
start) does not register it. Commands given the whole file without `--only`
can: pm2 starts apps from the file that are not running, so the
`pm2 restart ecosystem.config.cjs --update-env` re-registration step above may
switch backups on as a side effect. Add
`--only oracle-api,oracle-web,bridge-deploy` there if that is not wanted yet.

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
gunzip took 0.6s and the quick_check under a second.

```bash
cd ~/bridge-2026/oracle/apps/api
ls -lt data/backup/ && cat data/backup/.last-backup.json
B=data/backup/daily-YYYYMMDD-HHMMSS.db.gz          # the backup to restore

# 1. Check the file before taking anything down.
(cd data/backup && sha256sum -c "$(basename "$B").sha256")

# 2. Stop the API only -- never `pm2 stop all` on this shared box. Avoid doing
#    this while a merge is deploying (tail logs/deploy.log): a deploy tick
#    that changes the API restarts oracle-api.
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
mv data/oracle.db.restoring data/oracle.db

# 6. Start it and check.
pm2 start oracle-api
curl -s localhost:3101/api/health; echo
curl -s localhost:3101/api/stats | head -c 300; echo
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
