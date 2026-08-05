#!/bin/bash
# BRIDGE auto-deploy — poll origin and redeploy when new commits land.
#
# Designed for the pm2 machine behind the Lightsail nginx (same layout as
# ao/algora: git checkout + pnpm + pm2). GitHub Actions can't reach that
# machine (NAT), so the machine pulls instead:
#
#   crontab -e
#   */2 * * * * /path/to/bridge-2026/oracle/deploy/auto-deploy.sh >> $HOME/bridge-deploy.log 2>&1
#
# Optional env:
#   BRIDGE_DEPLOY_BRANCH  branch to track (default: main)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ORACLE_DIR="$REPO_DIR/oracle"
BRANCH="${BRIDGE_DEPLOY_BRANCH:-main}"
LOCK_DIR="${TMPDIR:-/tmp}/bridge-auto-deploy.lock"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# One deploy at a time; a stale lock from a crashed run is removed after 30 min.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    log "removing stale lock"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

cd "$REPO_DIR"
git fetch origin "$BRANCH" --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "deploying ${LOCAL:0:7} -> ${REMOTE:0:7} ($BRANCH)"
git checkout "$BRANCH" --quiet
git pull --ff-only origin "$BRANCH" --quiet

cd "$ORACLE_DIR"
pnpm install --frozen-lockfile --prefer-offline

# Build workspace packages the API imports (the API itself runs via tsx),
# then the web app and its workspace deps.
pnpm --filter "@oracle/api^..." build
pnpm --filter "@oracle/web..." build

pm2 startOrRestart ecosystem.config.cjs --update-env

# Post-deploy health check
sleep 5
for url in "http://localhost:3101/api/health" "http://localhost:3100"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo 000)"
  log "$url -> HTTP $code"
  if [ "$code" != "200" ]; then
    log "WARNING: health check failed for $url"
  fi
done

log "deploy complete: $(git -C "$REPO_DIR" rev-parse --short HEAD)"
