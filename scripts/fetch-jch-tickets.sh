#!/bin/bash
# fetch-jch-tickets.sh
#
# Usage:
#   ./scripts/fetch-jch-tickets.sh <JIRA_PAT>   ← saves token to ~/.jira-pat and runs
#   ./scripts/fetch-jch-tickets.sh               ← uses existing ~/.jira-pat
#
# Output:
#   /tmp/jch-tickets.json       raw JIRA response
#   /tmp/jch-report.md          formatted report (valid changes + no-change-closed)

set -euo pipefail

PAT_FILE="$HOME/.jira-pat"
JIRA_BASE="https://jira.nutanix.com"
RAW="/tmp/jch-tickets.json"
REPORT="/tmp/jch-report.md"

# ── PAT: accept as arg or read from file ────────────────────────────────────
if [ -n "${1:-}" ]; then
  echo "$1" > "$PAT_FILE"
  chmod 600 "$PAT_FILE"
  echo "✓ Token saved to $PAT_FILE"
fi

if [ ! -f "$PAT_FILE" ]; then
  echo ""
  echo "ERROR: No PAT found."
  echo "Usage: ./scripts/fetch-jch-tickets.sh <YOUR_JIRA_PAT>"
  echo "  or:  echo 'token' > ~/.jira-pat && chmod 600 ~/.jira-pat"
  echo ""
  echo "Get your PAT: JIRA → Avatar → Profile → Personal Access Tokens"
  exit 1
fi

JIRA_PAT=$(cat "$PAT_FILE" | tr -d '[:space:]')
if [ -z "$JIRA_PAT" ]; then
  echo "ERROR: $PAT_FILE is empty."
  exit 1
fi

# ── Paginated fetch ──────────────────────────────────────────────────────────
echo ""
echo "Fetching JCH tickets from $JIRA_BASE ..."

JQL='project = JCH AND reporter in (namratha.singh, membersOf("Team-BharatKumar-Beedu-Org"), membersOf("Team-Ashish-Kumar-Org")) ORDER BY created DESC'
FIELDS="summary,description,status,assignee,reporter,issuetype,priority,created,updated,resolution,fixVersions,labels"
PAGE_SIZE=100
START=0
TMP_PAGE="/tmp/jch-page.json"

# Start with empty issues array
echo '{"total":0,"issues":[]}' > "$RAW"

while true; do
  HTTP_CODE=$(curl -s -o "$TMP_PAGE" -w "%{http_code}" \
    -H "Authorization: Bearer $JIRA_PAT" \
    -H "Accept: application/json" \
    "$JIRA_BASE/rest/api/2/search" \
    --get \
    --data-urlencode "jql=$JQL" \
    --data-urlencode "maxResults=$PAGE_SIZE" \
    --data-urlencode "startAt=$START" \
    --data-urlencode "fields=$FIELDS")

  if [ "$HTTP_CODE" -eq 401 ]; then
    echo "✗ HTTP 401 — Authentication failed. PAT may be expired."
    echo "  Get a fresh one: JIRA → Avatar → Profile → Personal Access Tokens"
    exit 1
  elif [ "$HTTP_CODE" -eq 403 ]; then
    echo "✗ HTTP 403 — No permission to query project JCH."
    cat "$TMP_PAGE"
    exit 1
  elif [ "$HTTP_CODE" -ne 200 ]; then
    echo "✗ HTTP $HTTP_CODE — Unexpected error."
    cat "$TMP_PAGE"
    exit 1
  fi

  # Merge page into RAW
  python3 - <<'PYEOF'
import json, sys

raw_file  = "/tmp/jch-tickets.json"
page_file = "/tmp/jch-page.json"

with open(raw_file)  as f: acc  = json.load(f)
with open(page_file) as f: page = json.load(f)

page_issues = page.get("issues", [])
acc["issues"].extend(page_issues)
acc["total"] = page.get("total", acc["total"])

with open(raw_file, "w") as f:
    json.dump(acc, f, indent=2)

