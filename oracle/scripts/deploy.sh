#!/usr/bin/env bash
# shellcheck disable=SC2317  # the trailing `exit $?` is deliberately "unreachable"
#
# BRIDGE (oracle) pull-based auto-deploy.
#
# Runs ON the application server (the box PM2 lives on) and brings the checkout
# up to origin/main. Idempotent: when the last successful deploy already equals
# the remote tip it does nothing and exits 0, so it is safe to run from PM2's
# cron every few minutes.
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
# Deploy state: "what is deployed" is the SHA in .git/bridge-deployed-sha, NOT
# HEAD. It is written only after a fully successful tick (build + restart +
# health), so a tick that dies mid-deploy (reboot, kill -9) leaves the old
# value in place and the whole span is retried next tick instead of being
# mistaken for done. A commit that keeps failing is retried
# DEPLOY_MAX_FAILURES times, then parked (with one alert) until a new commit
# lands; the memory lives in logs/.deploy.failed and clears on success.
#
# The entire body of this script lives inside main(), called on the last line:
# the `git reset --hard` below rewrites this very file while it is running.
# Bash reads top-level statements from the file AS it executes them, so
# sequential top-level code after the reset could resume at a garbage offset
# in the NEW file; a fully parsed function runs from memory and is immune.
#
# Usage:
#   oracle/scripts/deploy.sh           # deploy if the remote moved (cron use)
#   oracle/scripts/deploy.sh --check   # report what would happen, change nothing
#   oracle/scripts/deploy.sh --force   # override the CI gate, the dirty-tree
#                                      # and local-commit guards, and fail parking
#
# Configuration (env, all optional):
#   DEPLOY_BRANCH          branch to track                     (default: main)
#   DEPLOY_REMOTE          git remote                          (default: origin)
#   DEPLOY_REQUIRE_CI      1 = only deploy CI-green commits    (default: 1)
#                          Fail-closed: a commit with no reported checks, a
#                          not-green check, or an unreachable API all block the
#                          deploy. Set to 0 only if you accept deploying
#                          unverified commits.
#   DEPLOY_REQUIRED_CHECKS comma-separated check-run names that must each be
#                          present and successful
#                          (default: oracle,deploy-script — the job names in
#                          .github/workflows/ci.yml)
#   DEPLOY_GITHUB_REPO     owner/name used for the CI query
#   DEPLOY_API_URL         backend health URL                  (:3101)
#   DEPLOY_WEB_URL         frontend health URL                 (:3100)
#   DEPLOY_HEALTH_RETRIES  health poll attempts                (default: 20)
#   DEPLOY_HEALTH_INTERVAL seconds between attempts            (default: 3)
#   DEPLOY_MAX_FAILURES    park a commit after this many failed
#                          deploy attempts                     (default: 3)
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
SELF="${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")"  # absolute: survives the cd below
APP_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)     # bridge-2026/oracle — pnpm/pm2 root
REPO_ROOT=$(cd -- "${APP_ROOT}/.." && pwd)      # bridge-2026 — git root
cd "${REPO_ROOT}"

DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
DEPLOY_REMOTE=${DEPLOY_REMOTE:-origin}
DEPLOY_REQUIRE_CI=${DEPLOY_REQUIRE_CI:-1}
DEPLOY_REQUIRED_CHECKS=${DEPLOY_REQUIRED_CHECKS:-oracle,deploy-script}
DEPLOY_GITHUB_REPO=${DEPLOY_GITHUB_REPO:-MosslandOpenDevs/bridge-2026}
DEPLOY_API_URL=${DEPLOY_API_URL:-http://127.0.0.1:3101}
DEPLOY_WEB_URL=${DEPLOY_WEB_URL:-http://127.0.0.1:3100}
DEPLOY_HEALTH_RETRIES=${DEPLOY_HEALTH_RETRIES:-20}
DEPLOY_HEALTH_INTERVAL=${DEPLOY_HEALTH_INTERVAL:-3}
DEPLOY_MAX_FAILURES=${DEPLOY_MAX_FAILURES:-3}
DEPLOY_ALERT_WEBHOOK=${DEPLOY_ALERT_WEBHOOK:-}
DEPLOY_VERBOSE=${DEPLOY_VERBOSE:-0}
DEPLOY_LOG=${DEPLOY_LOG:-${APP_ROOT}/logs/deploy.log}
DEPLOY_LOCK=${DEPLOY_LOCK:-${APP_ROOT}/logs/.deploy.lock}
DEPLOY_LOCK_STALE_MIN=${DEPLOY_LOCK_STALE_MIN:-90}
# Last SUCCESSFUL deploy. Lives inside .git/ so neither the builds nor the
# reset below can ever sweep it away.
DEPLOY_STATE=${DEPLOY_STATE:-$(git rev-parse --absolute-git-dir)/bridge-deployed-sha}
# "<sha> <count>" of the commit currently failing to deploy (logs/ is untracked).
DEPLOY_FAIL_STATE=${DEPLOY_FAIL_STATE:-${APP_ROOT}/logs/.deploy.failed}

PM2_BIN=${PM2_BIN:-pm2}
PNPM_BIN=${PNPM_BIN:-pnpm}

FORCE=0
CHECK_ONLY=0
CLASSIFY_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --check) CHECK_ONLY=1 ;;
    --classify) CLASSIFY_ONLY=1 ;;
    -h|--help) sed -n '2,43p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
  shift
done

