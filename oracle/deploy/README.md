# Deployment

Production runs like ao/algora: nginx on the Lightsail box (13.209.131.190)
terminates SSL for `bridge.moss.land` and reverse-proxies to the pm2 machine,
which runs `oracle-web` (port 3100) and `oracle-api` (port 3101) from
`ecosystem.config.cjs`.

## Auto-deploy

The pm2 machine sits behind NAT, so instead of a push-based CI deploy the
machine polls the repo and redeploys itself when `main` moves
([auto-deploy.sh](auto-deploy.sh)).

One-time setup on the pm2 machine:

```bash
chmod +x /path/to/bridge-2026/oracle/deploy/auto-deploy.sh
crontab -e
# add:
*/2 * * * * /path/to/bridge-2026/oracle/deploy/auto-deploy.sh >> $HOME/bridge-deploy.log 2>&1
```

What each run does:

1. `git fetch` — exits immediately if `origin/main` hasn't moved (cheap; safe every 2 min)
2. `git pull --ff-only` — never force-overwrites local state
3. `pnpm install --frozen-lockfile` + workspace package builds + `next build`
4. `pm2 startOrRestart ecosystem.config.cjs`
5. Health checks `GET /api/health` (API) and `GET /` (web), logging the result

Notes:

- A lock dir prevents overlapping runs; stale locks (>30 min) are cleared automatically.
- Deploy a different branch with `BRIDGE_DEPLOY_BRANCH=<branch>` in the cron line.
- Nothing on GitHub needs secrets or runners — the machine only needs read access to the repo.
- To deploy manually, just run the script directly.

## nginx (Lightsail box)

`bridge.moss.land` should proxy `/api` and `/socket.io` to the pm2 machine's
port 3101 and everything else to port 3100. The API's health endpoint is
exposed at `/api/health` for external uptime monitoring.
