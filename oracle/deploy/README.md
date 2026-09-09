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
7. Health checks (`/api/health`, web `/`); on failure it **rolls back** to the
   last successful deploy, rebuilds, and alerts (`DEPLOY_ALERT_WEBHOOK`)

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

## nginx (Lightsail box)

`bridge.moss.land` proxies `/api` and `/socket.io` to the app server's port
3101 and everything else to port 3100. The API's health endpoint is exposed at
`/api/health` for external uptime monitoring.

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
