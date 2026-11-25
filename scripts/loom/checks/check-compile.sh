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

# Client hooks exhaustive-deps — react-hooks/exhaustive-deps must be error-free (see react-useeffect-infinite-loop-prevention.mdc)
# Runs eslint on changed hook/component files; fails on any react-hooks error (compile-time, not just QA)
if command -v npx >/dev/null 2>&1 && [ -f "apps/delivery-ops/client/package.json" ]; then
  # Resolve eslint binary (root node_modules or client node_modules)
  ESLINT_BIN=""
  if [ -x "node_modules/.bin/eslint" ]; then ESLINT_BIN="node_modules/.bin/eslint"
  elif [ -x "apps/delivery-ops/client/node_modules/.bin/eslint" ]; then ESLINT_BIN="apps/delivery-ops/client/node_modules/.bin/eslint"
  fi
  if [ -n "$ESLINT_BIN" ]; then
    # Only check files touched in this weave (diff vs origin/main + untracked) to keep gate fast
    ESLINT_FILES=""
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      ESLINT_FILES="$(git diff --name-only origin/main...HEAD 2>/dev/null | grep -E '^apps/delivery-ops/client/src/.*\.(js|jsx|ts|tsx)$' || true)"
      UNTRACKED="$(git ls-files --others --exclude-standard 2>/dev/null | grep -E '^apps/delivery-ops/client/src/.*\.(js|jsx|ts|tsx)$' || true)"
      if [ -n "$UNTRACKED" ]; then ESLINT_FILES="$ESLINT_FILES
$UNTRACKED"
      fi
    else
      ESLINT_FILES="$(git diff --name-only HEAD 2>/dev/null | grep -E '^apps/delivery-ops/client/src/.*\.(js|jsx|ts|tsx)$' || true)"
    fi
    if [ -n "$ESLINT_FILES" ]; then
      echo "▶ client (eslint exhaustive-deps): $ESLINT_BIN on changed client files"
      # Use client eslint config (package.json eslintConfig) — run from client dir
      FAIL_ESLINT=0
      for f in $ESLINT_FILES; do
        if [ -f "$f" ]; then
          if ! "$ESLINT_BIN" "$f" --ext .js,.jsx,.ts,.tsx --max-warnings=0 2>&1; then
            echo "✗ client (eslint) FAILED — $f has react-hooks/exhaustive-deps or other error (see above)"
            FAIL_ESLINT=1
          fi
        fi
      done
      if [ $FAIL_ESLINT -ne 0 ]; then
        echo "✗ client (eslint) FAILED — fix exhaustive-deps / lint errors above (see react-useeffect-infinite-loop-prevention.mdc)"
        FAIL=1
      else
        echo "✓ client (eslint) OK (no exhaustive-deps errors in changed files)"
      fi
      echo ""
    else
      echo "▶ client (eslint exhaustive-deps): no changed client files — skip (changed-file gate)"
      echo "✓ client (eslint changed) OK (no files to check)"
      echo ""
    fi
    # Full exhaustive-deps gate — catches pre-existing errors that block `npm run build` even when not touched in this weave
    echo "▶ client (eslint exhaustive-deps): full check on apps/delivery-ops/client/src"
    ESLINT_FULL_OUT="$("$ESLINT_BIN" apps/delivery-ops/client/src --ext .js,.jsx,.ts,.tsx 2>&1 || true)"
    if echo "$ESLINT_FULL_OUT" | grep -q "react-hooks/exhaustive-deps"; then
      echo "✗ client (eslint full) FAILED — pre-existing react-hooks/exhaustive-deps errors in repo:"
      echo "$ESLINT_FULL_OUT" | grep -E "exhaustive-deps" | head -n 20
      FAIL=1
    else
      echo "✓ client (eslint full) OK (no exhaustive-deps errors in repo)"
    fi
    echo ""
  fi
fi

# Stable-callback hygiene — unstable .bind() inside hook returns causes useEffect storms
# (see agent-pack/loom/rules/react-useeffect-infinite-loop-prevention.mdc).
if grep -rn --include="*.js" --include="*.jsx" '\.bind(.*Service)' apps/delivery-ops/client/src/shared/services apps/delivery-ops/client/src/hooks 2>/dev/null | grep -q .; then
  echo "✗ stable-callback FAILED — found .bind() inside hook/service returns (unstable identity → useEffect storm)"
  grep -rn --include="*.js" --include="*.jsx" '\.bind(.*Service)' apps/delivery-ops/client/src/shared/services apps/delivery-ops/client/src/hooks 2>/dev/null
  echo "  Fix: wrap each callback with useCallback([]) + return via useMemo — see react-useeffect-infinite-loop-prevention.mdc"
  FAIL=1
else
  echo "✓ stable-callback OK (no .bind() in hook returns)"
  echo ""
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
