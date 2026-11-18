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
    # links are relative to their file; we do shallow check for basename existence
    base=$(basename "$link")
    [ -z "$base" ] && continue
    if ! find "$ROOT/docs" -name "$base" -print -quit | grep -q .; then
      echo "WARN: possible broken link -> $link ($base not found)"
    fi
  done
fi
if [ $FAIL -eq 0 ]; then echo "docs-verify PASS"; else echo "docs-verify FAIL"; exit 1; fi
