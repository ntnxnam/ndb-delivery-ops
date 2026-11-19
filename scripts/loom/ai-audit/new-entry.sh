#!/usr/bin/env bash
# Scaffold a new AI audit journal entry for a page.
# Usage: scripts/loom/ai-audit/new-entry.sh --page <PageName> --slug <kebab-slug> --weave <weave-slug> [--date YYYY-MM-DD] [--dry-run]
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/apps/delivery-ops/server/config/aiAudit.config.json"
TEMPLATE="$ROOT/scripts/loom/ai-audit/template.md"

PAGE=""; SLUG=""; WEAVE=""; DATE=""; DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --page) PAGE="$2"; shift 2;;
    --slug) SLUG="$2"; shift 2;;
    --weave) WEAVE="$2"; shift 2;;
    --date) DATE="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

if [[ -z "$PAGE" || -z "$SLUG" || -z "$WEAVE" ]]; then
  echo "Usage: $0 --page <PageName> --slug <kebab-slug> --weave <weave-slug> [--date YYYY-MM-DD] [--dry-run]" >&2
  exit 1
fi
DATE="${DATE:-$(date +%Y-%m-%d)}"

# Validate date format
if ! echo "$DATE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  echo "FAIL: --date must be YYYY-MM-DD, got: $DATE" >&2; exit 1
fi
# Validate slugs (kebab: lowercase, digits, hyphens; weave: allow same)
if ! echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]*$'; then
  echo "FAIL: --slug must be kebab-case (lowercase, digits, hyphens), got: $SLUG" >&2; exit 1
fi
if ! echo "$WEAVE" | grep -qE '^[a-z0-9][a-z0-9-]*$'; then
  echo "FAIL: --weave must be kebab-case, got: $WEAVE" >&2; exit 1
fi

# Resolve page from registry
if ! command -v node >/dev/null 2>&1; then echo "FAIL: node required" >&2; exit 1; fi
RESOLVED=$(node -e "
const c=require('$CONFIG');
const p=c.pages['$PAGE'];
if(!p){console.error('FAIL: page not in registry: $PAGE — check aiAudit.config.json');process.exit(1);}
console.log(JSON.stringify(p));
")
AUDIT_PATH=$(echo "$RESOLVED" | node -e "const p=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(p.auditPath)")
ROUTE=$(echo "$RESOLVED" | node -e "const p=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(p.route)")
SOURCE=$(echo "$RESOLVED" | node -e "const p=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(p.source)")
TITLE=$(echo "$RESOLVED" | node -e "const p=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(p.title||'$PAGE')")

ABS_AUDIT="$ROOT/$AUDIT_PATH"
FILENAME="${DATE}__${SLUG}__weave-${WEAVE}.md"
DEST="$ABS_AUDIT/$FILENAME"

# Handle same-day collision: append __02, __03 ...
if [[ -f "$DEST" ]]; then
  N=2
  while [[ -f "$DEST" ]]; do
    FILENAME="${DATE}__${SLUG}__weave-${WEAVE}__$(printf '%02d' $N).md"
    DEST="$ABS_AUDIT/$FILENAME"
    N=$((N+1))
    if [[ $N -gt 99 ]]; then echo "FAIL: too many collisions for $DATE/$SLUG/$WEAVE" >&2; exit 1; fi
  done
  echo "Note: filename collision — using $FILENAME"
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY RUN — would create: ${AUDIT_PATH}/$FILENAME"
  exit 0
fi

mkdir -p "$ABS_AUDIT"

# Render template — substitute placeholders
if [[ -f "$TEMPLATE" ]]; then
  sed -e "s|{{PAGE}}|$PAGE|g" \
      -e "s|{{ROUTE}}|$ROUTE|g" \
      -e "s|{{SOURCE}}|$SOURCE|g" \
      -e "s|{{TITLE}}|$TITLE|g" \
      -e "s|{{WEAVE}}|$WEAVE|g" \
      -e "s|{{DATE}}|$DATE|g" \
      -e "s|{{SLUG}}|$SLUG|g" \
      "$TEMPLATE" > "$DEST"
else
  cat > "$DEST" <<EOF
---
page: $PAGE
route: $ROUTE
source: $SOURCE
weave: weave-$WEAVE
date: $DATE
author: TBD (human) + TBD (AI)
models: []
goal: "TBD"
audience: TBD
---

# $DATE — $TITLE — $SLUG

## Prompt (verbatim)
> TBD

## Goal → Done When
TBD

## AI Config Snapshot
TBD

## Changes
| File | Change |
|------|--------|
| TBD | TBD |

## Decisions & Alternatives Considered
TBD

## Mistakes & Corrections
No mistakes this weave. | Or describe mistake, fix, and prevention.

## Verification
TBD

## Links
- Plan: \`~/.opencode/plan/weave-$WEAVE.md\`
- PR: TBD

## Config Delta
\`\`\`json
{}
\`\`\`

## Follow-ups / Waivers
None
EOF
fi

echo "Created: ${AUDIT_PATH}/$FILENAME"

# Regenerate per-folder INDEX if helper exists
if [[ -f "$ROOT/scripts/loom/ai-audit/rebuild-indexes.js" ]]; then
  node "$ROOT/scripts/loom/ai-audit/rebuild-indexes.js" --page "$PAGE" 2>&1 || echo "WARN: rebuild-indexes failed for $PAGE" >&2
fi
