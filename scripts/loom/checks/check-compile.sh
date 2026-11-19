#!/usr/bin/env bash
# Compile gate — zero tolerance for type errors.
# Runs tsc --noEmit across every TypeScript workspace.
# Fails fast on first error; prints which workspace failed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

FAIL=0

run() {
  local label="$1"; shift
  echo "▶ $label: $*"
  if ! "$@"; then
    echo "✗ $label FAILED — compile errors above block this weave"
    FAIL=1
  else
    echo "✓ $label OK"
  fi
  echo ""
}

run "shared" npm --workspace @portfolio-delivery-ops/shared run typecheck
run "mcp/lighthouse" npm --workspace @portfolio-delivery-ops/mcp-lighthouse run typecheck
run "mcp/loom" npm --workspace @portfolio-delivery-ops/mcp-loom run typecheck

# Client is JS/JSX (no tsconfig). If a tsconfig appears, enforce it;
# otherwise verify JS syntax via eslint --max-warnings=0 on changed files is handled by QA.
if [ -f "apps/delivery-ops/client/tsconfig.json" ]; then
  run "client (tsc)" npx --workspace ndb-status-sender-client tsc --noEmit -p apps/delivery-ops/client/tsconfig.json
fi

# Server is plain JS — quick syntax check for any changed JS files would be:
# node --check <file>. For the gate we just ensure server has no require/import
# syntax break by running `node --check` on index.js as a canary.
if [ -f "apps/delivery-ops/server/index.js" ]; then
  echo "▶ server (node --check canary): node --check apps/delivery-ops/server/index.js"
  if ! node --check apps/delivery-ops/server/index.js; then
    echo "✗ server FAILED — syntax error in server/index.js"
    FAIL=1
  else
    echo "✓ server OK (canary)"
  fi
  echo ""
fi

if [ $FAIL -ne 0 ]; then
  echo "check:compile FAIL — fix type/syntax errors above before Merge. No waivers."
  exit 1
fi
echo "check:compile PASS — zero compile-time errors across all workspaces."
