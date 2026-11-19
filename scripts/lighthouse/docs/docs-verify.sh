#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/apps/delivery-ops/server/config/aiAudit.config.json"
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

# Rebuild AI audit indexes (idempotent) and verify they are not stale
if [ -f "$ROOT/scripts/loom/ai-audit/rebuild-indexes.js" ]; then
  echo "== docs-verify: ai-audit indexes =="
  node "$ROOT/scripts/loom/ai-audit/rebuild-indexes.js" || FAIL=1
fi

echo "== docs-verify: hub exists =="
[ -f "$ROOT/docs/index.html" ] || { echo "FAIL: docs/index.html missing"; FAIL=1; }
[ -f "$ROOT/docs/README.md" ] || { echo "FAIL: docs/README.md missing"; FAIL=1; }
echo "== docs-verify: required guides =="
for f in USER_GUIDE.md ADMIN_GUIDE.md; do [ -f "$ROOT/docs/guides/$f" ] || { echo "FAIL: docs/guides/$f missing"; FAIL=1; }; done

echo "== docs-verify: ai-audit registry + naming + frontmatter =="
if [ -f "$CONFIG" ]; then
  node -e "
const fs=require('fs'), path=require('path');
const root='$ROOT';
const cfg=JSON.parse(fs.readFileSync('$CONFIG','utf8'));
let fail=0;
const NAMING_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-z0-9][a-z0-9-]*__weave-[a-z0-9][a-z0-9-]*(\.md|__[0-9]{2}\.md)$/;
const REQUIRED_FM = ['page','route','weave','date','author','goal'];
for(const [pageName, page] of Object.entries(cfg.pages)){
  const ap = path.join(root, page.auditPath);
  if(!fs.existsSync(ap)){
    console.log('FAIL: missing audit folder for '+pageName+': '+page.auditPath);
    fail=1; continue;
  }
  const files = fs.readdirSync(ap).filter(f=>f.endsWith('.md') && f!=='INDEX.md');
  // INDEX.md must exist
  if(!fs.existsSync(path.join(ap,'INDEX.md'))){
    console.log('FAIL: missing INDEX.md in '+page.auditPath);
    fail=1;
  }
  for(const f of files){
    if(!NAMING_RE.test(f)){
      console.log('FAIL: bad journal filename in '+page.auditPath+'/'+f+' — expected YYYY-MM-DD__kebab-slug__weave-<slug>.md');
      fail=1;
    }
    const content = fs.readFileSync(path.join(ap,f),'utf8');
    // frontmatter check
    if(!content.startsWith('---')){
      console.log('FAIL: missing frontmatter in '+page.auditPath+'/'+f);
      fail=1; continue;
    }
    const end = content.indexOf('\n---',3);
    if(end===-1){ console.log('FAIL: unclosed frontmatter in '+page.auditPath+'/'+f); fail=1; continue; }
    const yaml = content.slice(4,end);
    for(const key of REQUIRED_FM){
      if(!yaml.match(new RegExp('^'+key+':','m'))){
        console.log('FAIL: missing frontmatter key '+key+' in '+page.auditPath+'/'+f);
        fail=1;
      }
    }
    // page field must match directory page name
    const pageMatch = yaml.match(/^page:\s*(.+)/m);
    if(pageMatch && pageMatch[1].trim() !== pageName){
      console.log('WARN: page field mismatch in '+page.auditPath+'/'+f+': frontmatter page='+pageMatch[1].trim()+' vs registry '+pageName);
    }
  }
}
// stale-registry check: any audit folder not in registry?
const { execSync } = require('child_process');
try{
  const found = execSync('find '+root+'/apps/delivery-ops/client/src -type d -name \"ai-audit-docs\" 2>/dev/null', {encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const registryPaths = new Set(Object.values(cfg.pages).map(p=>path.join(root,p.auditPath)));
  // also allow parent bucket dirs like .../ai-audit-docs/ProjectStatus — their parent is not in registry
  for(const dir of found){
    if(!registryPaths.has(dir)){
      // check if dir is parent of a registry entry
      const isParent = [...registryPaths].some(rp=>rp.startsWith(dir+'/'));
      if(!isParent){
        console.log('WARN: audit folder not in registry (update aiAudit.config.json): '+path.relative(root,dir));
      }
    }
  }
} catch(e){}
if(fail) process.exit(1);
console.log('PASS: ai-audit naming + frontmatter + registry sync');
" || FAIL=1
else
  echo "WARN: $CONFIG not found — skipping ai-audit checks"
fi
# LEARNINGS.md + timeline existence (warn, not fail, for fresh installs)
if [ -f "$CONFIG" ]; then
  [ -f "$ROOT/docs/ai-audit/LEARNINGS.md" ] || echo "WARN: docs/ai-audit/LEARNINGS.md missing"
  [ -f "$ROOT/docs/ai-audit/timeline.md" ] || echo "WARN: docs/ai-audit/timeline.md missing — run node scripts/loom/ai-audit/rebuild-indexes.js"
fi

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
