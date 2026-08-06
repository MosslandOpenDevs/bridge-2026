# Upgrade runbook

Three changes in this release need something done on the server. Until the
first two are done, the deployed API keeps running the previous entrypoint and
will refuse to start if it is ever restarted into production without a key.

Do them in this order.

## 1. Set `ADMIN_API_KEY` before anything else

The API now **refuses to start** when `NODE_ENV=production` and no admin key is
set. Previously a missing key silently left every admin endpoint anonymous —
proposal creation, finalization, execution, outcome recording, signal
collection and issue detection. Failing to start is the safer failure.

Generate a key and put it in the API's env file (not in the ecosystem file,
which is committed):

```bash
openssl rand -hex 32
```

Add to `oracle/apps/api/.env` on the server:

```
ADMIN_API_KEY=<the generated value>
```

Minimum length is 16 characters; the process rejects anything shorter.

Operators enter this key in the web UI from the key button in the header. It is
held in `sessionStorage` for that tab only, and sent as `x-admin-api-key`. It
is a shared operator secret, not a per-person login — anything running in the
page can read it.

If you would rather not enable the admin surface yet, leave the key unset in a
non-production environment: the endpoints answer `503` instead of running
anonymously. `DEMO_MODE=1` restores anonymous access and is ignored in
production.

## 2. Re-register the API process with PM2

PM2 now runs the compiled output (`./dist/index.js`) instead of `tsx` over the
TypeScript source, so a type error fails the deploy instead of reaching
production.

`pm2 restart` replays the process definition PM2 already stored, so it will
keep launching the old entrypoint. The app must be re-registered. From a
**login shell** on the server:

```bash
cd ~/bridge-2026/oracle && pm2 delete oracle-api && pm2 start ecosystem.config.cjs --only oracle-api && pm2 save
```

Never run this from inside a PM2-managed process, and do not add
`--update-env`: PM2 injects its own config keys (`cron_restart` and friends)
into the environment, and `--update-env` copies them onto the target app. That
is what attached the deploy poller's 5-minute cron to `oracle-web` on
2026-08-05.

Until this step is done the API still works — the TypeScript source and `tsx`
are both still present — but it is running the old entrypoint. Note that
`deploy.sh` already builds the API on every API change, so a type error fails
the deploy from the first tick regardless.

## 3. The deploy gate now requires CI

`DEPLOY_REQUIRE_CI` now defaults to `1`, and the gate is fail-closed: a commit
with no reported checks, a check that is `neutral` or `skipped`, or an
unreachable GitHub API all block the deploy. Previously a commit with no checks
at all deployed anyway.

The required check names come from `DEPLOY_REQUIRED_CHECKS`, defaulting to
`oracle,deploy-script` — the job names in `.github/workflows/ci.yml`. Renaming
a job means updating this variable.

Sanity-check the gate before relying on it:

```bash
cd ~/bridge-2026 && oracle/scripts/deploy.sh --check
```

If GitHub Actions is not enabled for the repository, deploys will stop with
`CI: required check(s) not reported`. Either enable Actions, or set
`DEPLOY_REQUIRE_CI=0` in the poller's environment and accept that commits
deploy unverified.

## What changed that needs no action

- The database migrates itself. New governance tables are created on boot and
  the added `proposals` columns are applied with guarded `ALTER TABLE`
  statements, so an existing `oracle.db` is upgraded in place. Take the usual
  pre-deploy snapshot anyway — `deploy.sh` already does.
- Governance state now survives restarts. Proposals, votes, delegations,
  executions, proofs and trust scores are written to SQLite and restored before
  the server listens. Anything created before this release existed only in
  memory and is already gone.
- Executing a proposal no longer produces an outcome proof. A proof is issued
  only after KPI values are submitted to
  `POST /api/outcomes/:executionId/measurements`, once the observation window
  (`KPI_MEASUREMENT_DELAY_MS`, 24h by default) has elapsed. Executed proposals
  appear as `pending_measurement` until then.
- Success rates are fractions in `[0,1]` everywhere. Any dashboard reading the
  old 0-100 values from `/api/outcomes` or `/api/stats` needs updating.
