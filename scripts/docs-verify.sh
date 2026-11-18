#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
echo "== docs-verify: stale path check =="
if grep -r "apps/delivery-ops/docs" "$ROOT/agent-pack/skills" "$ROOT/agent-pack/rules" "$ROOT/agent-pack/context" 2>/dev/null | grep -v "redirect stub" | grep -v "Product docs already migrated" | grep -q .; then
  echo "FAIL: stale apps/delivery-ops/docs refs found:"
  grep -rn "apps/delivery-ops/docs" "$ROOT/agent-pack/skills" "$ROOT/agent-pack/rules" "$ROOT/agent-pack/context" | grep -v "redirect stub" | grep -v "Product docs already migrated"
  FAIL=1
else echo "PASS: no stale writers"
fi
echo "== docs-verify: build =="
node "$ROOT/scripts/docs-build.js" || FAIL=1
echo "== docs-verify: hub exists =="
[ -f "$ROOT/docs/index.html" ] || { echo "FAIL: docs/index.html missing"; FAIL=1; }
[ -f "$ROOT/docs/README.md" ] || { echo "FAIL: docs/README.md missing"; FAIL=1; }
echo "== docs-verify: required guides =="
for f in USER_GUIDE.md ADMIN_GUIDE.md; do [ -f "$ROOT/docs/guides/$f" ] || { echo "FAIL: docs/guides/$f missing"; FAIL=1; }; done
echo "== docs-verify: broken internal links (basic) =="
# check markdown links to non-existent md files (relative)
if [ -d "$ROOT/docs" ]; then
  grep -rho '\[.*\]([^)]*\.md[^)]*)' "$ROOT/docs" 2>/dev/null | sed 's/.*(\(.*\))/\1/' | sed 's/#.*//' | sort -u | while read link; do
    # skip http links and empty
    echo "$link" | grep -q "^http" && continue
    [ -z "$link" ] && continue
    # skip glob/wildcard placeholders like *.md
    echo "$link" | grep -q '\*' && continue
    base=$(basename "$link")
    [ -z "$base" ] && continue
    # check basename exists anywhere in repo (docs + repo-root + agent-pack)
    if ! find "$ROOT/docs" "$ROOT/AGENTS.md" "$ROOT/ARCHITECTURE.md" "$ROOT/DECISIONS.md" "$ROOT/agent-pack" -name "$base" -print -quit 2>/dev/null | grep -q .; then
      # fallback: search whole repo excluding node_modules/.git
      if ! find "$ROOT" -name "$base" -not -path "*/node_modules/*" -not -path "*/.git/*" -print -quit 2>/dev/null | grep -q .; then
        echo "WARN: possible broken link -> $link ($base not found)"
      fi
    fi
  done
fi
if [ $FAIL -eq 0 ]; then echo "docs-verify PASS"; else echo "docs-verify FAIL"; exit 1; fi
