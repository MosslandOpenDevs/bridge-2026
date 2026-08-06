#!/usr/bin/env bash
#
# Fixtures for deploy.sh's change classifier.
#
# The classifier decides whether a commit triggers an install, a build, a
# restart, or nothing at all. A path in the wrong bucket is silent either way:
# too narrow and a deploy advances the checkout without rebuilding the code it
# changed; too broad and a README edit restarts production.
#
# Run: oracle/scripts/test-deploy-classifier.sh

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEPLOY="${SCRIPT_DIR}/deploy.sh"

pass=0
fail=0

# expect <description> <expected-flags> <changed path>...
expect() {
  local description="$1" expected="$2"
  shift 2
  local actual
  actual=$(printf '%s\n' "$@" | bash "${DEPLOY}" --classify)
  if [ "${actual}" = "${expected}" ]; then
    pass=$((pass + 1))
    echo "PASS  ${description}"
  else
    fail=$((fail + 1))
    echo "FAIL  ${description}"
    echo "        files:    $*"
    echo "        expected: ${expected}"
    echo "        actual:   ${actual}"
  fi
}

echo "deploy.sh change classifier"
echo

# --- application code -------------------------------------------------------
expect "API source builds and restarts the API only" \
  "api=1 web=0 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/apps/api/src/index.ts"

expect "web source builds and restarts the web app only" \
  "api=0 web=1 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/apps/web/src/app/page.tsx"

expect "a shared package marks both apps" \
  "api=1 web=1 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/packages/core/src/types/governance.ts"

# --- workspace configuration ------------------------------------------------
# pnpm-workspace.yaml was missing from the classifier: a commit that only
# added or removed a workspace member was treated as docs-only, so the
# checkout advanced with no install, build or restart.
expect "pnpm-workspace.yaml marks both apps (regression)" \
  "api=1 web=1 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/pnpm-workspace.yaml"

expect "eslint.config.js marks both apps" \
  "api=1 web=1 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/eslint.config.js"

expect "root package.json marks both apps" \
  "api=1 web=1 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/package.json"

expect "turbo.json marks both apps" \
  "api=1 web=1 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/turbo.json"

expect "a root tsconfig marks both apps" \
  "api=1 web=1 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "oracle/tsconfig.json"

# --- dependencies -----------------------------------------------------------
expect "the lockfile triggers an install and both builds" \
  "api=1 web=1 deps=1 ecosystem=0 infra=0 docs_only=0" \
  "oracle/pnpm-lock.yaml"

# --- deploy infrastructure --------------------------------------------------
expect "the ecosystem file is deploy config, not a build" \
  "api=0 web=0 deps=0 ecosystem=1 infra=0 docs_only=0" \
  "oracle/ecosystem.config.cjs"

expect "deploy scripts reach the server without a build" \
  "api=0 web=0 deps=0 ecosystem=0 infra=1 docs_only=0" \
  "oracle/scripts/deploy.sh"

# --- docs-only --------------------------------------------------------------
expect "a README edit is synced, not deployed" \
  "api=0 web=0 deps=0 ecosystem=0 infra=0 docs_only=1" \
  "README.md"

expect "nexus is a reference implementation and never deploys" \
  "api=0 web=0 deps=0 ecosystem=0 infra=0 docs_only=1" \
  "nexus/backend/src/main.ts"

expect "oracle docs are synced, not deployed" \
  "api=0 web=0 deps=0 ecosystem=0 infra=0 docs_only=1" \
  "oracle/docs/on-chain-state.md"

expect "CI workflow changes do not deploy" \
  "api=0 web=0 deps=0 ecosystem=0 infra=0 docs_only=1" \
  ".github/workflows/ci.yml"

# --- combinations -----------------------------------------------------------
expect "a mixed commit takes the union of its buckets" \
  "api=1 web=1 deps=1 ecosystem=1 infra=1 docs_only=0" \
  "oracle/apps/api/src/index.ts" \
  "oracle/apps/web/src/app/page.tsx" \
  "oracle/pnpm-lock.yaml" \
  "oracle/ecosystem.config.cjs" \
  "oracle/scripts/deploy.sh" \
  "README.md"

expect "docs alongside API code still deploys the API" \
  "api=1 web=0 deps=0 ecosystem=0 infra=0 docs_only=0" \
  "README.md" \
  "oracle/apps/api/src/db.ts"

expect "an empty change list is docs-only" \
  "api=0 web=0 deps=0 ecosystem=0 infra=0 docs_only=1" \
  ""

echo
echo "────────────────────────────────"
echo "  ${pass} passed, ${fail} failed"
echo "────────────────────────────────"
[ "${fail}" -eq 0 ]
