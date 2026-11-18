#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FAIL=0
echo "== docs-verify: stale path check =="
if grep -r "apps/delivery-ops/docs" "$ROOT/agent-pack/skills" "$ROOT/agent-pack/rules" "$ROOT/agent-pack/context" 2>/dev/null | grep -v "redirect stub" | grep -v "Product docs already migrated" | grep -q .; then
  echo "FAIL: stale apps/delivery-ops/docs refs found:"
  grep -rn "apps/delivery-ops/docs" "$ROOT/agent-pack/skills" "$ROOT/agent-pack/rules" "$ROOT/agent-pack/context" | grep -v "redirect stub" | grep -v "Product docs already migrated"
  FAIL=1
else echo "PASS: no stale writers"
fi
echo "== docs-verify: build =="
node "$ROOT/scripts/lighthouse/docs/docs-build.js" || FAIL=1
echo "== docs-verify: hub exists =="
[ -f "$ROOT/docs/index.html" ] || { echo "FAIL: docs/index.html missing"; FAIL=1; }
[ -f "$ROOT/docs/README.md" ] || { echo "FAIL: docs/README.md missing"; FAIL=1; }
echo "== docs-verify: required guides =="
for f in USER_GUIDE.md ADMIN_GUIDE.md; do [ -f "$ROOT/docs/guides/$f" ] || { echo "FAIL: docs/guides/$f missing"; FAIL=1; }; done
echo "== docs-verify: broken internal links (relative-resolved) =="
if [ -d "$ROOT/docs" ]; then
  # Per-file resolution: each md link is resolved relative to its source file's directory.
  # This correctly handles cross-pack links (e.g. ../../agent-pack/lighthouse/..., ../../generated/handover/...)
  # which the old basename-in-docs check falsely flagged.
  find "$ROOT/docs" -name "*.md" -print0 | while IFS= read -r -d '' md; do
    dir=$(dirname "$md")
    # Extract markdown links containing .md (skip image syntax prefix ! if present — grep still catches it but we filter)
    grep -o '\[.*\]([^)]*\.md[^)]*)' "$md" 2>/dev/null | sed 's/.*(\(.*\))/\1/' | sed 's/#.*//' | sed 's/?.*//' | sort -u | while IFS= read -r link; do
      # skip http(s), mailto, and empty
      echo "$link" | grep -qE "^https?:" && continue
      echo "$link" | grep -qE "^mailto:" && continue
      [ -z "$link" ] && continue
      base=$(basename "$link")
      [ -z "$base" ] && continue
      # Resolve target relative to source dir (or repo root if absolute /-prefixed).
      # No realpath -m on macOS (BSD) — [ -f ] handles ../ correctly without canonicalization.
      if echo "$link" | grep -q "^/"; then
        target="$ROOT$link"
      else
        target="$dir/$link"
      fi
      if [ -f "$target" ]; then
        continue
      fi
      # Target missing — report with source file context
      if echo "$link" | grep -q "\.\./"; then
        echo "WARN: possible broken link in ${md#$ROOT/} -> $link (resolved $target not found)"
      else
        # Legacy basename fallback for same-dir shorthand links
        if ! find "$ROOT/docs" -name "$base" -print -quit | grep -q .; then
          echo "WARN: possible broken link in ${md#$ROOT/} -> $link ($base not found in docs/)"
        fi
      fi
    done
  done
fi
if [ $FAIL -eq 0 ]; then echo "docs-verify PASS"; else echo "docs-verify FAIL"; exit 1; fi
