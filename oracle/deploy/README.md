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

1. `git fetch` — exits immediately when already at the remote tip
2. Classifies the diff — **docs-only merges (README, docs, nexus/) are not
   deployed at all**: the checkout is left untouched and the next code deploy
   carries them. `oracle/apps/api` → API, `oracle/apps/web` → web,
   `oracle/packages` → both; `oracle/scripts` / `ecosystem.config.cjs` update
   the checkout without build or restart
3. Guards: refuses to touch a checkout that is on another branch or has local
   tracked-file edits; optional CI-green gate (`DEPLOY_REQUIRE_CI=1`)
4. Best-effort SQLite snapshot to `apps/api/data/backup/` before API changes
5. `git reset --hard` to the tip (untracked `.env` / `data/` are never touched;
   the script never runs `git clean`)
6. Build (workspace packages + `next build`) and `pm2 restart` only the
   affected app — never `pm2 restart all` on this shared box
7. Health checks (`/api/health`, web `/`); on failure it **rolls back** to the
   previous commit, rebuilds, and alerts (`DEPLOY_ALERT_WEBHOOK`)

One-time registration on the app server:

```bash
cd ~/bridge-2026/oracle
pm2 start ecosystem.config.cjs --only bridge-deploy
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