print(len(page_issues))
PYEOF

  PAGE_COUNT=$(python3 -c "
import json
with open('/tmp/jch-page.json') as f: d=json.load(f)
print(len(d.get('issues',[])))
")

  FETCHED=$(python3 -c "
import json
with open('/tmp/jch-tickets.json') as f: d=json.load(f)
print(len(d.get('issues',[])))
")

  TOTAL=$(python3 -c "
import json
with open('/tmp/jch-tickets.json') as f: d=json.load(f)
print(d.get('total',0))
")

  echo "  Fetched $FETCHED / $TOTAL ..."

  if [ "$PAGE_COUNT" -lt "$PAGE_SIZE" ] || [ "$FETCHED" -ge "$TOTAL" ]; then
    break
  fi

  START=$((START + PAGE_SIZE))
  sleep 0.3
done

echo "✓ Done — $FETCHED tickets saved to $RAW"
echo ""

# ── Generate report ──────────────────────────────────────────────────────────
echo "Generating report ..."

python3 - <<'PYEOF'
import json, re
from datetime import datetime
from collections import defaultdict

RAW    = "/tmp/jch-tickets.json"
REPORT = "/tmp/jch-report.md"

NO_CHANGE_RESOLUTIONS = {
    "won't fix", "wontfix", "duplicate", "cannot reproduce",
    "works as designed", "not a bug", "invalid",
    "no changes made", "no change required", "no change needed",
}

# ── Theme detection keywords ──────────────────────────────────────────────────
THEMES = {
    "🔐 Security & Compliance":     ["security", "auth", "tls", "ssl", "encrypt", "rbac", "permission", "audit", "compliance", "cve", "vulnerability"],
    "⚡ Performance & Scalability": ["performance", "latency", "slow", "timeout", "scale", "throughput", "memory", "cpu", "optimize", "bottleneck", "speed"],
    "🛡️ Reliability & Stability":   ["crash", "panic", "hang", "oom", "fail", "flak", "retry", "race condition", "deadlock", "corrupt", "data loss", "recovery", "ha", "high availability"],
    "🔧 Operability & Tooling":     ["cli", "log", "monitor", "alert", "debug", "telemetry", "metric", "dashboard", "script", "tool", "automation", "observ"],
    "🗄️ Database & Storage":        ["database", "postgres", "mysql", "oracle", "mssql", "storage", "disk", "backup", "snapshot", "clone", "volume", "era"],
    "🌐 API & Integration":         ["api", "rest", "endpoint", "webhook", "integration", "connector", "sdk", "client", "request", "response"],
    "🖥️ UI & User Experience":      ["ui", "ux", "interface", "page", "display", "dashboard", "button", "form", "error message", "tooltip", "validation"],
    "📦 Installation & Upgrade":    ["install", "upgrade", "migration", "deploy", "provision", "onboard", "setup", "config", "init"],
    "📋 Documentation & Process":   ["doc", "readme", "wiki", "runbook", "process", "workflow", "template", "guide"],
}

def detect_themes(text):
    text_lower = text.lower()
    matched = []
    for theme, keywords in THEMES.items():
        if any(kw in text_lower for kw in keywords):
            matched.append(theme)
    return matched if matched else ["🔩 General Improvements"]

with open(RAW) as f:
    data = json.load(f)

issues = data.get("issues", [])
today  = datetime.now().strftime("%Y-%m-%d")

valid   = []
no_chg  = []
other   = []

for issue in issues:
    key    = issue.get("key", "")
    fields = issue.get("fields", {})
    summary    = fields.get("summary", "").strip()
    status_obj = fields.get("status") or {}
    status     = (status_obj.get("name") or "").strip()
    res_obj    = fields.get("resolution") or {}
    resolution = (res_obj.get("name") or "").strip()
    issuetype  = ((fields.get("issuetype") or {}).get("name") or "").strip()
    priority   = ((fields.get("priority")  or {}).get("name") or "").strip()
    assignee   = ((fields.get("assignee")  or {}).get("displayName") or "Unassigned").strip()
    reporter   = ((fields.get("reporter")  or {}).get("displayName") or "").strip()
    created    = (fields.get("created") or "")[:10]
    updated    = (fields.get("updated") or "")[:10]
    fix_vers   = [v.get("name","") for v in (fields.get("fixVersions") or [])]
    labels     = fields.get("labels") or []
    description = fields.get("description") or ""

    closed_statuses = {"closed", "done", "resolved"}
    is_closed    = status.lower() in closed_statuses
    is_no_change = resolution.lower() in NO_CHANGE_RESOLUTIONS

    row = {
        "key": key, "summary": summary, "status": status,
        "resolution": resolution, "type": issuetype, "priority": priority,
        "assignee": assignee, "reporter": reporter, "created": created,
        "updated": updated,
        "fix_versions": ", ".join(fix_vers) if fix_vers else "—",
        "labels": ", ".join(labels) if labels else "—",
        "themes": detect_themes(summary + " " + (description[:500] if isinstance(description, str) else "")),
    }

    if is_closed and is_no_change:
        no_chg.append(row)
    elif is_closed and not is_no_change:
        valid.append(row)
    else:
        other.append(row)

def render_table(rows):
    lines = [
        "| Key | Summary | Status | Resolution | Type | Priority | Assignee | Fix Version | Created |",
        "|-----|---------|--------|------------|------|----------|----------|-------------|---------|",
    ]
    for r in rows:
        lines.append(
            f"| {r['key']} | {r['summary'][:70]} | {r['status']} | {r['resolution'] or '—'} "
            f"| {r['type']} | {r['priority']} | {r['assignee']} | {r['fix_versions']} | {r['created']} |"
        )
    return "\n".join(lines)

def render_blurb(rows):
    """Group valid-change tickets by theme and emit a bullet-per-theme narrative."""
    theme_map = defaultdict(list)
    for r in rows:
        for t in r["themes"]:
            theme_map[t].append(r)

    lines = []
    for theme in THEMES:
        tickets = theme_map.get(theme, [])
        if not tickets:
            continue
        # Build a compact bullet: theme header + up to 5 representative summaries
        lines.append(f"\n### {theme}")
        for t in tickets[:5]:
            lines.append(f"- **[{t['key']}]** {t['summary']}")
        if len(tickets) > 5:
            lines.append(f"- _(…and {len(tickets)-5} more)_")

    # Catch-all
    catchall = theme_map.get("🔩 General Improvements", [])
    if catchall:
        lines.append(f"\n### 🔩 General Improvements")
        for t in catchall[:5]:
            lines.append(f"- **[{t['key']}]** {t['summary']}")
        if len(catchall) > 5:
            lines.append(f"- _(…and {len(catchall)-5} more)_")

    return "\n".join(lines) if lines else "_No categorised improvements found._"

with open(REPORT, "w") as f:
    f.write(f"""---
report_type: Detailed
product: NDB
release: JCH
generated: {today}
data_source: live
audience: tpm
---

# JCH Ticket Report — NDB Improvements
*Generated: {today} | Total tickets: {len(issues)}*

---

## 💡 What We Made Better — NDB Improvements Summary
*Changes that have shipped and made NDB stronger, grouped by area.*
{render_blurb(valid)}

---

## ✅ Valid Changes Made ({len(valid)} tickets)
*Full list of closed/resolved tickets with an actual fix or implementation.*

""")
    f.write(render_table(valid) if valid else "_No tickets in this category._")

    f.write(f"""

---

## 🚫 Closed — No Changes Made ({len(no_chg)} tickets)
*Tickets closed as duplicate, won't fix, cannot reproduce, works as designed, etc.*

""")
    f.write(render_table(no_chg) if no_chg else "_No tickets in this category._")

    f.write(f"""

---

## 🔄 Open / In Progress ({len(other)} tickets)
*Tickets that are still active or not yet resolved.*

""")
    f.write(render_table(other) if other else "_No tickets in this category._")

    f.write(f"""

---
*Raw data: /tmp/jch-tickets.json*
""")

print(f"  ✅ Valid changes    : {len(valid)}")
print(f"  🚫 No changes made  : {len(no_chg)}")
print(f"  🔄 Open/In-progress : {len(other)}")
PYEOF

echo ""
echo "✓ Report saved to $REPORT"
echo ""
echo "Open with:  open $REPORT"
echo "            cat  $REPORT"