# What kind of change is this? Everything lives under oracle/ — nexus/ and root
# docs never require a build or restart. oracle/packages/* and the workspace
# config feed both apps, so they mark both. oracle/scripts/* and the ecosystem
# file are deploy infrastructure: they must reach the server (the script
# self-updates via the reset) but need no build or restart.
#
# Sets API_CHANGED / WEB_CHANGED / DEPS_CHANGED / ECOSYSTEM_CHANGED /
# INFRA_CHANGED / DOCS_ONLY from a newline-separated file list on stdin.
# Exercised directly by scripts/test-deploy-classifier.sh — a path in the wrong
# bucket means either a deploy that skips the build it needed, or a rebuild and
# restart for a README edit.
classify_changes() {
  API_CHANGED=0
  WEB_CHANGED=0
  DEPS_CHANGED=0
  ECOSYSTEM_CHANGED=0
  INFRA_CHANGED=0

  local f
  while IFS= read -r f; do
    [ -n "${f}" ] || continue
    case "${f}" in
      oracle/apps/api/*) API_CHANGED=1 ;;
      oracle/apps/web/*) WEB_CHANGED=1 ;;
      # Workspace-wide config: pnpm-workspace.yaml decides which packages exist
      # at all, and eslint.config.js gates the lint step both apps run.
      oracle/packages/*|oracle/package.json|oracle/turbo.json|oracle/tsconfig*.json|oracle/pnpm-workspace.yaml|oracle/eslint.config.js)
        API_CHANGED=1; WEB_CHANGED=1 ;;
      oracle/scripts/*) INFRA_CHANGED=1 ;;
    esac
    case "${f}" in
      oracle/pnpm-lock.yaml) DEPS_CHANGED=1; API_CHANGED=1; WEB_CHANGED=1 ;;
      oracle/ecosystem.config.cjs) ECOSYSTEM_CHANGED=1 ;;
    esac
  done

  # Docs-only pushes (README, docs/, nexus/, …) are synced, not deployed: the
  # checkout is brought to the tip so on-server docs stay current, but there is
  # no build, restart, or snapshot, and the log distinguishes SYNCED from
  # DEPLOYED. Once synced, HEAD equals the tip, so repeat ticks stay quiet.
  DOCS_ONLY=0
  if [ "${API_CHANGED}" = "0" ] && [ "${WEB_CHANGED}" = "0" ] \
     && [ "${ECOSYSTEM_CHANGED}" = "0" ] && [ "${INFRA_CHANGED}" = "0" ]; then
    DOCS_ONLY=1
  fi
}


# Test hook: classify the file list on stdin and print the flags, without
# touching git, the lock, or PM2.
if [ "${CLASSIFY_ONLY}" = "1" ]; then
  classify_changes
  echo "api=${API_CHANGED} web=${WEB_CHANGED} deps=${DEPS_CHANGED} ecosystem=${ECOSYSTEM_CHANGED} infra=${INFRA_CHANGED} docs_only=${DOCS_ONLY}"
  exit 0
fi


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
# Single-flight lock. The lock directory records its owner's PID so a tick
# that crashed (kill -9, reboot) is reclaimed on the NEXT tick instead of
# wedging deploys for DEPLOY_LOCK_STALE_MIN. A lock whose owner is still
# alive is never reclaimed on age alone: removing it under a live deploy
# would start a second one on top of it (double build, interleaved pm2
# restarts). A long-lived live holder is logged so an operator can decide.
# The age-based reclaim survives only as a fallback for locks with no
# readable PID (writer died between mkdir and the pid write).
# ---------------------------------------------------------------------------
acquire_lock() {
  if mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
    echo "$$" >"${DEPLOY_LOCK}/pid" 2>/dev/null || true
    return 0
  fi

  local owner
  owner=$(cat "${DEPLOY_LOCK}/pid" 2>/dev/null || true)
  if [ -n "${owner}" ]; then
    if kill -0 "${owner}" 2>/dev/null; then
      # Alive -- but after a reboot the PID may belong to an unrelated
      # process, so check it still looks like a deploy run.
      if ps -o args= -p "${owner}" 2>/dev/null | grep -q "deploy.sh"; then
        if [ -n "$(find "${DEPLOY_LOCK}" -maxdepth 0 -mmin "+${DEPLOY_LOCK_STALE_MIN}" 2>/dev/null)" ]; then
          log "WARN deploy PID ${owner} has held the lock over ${DEPLOY_LOCK_STALE_MIN}m -- NOT reclaiming; inspect it (kill it or rm -rf ${DEPLOY_LOCK} to clear)"
        elif [ "${DEPLOY_VERBOSE}" = "1" ]; then
          log "another deploy is running (PID ${owner}) -- skipping"
        fi
        return 1
      fi
      log "WARN lock PID ${owner} is alive but not a deploy.sh run (PID recycled after reboot?) -- reclaiming"
    else
      log "WARN lock owner PID ${owner} is gone (crashed tick) -- reclaiming"
    fi
  else
    if [ -z "$(find "${DEPLOY_LOCK}" -maxdepth 0 -mmin "+${DEPLOY_LOCK_STALE_MIN}" 2>/dev/null)" ]; then
      [ "${DEPLOY_VERBOSE}" = "1" ] && log "another deploy is running -- skipping"
      return 1
    fi
    log "WARN stale lock older than ${DEPLOY_LOCK_STALE_MIN}m with no owner PID -- reclaiming"
  fi

  rm -rf "${DEPLOY_LOCK}"
  mkdir "${DEPLOY_LOCK}" 2>/dev/null || { log "could not reclaim lock; skipping"; return 1; }
  echo "$$" >"${DEPLOY_LOCK}/pid" 2>/dev/null || true
  return 0
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

classify_changes <<EOF
${CHANGED}
EOF

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

# CI gate: deploy only commits the required checks have gone green on.
#
# Fail-closed. Every non-success answer -- including "this commit reported no
# checks at all" -- blocks the deploy. The previous version proceeded when a
# commit had no check runs, which is indistinguishable from CI never having
# started, and counted a completed run as success unless its conclusion was on
# a blocklist, so `neutral` and `skipped` passed the gate.
#
# DEPLOY_REQUIRED_CHECKS names the checks that must each be present and
# successful (comma-separated; defaults to the job names in
# .github/workflows/ci.yml). Extra checks beyond those are ignored, so adding
# an unrelated workflow cannot silently block deploys.
ci_conclusion() {
  local sha="$1" url auth
  url="https://api.github.com/repos/${DEPLOY_GITHUB_REPO}/commits/${sha}/check-runs?per_page=100"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth="Authorization: Bearer ${GITHUB_TOKEN}"
  else
    auth="X-No-Auth: 1"
  fi
  curl -fsS -m 20 -H 'Accept: application/vnd.github+json' -H "${auth}" "${url}" 2>/dev/null \
    | REQUIRED_CHECKS="${DEPLOY_REQUIRED_CHECKS}" node -e '
let raw = "";
process.stdin.on("data", d => (raw += d));
process.stdin.on("end", () => {
  let runs;
  try { runs = JSON.parse(raw).check_runs || []; }
  catch { console.log("unknown"); return; }

  const required = (process.env.REQUIRED_CHECKS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!required.length) { console.log("misconfigured"); return; }

  // Latest run per name: a re-run supersedes the earlier attempt.
  const latest = new Map();
  for (const run of runs) {
    const previous = latest.get(run.name);
    const at = Date.parse(run.started_at || run.completed_at || 0) || 0;
    if (!previous || at >= previous.at) latest.set(run.name, { run, at });
  }

  const missing = required.filter(name => !latest.has(name));
  if (missing.length) { console.log("missing:" + missing.join("+")); return; }

  const states = required.map(name => latest.get(name).run);
  if (states.some(r => r.status !== "completed")) { console.log("pending"); return; }

  // Only an explicit success passes; neutral, skipped, stale and anything
  // unrecognized are treated as not-green.
  const notGreen = states.filter(r => r.conclusion !== "success");
  if (notGreen.length) {
    console.log("failure:" + notGreen.map(r => `${r.name}=${r.conclusion}`).join("+"));
    return;
  }
  console.log("success");
});
' 2>/dev/null || echo "unknown"
}

if [ "${DEPLOY_REQUIRE_CI}" = "1" ] && [ "${FORCE}" = "0" ] && [ "${DOCS_ONLY}" = "0" ]; then
  CI_STATUS=$(ci_conclusion "${TARGET}")
  case "${CI_STATUS}" in
    success)
      log "CI: green (${DEPLOY_REQUIRED_CHECKS})" ;;
    pending)
      log "CI: still running -- deferring to next tick"; exit 0 ;;
    missing:*)
      log "CI: required check(s) not reported for ${TARGET:0:8}: ${CI_STATUS#missing:}"
      log "    refusing to deploy (set DEPLOY_REQUIRE_CI=0 or --force to override)"
      alert "BRIDGE deploy blocked: CI has not reported ${CI_STATUS#missing:} on ${TARGET:0:8}"
      exit 0 ;;
    failure:*)
      log "CI: NOT GREEN on ${TARGET:0:8}: ${CI_STATUS#failure:}"
      alert "BRIDGE deploy skipped: CI not green on ${TARGET:0:8} (${SUBJECT})"
      exit 0 ;;
    misconfigured)
      log "CI: DEPLOY_REQUIRED_CHECKS is empty -- refusing to deploy"
      exit 0 ;;
    *)
      log "CI: status unavailable (network/API) -- deferring to next tick"; exit 0 ;;
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
    # The API deploys as compiled output: build the workspace packages plus
    # @oracle/api itself into apps/api/dist, which is what PM2 runs (node
    # dist/index.js -- see ecosystem.config.cjs). A commit that does not
    # compile fails HERE, before any restart, and triggers the rollback.
    log "pnpm --filter @oracle/api... build"
    "${PNPM_BIN}" --filter "@oracle/api..." build >/dev/null 2>&1 \
      || { log "ERROR api build failed"; return 1; }
  fi
  if [ "${web}" = "1" ]; then
    # NEXT_PUBLIC_* is baked in at web build time, so restarting alone would
    # serve stale env. Built into .next.new and swapped in only on success:
    # `next build` empties its output dir when it STARTS, so building straight
    # into the live .next would strip the running site's assets the moment a
    # build begins -- and a failed build would leave it that way.
    log "pnpm --filter @oracle/web... build (into .next.new)"
    rm -rf apps/web/.next.new
    NEXT_DIST_DIR=".next.new" "${PNPM_BIN}" --filter "@oracle/web..." build >/dev/null 2>&1 \
      || { log "ERROR web build failed -- live .next left untouched"; return 1; }
    [ -d apps/web/.next.new ] \
      || { log "ERROR web build produced no .next.new"; return 1; }
    rm -rf apps/web/.next.old
    if [ -d apps/web/.next ]; then mv apps/web/.next apps/web/.next.old; fi
    mv apps/web/.next.new apps/web/.next
    rm -rf apps/web/.next.old
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

# Roll back to the last SUCCESSFUL deploy (not merely the pre-tick HEAD: when
# a previous tick died between its reset and its restarts, HEAD already points
# at the never-deployed tip and only DEPLOYED names a known-good state).
rollback() {
  ROLLING_BACK=1
  log "ROLLBACK -> ${DEPLOYED:0:8} (last successful deploy)"
  git reset --hard --quiet "${DEPLOYED}"
  if build_and_restart "${API_CHANGED}" "${WEB_CHANGED}" "${DEPS_CHANGED}"; then
    if health_ok; then
      log "rollback healthy at ${DEPLOYED:0:8}"
      alert "BRIDGE deploy of ${TARGET:0:8} failed; rolled back to ${DEPLOYED:0:8} (healthy)"
      return 0
    fi
  fi
  log "CRITICAL rollback did not come back healthy -- manual intervention needed"
  alert "BRIDGE CRITICAL: deploy of ${TARGET:0:8} failed AND rollback to ${DEPLOYED:0:8} is unhealthy"
  return 1
}

# One more failed attempt at TARGET; parks it (with a single alert) once the
# count reaches DEPLOY_MAX_FAILURES so a genuinely broken commit does not
# restart the apps and page the operator every five minutes forever.
record_failure() {
  FAILED_COUNT=$((FAILED_COUNT + 1))
  printf '%s %s\n' "${TARGET}" "${FAILED_COUNT}" >"${DEPLOY_FAIL_STATE}" 2>/dev/null \
    || log "WARN could not write ${DEPLOY_FAIL_STATE}"
  if [ "${FAILED_COUNT}" -ge "${DEPLOY_MAX_FAILURES}" ]; then
    log "deploy of ${TARGET:0:8} has failed ${FAILED_COUNT}x -- parking it until a new commit lands (--force retries now)"
    alert "BRIDGE deploy: ${TARGET:0:8} failed ${FAILED_COUNT}x -- giving up until a new commit lands"
  fi
}

# Only a fully successful tick moves the deployed-SHA state forward; anything
# less leaves the old value so the whole span is retried next tick.
record_success() {
  printf '%s\n' "${TARGET}" >"${DEPLOY_STATE}" \
    || { log "ERROR cannot write ${DEPLOY_STATE}"; return 1; }
  rm -f "${DEPLOY_FAIL_STATE}" 2>/dev/null || true
  if [ -n "${SNAP_TAKEN}" ]; then
    # Remember which snapshot captured the DB right before this (successful)
    # deploy: rotation spares it, so however long a later incident grinds on,
    # the restore point from before the last good code change survives.
    printf '%s\n' "${SNAP_TAKEN}" >"${BACKUP_DIR}/.last-success-snapshot" 2>/dev/null \
      || log "WARN could not record last-success snapshot name"
  fi
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) FORCE=1 ;;
      --check) CHECK_ONLY=1 ;;
      -h|--help) sed -n '4,66p' "${SELF}" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) echo "unknown option: $1" >&2; exit 64 ;;
    esac
    shift
  done

  mkdir -p "$(dirname "${DEPLOY_LOCK}")"
  acquire_lock || exit 0
  trap 'rm -rf "${DEPLOY_LOCK}" 2>/dev/null || true' EXIT

  # -------------------------------------------------------------------------
  # 1. Is there anything to deploy?
  # -------------------------------------------------------------------------
  git fetch --quiet "${DEPLOY_REMOTE}" "${DEPLOY_BRANCH}" || {
    log "WARN git fetch failed -- will retry next tick"
    exit 0
  }

  CURRENT=$(git rev-parse HEAD)
  TARGET=$(git rev-parse "${DEPLOY_REMOTE}/${DEPLOY_BRANCH}")

  # What is actually deployed. Falls back to HEAD when the state file is
  # missing or invalid (first run after this mechanism landed) -- and persists
  # that fallback BEFORE the reset moves HEAD, otherwise a failed first deploy
  # would fall back to the already-moved HEAD next tick and never be retried.
  DEPLOYED=$(cat "${DEPLOY_STATE}" 2>/dev/null || true)
  if [ -z "${DEPLOYED}" ] || ! git cat-file -e "${DEPLOYED}^{commit}" 2>/dev/null; then
    [ -n "${DEPLOYED}" ] && log "WARN state file SHA '${DEPLOYED}' is not a commit -- assuming HEAD is what runs"
    DEPLOYED=${CURRENT}
    printf '%s\n' "${DEPLOYED}" >"${DEPLOY_STATE}" \
      || { log "ERROR cannot write ${DEPLOY_STATE} -- refusing to deploy without retry protection"; exit 1; }
  fi

  if [ "${DEPLOYED}" = "${TARGET}" ] && [ "${CURRENT}" = "${TARGET}" ]; then
    if [ "${DEPLOY_VERBOSE}" = "1" ] || [ "${CHECK_ONLY}" = "1" ]; then
      log "up to date at ${TARGET:0:8}"
    fi
    exit 0
  fi

  if [ "${CURRENT}" = "${TARGET}" ]; then
    log "WARN HEAD is at ${TARGET:0:8} but last recorded success is ${DEPLOYED:0:8} -- a previous tick died mid-deploy; finishing it"
  fi

  # The span to deploy is "last success -> remote tip", so changes a failed or
  # interrupted tick never shipped are picked up again here.
  CHANGED=$(git diff --name-only "${DEPLOYED}" "${TARGET}")
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
    [ "${CHECK_ONLY}" = "1" ] || log "docs-only change ${DEPLOYED:0:8} -> ${TARGET:0:8} (${SUBJECT}) -- syncing checkout, no deploy"
  else
    log "update available: ${DEPLOYED:0:8} -> ${TARGET:0:8} (${SUBJECT})"
  fi

  # -------------------------------------------------------------------------
  # 2. Guards
  # -------------------------------------------------------------------------
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

  # Commits made directly on the server but never pushed would be silently
  # DESTROYED by the reset (they are unreachable from the remote tip). Only
  # proceed when HEAD is an ancestor of the target; --force discards.
  if [ "${CURRENT}" != "${TARGET}" ] && [ "${FORCE}" = "0" ] \
     && ! git merge-base --is-ancestor "${CURRENT}" "${TARGET}"; then
    log "ABORT HEAD ${CURRENT:0:8} is not an ancestor of ${DEPLOY_REMOTE}/${DEPLOY_BRANCH} -- the server has local commits:"
    git log --oneline "${TARGET}..${CURRENT}" 2>/dev/null | head -10 | while read -r l; do log "       ${l}"; done
    log "       push or drop them, or re-run with --force to discard them"
    alert "BRIDGE deploy blocked: server checkout has commits not on ${DEPLOY_REMOTE}/${DEPLOY_BRANCH}"
    exit 0
  fi

  # Fail parking: a commit that already failed DEPLOY_MAX_FAILURES deploys is
  # not tried again until the remote moves (or --force). See record_failure.
  FAILED_SHA=""
  FAILED_COUNT=0
  if [ -f "${DEPLOY_FAIL_STATE}" ]; then
    read -r FAILED_SHA FAILED_COUNT <"${DEPLOY_FAIL_STATE}" 2>/dev/null || true
  fi
  [ "${FAILED_SHA}" = "${TARGET}" ] || FAILED_COUNT=0
  case "${FAILED_COUNT}" in (*[!0-9]*|'') FAILED_COUNT=0 ;; esac
  if [ "${FAILED_COUNT}" -ge "${DEPLOY_MAX_FAILURES}" ] && [ "${FORCE}" = "0" ] && [ "${DOCS_ONLY}" = "0" ]; then
    if [ "${CHECK_ONLY}" = "1" ]; then
      log "--check: ${TARGET:0:8} is parked after ${FAILED_COUNT} failed deploys -- waiting for a new commit (--force retries now)"
    elif [ "${DEPLOY_VERBOSE}" = "1" ]; then
      log "skipping ${TARGET:0:8}: parked after ${FAILED_COUNT} failed deploys (--force retries now)"
    fi
    exit 0
  fi

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
      log "--check: docs-only change ${DEPLOYED:0:8} -> ${TARGET:0:8} -- would sync checkout (no deploy)"
    else
      log "--check: would deploy ${TARGET:0:8} (api=${API_CHANGED} web=${WEB_CHANGED} \
deps=${DEPS_CHANGED} ecosystem=${ECOSYSTEM_CHANGED} infra=${INFRA_CHANGED})"
    fi
    exit 0
  fi

  # -------------------------------------------------------------------------
  # 3. Deploy
  # -------------------------------------------------------------------------

  # Pre-deploy snapshot of the SQLite DB (non-fatal): a restore point from
  # immediately before this change. Uses sqlite3's online .backup when
  # available. Retries of a commit that already failed do NOT snapshot again:
  # the copy from the first attempt is the meaningful restore point, and one
  # more copy per retry tick would rotate the pre-incident snapshots out
  # within ~25 minutes. Rotation also always spares the snapshot recorded by
  # the last successful deploy (see record_success).
  DB_FILE="${APP_ROOT}/apps/api/data/oracle.db"
  BACKUP_DIR="${APP_ROOT}/apps/api/data/backup"
  SNAP_TAKEN=""
  if [ "${API_CHANGED}" = "1" ] && [ -f "${DB_FILE}" ] && command -v sqlite3 >/dev/null 2>&1; then
    if [ "${FAILED_COUNT}" -gt 0 ]; then
      log "skipping DB snapshot (retry of ${TARGET:0:8} -- keeping pre-incident restore points)"
    else
      mkdir -p "${BACKUP_DIR}"
      SNAP_FILE="${BACKUP_DIR}/pre-deploy-$(date +%Y%m%d-%H%M%S).db"
      if sqlite3 "${DB_FILE}" ".backup '${SNAP_FILE}'" 2>/dev/null; then
        log "pre-deploy DB snapshot written to apps/api/data/backup/"
        SNAP_TAKEN="${SNAP_FILE}"
        KEEP=$(cat "${BACKUP_DIR}/.last-success-snapshot" 2>/dev/null || true)
        # shellcheck disable=SC2012  # names are our own timestamped pattern
        ls -1t "${BACKUP_DIR}"/pre-deploy-*.db 2>/dev/null \
          | { if [ -n "${KEEP}" ]; then grep -vxF "${KEEP}"; else cat; fi; } \
          | tail -n +6 | xargs -r rm -f || true
      else
        log "WARN pre-deploy DB snapshot failed (continuing)"
      fi
    fi
  fi

  log "checking out ${TARGET:0:8}"
  git reset --hard --quiet "${TARGET}"

  if [ "${ECOSYSTEM_CHANGED}" = "1" ]; then
    log "NOTE ecosystem.config.cjs changed -- process definitions (cron, env) are"
    log "     NOT re-registered automatically. Run on the server when convenient:"
    log "     cd oracle && pm2 restart ecosystem.config.cjs --update-env && pm2 save"
    log "     (from a login shell only -- never from inside a PM2-managed process:"
    log "      PM2 injects config keys like cron_restart into the environment and"
    log "      --update-env would copy them onto every app)"
    log "     (oracle-api runs apps/api/dist -- if dist/ is missing, build it first:"
    log "      pnpm --filter @oracle/api... build)"
  fi

  if [ "${API_CHANGED}" = "0" ] && [ "${WEB_CHANGED}" = "0" ]; then
    record_success || exit 1
    if [ "${DOCS_ONLY}" = "1" ]; then
      log "SYNCED ${DEPLOYED:0:8} -> ${TARGET:0:8} (docs only -- no deploy)"
    else
      log "DEPLOYED ${DEPLOYED:0:8} -> ${TARGET:0:8} (deploy scripts/config only -- checkout updated, no build or restart)"
    fi
    exit 0
  fi

  if ! build_and_restart "${API_CHANGED}" "${WEB_CHANGED}" "${DEPS_CHANGED}"; then
    log "ERROR build/restart failed"
    record_failure
    rollback || exit 1
    exit 1
  fi

  if ! health_ok; then
    log "ERROR health check failed after deploy"
    record_failure
    rollback || exit 1
    exit 1
  fi

  record_success || exit 1
  log "DEPLOYED ${DEPLOYED:0:8} -> ${TARGET:0:8}"
  git log --oneline "${DEPLOYED}..${TARGET}" | head -10 | while read -r l; do log "       ${l}"; done
  exit 0
}

# Single line: parsed as one unit, so bash never has to read this file again
# after main() starts -- see the header on self-overwrite safety.
main "$@"; exit $?
