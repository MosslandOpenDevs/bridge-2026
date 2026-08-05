#!/usr/bin/env bash
#
# BRIDGE (oracle) pull-based auto-deploy.
#
# Runs ON the application server (the box PM2 lives on) and brings the checkout
# up to origin/main. Idempotent: when HEAD already equals the remote tip it does
# nothing and exits 0, so it is safe to run from PM2's cron every few minutes.
#
# Why pull-based instead of a push from CI: the app server has no public inbound
# route (it is reachable over Tailscale only) and the repo is public, so a
# self-hosted runner would be a footgun. Fetching outbound needs no deploy key,
# no open port, and no GitHub configuration at all. Same rationale and structure
# as Algora's scripts/deploy.sh, adapted for this repo's layout: the git root is
# bridge-2026/ while the pnpm workspace root is bridge-2026/oracle/.
#
# Doc-only pushes (README, docs, nexus/, …) are synced but not deployed: the
# checkout is reset to the tip so on-server docs stay current, but nothing is
# built, restarted, or snapshotted, and the log says SYNCED rather than
# DEPLOYED.
#
# Restarting oracle-api kills any in-flight debate session; that is accepted
# (signal collection and issue detection resume on their own timers).
#
# Usage:
#   oracle/scripts/deploy.sh           # deploy if the remote moved (cron use)
#   oracle/scripts/deploy.sh --check   # report what would happen, change nothing
#   oracle/scripts/deploy.sh --force   # ignore the CI gate and dirty-tree guard
#
# Configuration (env, all optional):
#   DEPLOY_BRANCH          branch to track                     (default: main)
#   DEPLOY_REMOTE          git remote                          (default: origin)
#   DEPLOY_REQUIRE_CI      1 = only deploy CI-green commits    (default: 0 —
#                          this repo has no GitHub Actions yet; flip to 1 when
#                          CI lands)
#   DEPLOY_GITHUB_REPO     owner/name used for the CI query
#   DEPLOY_API_URL         backend health URL                  (:3101)
#   DEPLOY_WEB_URL         frontend health URL                 (:3100)
#   DEPLOY_HEALTH_RETRIES  health poll attempts                (default: 20)
#   DEPLOY_HEALTH_INTERVAL seconds between attempts            (default: 3)
#   DEPLOY_ALERT_WEBHOOK   Slack/Discord webhook for failures  (default: none)
#   DEPLOY_VERBOSE         1 = also log no-op ticks            (default: 0)
#   PM2_BIN / PNPM_BIN / GITHUB_TOKEN
#
# Data safety: this script only ever runs `git reset --hard`, which leaves
# untracked files alone. It must NEVER run `git clean` — .env and
# oracle/apps/api/data/ (oracle.db and backups) live on the server untracked.

set -euo pipefail

# ---------------------------------------------------------------------------
# Env hygiene. When this script runs under PM2 (the bridge-deploy poller),
# PM2 injects the poller's OWN process config into the environment as plain
# variables -- cron_restart, autorestart, watch, ... -- and PM2 reads those
# same names back as config keys. Any `pm2 ... --update-env` (or `pm2 start`)
# executed with them present stamps the poller's config onto the target app:
# exactly this attached the deploy cron (3-59/5) to oracle-web, force-
# restarting it every 5 minutes (2026-08-05 incident, first found in
# agentic-orchestrator -- see its docs/deployment.md "cron_restart 오염").
# Scrub them so no pm2 invocation in this script can inherit them.
# ---------------------------------------------------------------------------
unset -v cron_restart autorestart watch instances exec_mode \
         max_memory_restart node_args name namespace || true

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)     # bridge-2026/oracle — pnpm/pm2 root
REPO_ROOT=$(cd -- "${APP_ROOT}/.." && pwd)      # bridge-2026 — git root
cd "${REPO_ROOT}"

DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
DEPLOY_REMOTE=${DEPLOY_REMOTE:-origin}
DEPLOY_REQUIRE_CI=${DEPLOY_REQUIRE_CI:-0}
DEPLOY_GITHUB_REPO=${DEPLOY_GITHUB_REPO:-MosslandOpenDevs/bridge-2026}
DEPLOY_API_URL=${DEPLOY_API_URL:-http://127.0.0.1:3101}
DEPLOY_WEB_URL=${DEPLOY_WEB_URL:-http://127.0.0.1:3100}
DEPLOY_HEALTH_RETRIES=${DEPLOY_HEALTH_RETRIES:-20}
DEPLOY_HEALTH_INTERVAL=${DEPLOY_HEALTH_INTERVAL:-3}
DEPLOY_ALERT_WEBHOOK=${DEPLOY_ALERT_WEBHOOK:-}
DEPLOY_VERBOSE=${DEPLOY_VERBOSE:-0}
DEPLOY_LOG=${DEPLOY_LOG:-${APP_ROOT}/logs/deploy.log}
DEPLOY_LOCK=${DEPLOY_LOCK:-${APP_ROOT}/logs/.deploy.lock}
DEPLOY_LOCK_STALE_MIN=${DEPLOY_LOCK_STALE_MIN:-90}

PM2_BIN=${PM2_BIN:-pm2}
PNPM_BIN=${PNPM_BIN:-pnpm}

FORCE=0
CHECK_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,43p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
  shift
done

log() {
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "${line}"
  mkdir -p "$(dirname "${DEPLOY_LOG}")" 2>/dev/null || true
  echo "${line}" >>"${DEPLOY_LOG}" 2>/dev/null || true
}

json_string() {
  node -e 'console.log(JSON.stringify(process.argv[1]))' "$1" 2>/dev/null \
    || printf '"%s"' "$1"
}

# Only reaches the operator when a webhook is configured; never fatal itself.
alert() {
  [ -n "${DEPLOY_ALERT_WEBHOOK}" ] || return 0
  local text="$1"
  curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "$(printf '{"text":%s,"content":%s}' \
            "$(json_string "${text}")" "$(json_string "${text}")")" \
    "${DEPLOY_ALERT_WEBHOOK}" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Single-flight lock. A crash mid-deploy would otherwise wedge every later tick,
# so a lock older than DEPLOY_LOCK_STALE_MIN is reclaimed.
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "${DEPLOY_LOCK}")"
if ! mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
  if [ -n "$(find "${DEPLOY_LOCK}" -maxdepth 0 -mmin "+${DEPLOY_LOCK_STALE_MIN}" 2>/dev/null)" ]; then
    log "WARN stale lock older than ${DEPLOY_LOCK_STALE_MIN}m -- reclaiming"
    rm -rf "${DEPLOY_LOCK}"
    mkdir "${DEPLOY_LOCK}" 2>/dev/null || { log "could not reclaim lock; skipping"; exit 0; }
  else
    [ "${DEPLOY_VERBOSE}" = "1" ] && log "another deploy is running -- skipping"
    exit 0
  fi
fi
trap 'rm -rf "${DEPLOY_LOCK}" 2>/dev/null || true' EXIT

# ---------------------------------------------------------------------------
# 1. Is there anything to deploy?
# ---------------------------------------------------------------------------
git fetch --quiet "${DEPLOY_REMOTE}" "${DEPLOY_BRANCH}" || {
  log "WARN git fetch failed -- will retry next tick"
  exit 0
}

CURRENT=$(git rev-parse HEAD)
TARGET=$(git rev-parse "${DEPLOY_REMOTE}/${DEPLOY_BRANCH}")

if [ "${CURRENT}" = "${TARGET}" ]; then
  if [ "${DEPLOY_VERBOSE}" = "1" ] || [ "${CHECK_ONLY}" = "1" ]; then
    log "up to date at ${CURRENT:0:8}"
  fi
  exit 0
fi

CHANGED=$(git diff --name-only "${CURRENT}" "${TARGET}")
SUBJECT=$(git log -1 --format='%s' "${TARGET}")

# What kind of change is this? Everything lives under oracle/ — nexus/ and root
# docs never require a build or restart. oracle/packages/* and the workspace
# config feed both apps, so they mark both. oracle/scripts/* and the ecosystem
# file are deploy infrastructure: they must reach the server (the script
# self-updates via the reset) but need no build or restart.
API_CHANGED=0
WEB_CHANGED=0
DEPS_CHANGED=0
ECOSYSTEM_CHANGED=0
INFRA_CHANGED=0
while IFS= read -r f; do
  [ -n "${f}" ] || continue
  case "${f}" in
    oracle/apps/api/*) API_CHANGED=1 ;;
    oracle/apps/web/*) WEB_CHANGED=1 ;;
    oracle/packages/*|oracle/package.json|oracle/turbo.json|oracle/tsconfig*.json) API_CHANGED=1; WEB_CHANGED=1 ;;
    oracle/scripts/*) INFRA_CHANGED=1 ;;
  esac
  case "${f}" in
    oracle/pnpm-lock.yaml) DEPS_CHANGED=1; API_CHANGED=1; WEB_CHANGED=1 ;;
    oracle/ecosystem.config.cjs) ECOSYSTEM_CHANGED=1 ;;
  esac
done <<EOF
${CHANGED}
EOF

# Docs-only pushes (README, docs/, nexus/, …) are synced, not deployed: the
# checkout is brought to the tip so on-server docs stay current, but there is
# no build, restart, or snapshot, and the log distinguishes SYNCED from
# DEPLOYED. Once synced, HEAD equals the tip, so repeat ticks stay quiet.
DOCS_ONLY=0
if [ "${API_CHANGED}" = "0" ] && [ "${WEB_CHANGED}" = "0" ] \
   && [ "${ECOSYSTEM_CHANGED}" = "0" ] && [ "${INFRA_CHANGED}" = "0" ]; then
  DOCS_ONLY=1
fi

if [ "${DOCS_ONLY}" = "1" ]; then
  [ "${CHECK_ONLY}" = "1" ] || log "docs-only change ${CURRENT:0:8} -> ${TARGET:0:8} (${SUBJECT}) -- syncing checkout, no deploy"
else
  log "update available: ${CURRENT:0:8} -> ${TARGET:0:8} (${SUBJECT})"
fi

# ---------------------------------------------------------------------------
# 2. Guards
# ---------------------------------------------------------------------------
BRANCH_NOW=$(git rev-parse --abbrev-ref HEAD)
if [ "${BRANCH_NOW}" != "${DEPLOY_BRANCH}" ] && [ "${FORCE}" = "0" ]; then
  log "ABORT checkout is on '${BRANCH_NOW}', not '${DEPLOY_BRANCH}' -- not touching it"
  exit 0
fi

# Tracked-file edits made by hand on the server would be silently discarded by
# the reset below, so stop and let a human look. Untracked files (.env, the DB)
# are never at risk and are deliberately not checked.
if [ -n "$(git status --porcelain --untracked-files=no)" ] && [ "${FORCE}" = "0" ]; then
  log "ABORT working tree has local modifications to tracked files:"
  git status --short --untracked-files=no | while read -r l; do log "       ${l}"; done
  log "       resolve on the server, or re-run with --force to discard them"
  alert "BRIDGE deploy blocked: local modifications on the server checkout"
  exit 0
fi

# CI gate: deploy only commits GitHub Actions has gone green on.
ci_conclusion() {
  local sha="$1" url auth
  url="https://api.github.com/repos/${DEPLOY_GITHUB_REPO}/commits/${sha}/check-runs"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth="Authorization: Bearer ${GITHUB_TOKEN}"
  else
    auth="X-No-Auth: 1"
  fi
  curl -fsS -m 20 -H 'Accept: application/vnd.github+json' -H "${auth}" "${url}" 2>/dev/null \
    | node -e '
let raw = "";
process.stdin.on("data", d => (raw += d));
process.stdin.on("end", () => {
  let runs;
  try { runs = JSON.parse(raw).check_runs || []; }
  catch { console.log("unknown"); return; }
  if (!runs.length) { console.log("none"); return; }
  const bad = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure"]);
  if (runs.some(r => r.status !== "completed")) console.log("pending");
  else if (runs.some(r => bad.has(r.conclusion))) console.log("failure");
  else console.log("success");
});
' 2>/dev/null || echo "unknown"
}

if [ "${DEPLOY_REQUIRE_CI}" = "1" ] && [ "${FORCE}" = "0" ] && [ "${DOCS_ONLY}" = "0" ]; then
  CI_STATUS=$(ci_conclusion "${TARGET}")
  case "${CI_STATUS}" in
    success) log "CI: green" ;;
    none)    log "CI: no checks reported for this commit -- proceeding" ;;
    pending) log "CI: still running -- deferring to next tick"; exit 0 ;;
    failure) log "CI: FAILED -- refusing to deploy ${TARGET:0:8}"
             alert "BRIDGE deploy skipped: CI failed on ${TARGET:0:8} (${SUBJECT})"
             exit 0 ;;
    *)       log "CI: status unavailable (network/API) -- deferring to next tick"; exit 0 ;;
  esac
fi

if [ "${CHECK_ONLY}" = "1" ]; then
  if [ "${DOCS_ONLY}" = "1" ]; then
    log "--check: docs-only change ${CURRENT:0:8} -> ${TARGET:0:8} -- would sync checkout (no deploy)"
  else
    log "--check: would deploy ${TARGET:0:8} (api=${API_CHANGED} web=${WEB_CHANGED} \
deps=${DEPS_CHANGED} ecosystem=${ECOSYSTEM_CHANGED} infra=${INFRA_CHANGED})"
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Deploy
# ---------------------------------------------------------------------------

# Pre-deploy snapshot of the SQLite DB (non-fatal): a restore point from
# immediately before this change. Uses sqlite3's online .backup when available.
DB_FILE="${APP_ROOT}/apps/api/data/oracle.db"
if [ "${API_CHANGED}" = "1" ] && [ -f "${DB_FILE}" ] && command -v sqlite3 >/dev/null 2>&1; then
  BACKUP_DIR="${APP_ROOT}/apps/api/data/backup"
  mkdir -p "${BACKUP_DIR}"
  if sqlite3 "${DB_FILE}" ".backup '${BACKUP_DIR}/pre-deploy-$(date +%Y%m%d-%H%M%S).db'" 2>/dev/null; then
    log "pre-deploy DB snapshot written to apps/api/data/backup/"
    ls -1t "${BACKUP_DIR}"/pre-deploy-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f
  else
    log "WARN pre-deploy DB snapshot failed (continuing)"
  fi
fi

# Build + restart for whatever the current checkout is. Used for the deploy and,
# unchanged, for the rollback -- so a rollback restores a consistent build too.
#
# NOTE: never `pnpm build` at the workspace root here — @oracle/api's own tsc
# build has known pre-existing type errors (the API runs via tsx and does not
# need a build). Build only the API's workspace dependencies plus the web app.
#
# `set -e` does not apply inside a function invoked as an `if` condition, so
# every step propagates its own failure explicitly.
build_and_restart() {
  local api="$1" web="$2" deps="$3"

  cd "${APP_ROOT}"

  if [ "${deps}" = "1" ]; then
    # CI=true keeps pnpm non-interactive over a non-TTY session.
    log "pnpm install --frozen-lockfile (lockfile changed)"
    CI=true "${PNPM_BIN}" install --frozen-lockfile --reporter=silent \
      || { log "ERROR pnpm install failed"; return 1; }
  fi

  if [ "${api}" = "1" ]; then
    log "pnpm --filter @oracle/api^... build (workspace deps)"
    "${PNPM_BIN}" --filter "@oracle/api^..." build >/dev/null 2>&1 \
      || { log "ERROR workspace package build failed"; return 1; }
  fi
  if [ "${web}" = "1" ]; then
    # NEXT_PUBLIC_* is baked in at web build time, so restarting alone would
    # serve stale env. Turbo caches unchanged packages.
    log "pnpm --filter @oracle/web... build"
    "${PNPM_BIN}" --filter "@oracle/web..." build >/dev/null 2>&1 \
      || { log "ERROR web build failed"; return 1; }
  fi

  # No --update-env on these restarts. It would merge THIS process's
  # environment into the target app's stored definition -- and under PM2 that
  # environment carries the deploy poller's own config keys (cron_restart & co,
  # scrubbed at the top but a future edit could reintroduce one) plus
  # deploy-only values like GITHUB_TOKEN. The apps' env is registered once from
  # ecosystem.config.cjs; a plain restart preserves it (2026-08-05 incident).
  if [ "${api}" = "1" ]; then
    log "pm2 restart oracle-api"
    "${PM2_BIN}" restart oracle-api >/dev/null \
      || { log "ERROR pm2 restart oracle-api failed"; return 1; }
  fi
  if [ "${web}" = "1" ]; then
    log "pm2 restart oracle-web"
    "${PM2_BIN}" restart oracle-web >/dev/null \
      || { log "ERROR pm2 restart oracle-web failed"; return 1; }
  fi
  # Never `pm2 restart all` here: the box hosts ~20 unrelated projects.

  cd "${REPO_ROOT}"
}

health_ok() {
  local i=0
  while [ "${i}" -lt "${DEPLOY_HEALTH_RETRIES}" ]; do
    local api_ok=1 web_ok=1
    if [ "${API_CHANGED}" = "1" ] || [ "${ROLLING_BACK:-0}" = "1" ]; then
      curl -fsS -m 5 "${DEPLOY_API_URL}/api/health" >/dev/null 2>&1 || api_ok=0
    fi
    if [ "${WEB_CHANGED}" = "1" ] || [ "${ROLLING_BACK:-0}" = "1" ]; then
      curl -fsSL -m 8 -o /dev/null "${DEPLOY_WEB_URL}/" 2>/dev/null || web_ok=0
    fi
    if [ "${api_ok}" = "1" ] && [ "${web_ok}" = "1" ]; then
      return 0
    fi
    i=$((i + 1))
    sleep "${DEPLOY_HEALTH_INTERVAL}"
  done
  return 1
}

rollback() {
  ROLLING_BACK=1
  log "ROLLBACK -> ${CURRENT:0:8}"
  git reset --hard --quiet "${CURRENT}"
  if build_and_restart "${API_CHANGED}" "${WEB_CHANGED}" "${DEPS_CHANGED}"; then
    if health_ok; then
      log "rollback healthy at ${CURRENT:0:8}"
      alert "BRIDGE deploy of ${TARGET:0:8} failed; rolled back to ${CURRENT:0:8} (healthy)"
      return 0
    fi
  fi
  log "CRITICAL rollback did not come back healthy -- manual intervention needed"
  alert "BRIDGE CRITICAL: deploy of ${TARGET:0:8} failed AND rollback to ${CURRENT:0:8} is unhealthy"
  return 1
}

log "checking out ${TARGET:0:8}"
git reset --hard --quiet "${TARGET}"

if [ "${ECOSYSTEM_CHANGED}" = "1" ]; then
  log "NOTE ecosystem.config.cjs changed -- process definitions (cron, env) are"
  log "     NOT re-registered automatically. Run on the server when convenient:"
  log "     cd oracle && pm2 restart ecosystem.config.cjs --update-env && pm2 save"
  log "     (from a login shell only -- never from inside a PM2-managed process:"
  log "      PM2 injects config keys like cron_restart into the environment and"
  log "      --update-env would copy them onto every app)"
fi

if [ "${API_CHANGED}" = "0" ] && [ "${WEB_CHANGED}" = "0" ]; then
  if [ "${DOCS_ONLY}" = "1" ]; then
    log "SYNCED ${CURRENT:0:8} -> ${TARGET:0:8} (docs only -- no deploy)"
  else
    log "DEPLOYED ${CURRENT:0:8} -> ${TARGET:0:8} (deploy scripts/config only -- checkout updated, no build or restart)"
  fi
  exit 0
fi

if ! build_and_restart "${API_CHANGED}" "${WEB_CHANGED}" "${DEPS_CHANGED}"; then
  log "ERROR build/restart failed"
  rollback || exit 1
  exit 1
fi

if ! health_ok; then
  log "ERROR health check failed after deploy"
  rollback || exit 1
  exit 1
fi

log "DEPLOYED ${CURRENT:0:8} -> ${TARGET:0:8}"
git log --oneline "${CURRENT}..${TARGET}" | head -10 | while read -r l; do log "       ${l}"; done
exit 0
