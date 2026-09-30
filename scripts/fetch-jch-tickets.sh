#!/bin/bash
# fetch-jch-tickets.sh
#
# Fetches JCH project tickets filed by namratha.singh,
# members of Team-BharatKumar-Beedu-Org, and Team-Ashish-Kumar-Org.
#
# Prerequisites:
#   echo "your_jira_pat_token" > ~/.jira-pat
#   chmod 600 ~/.jira-pat

set -euo pipefail

PAT_FILE="$HOME/.jira-pat"
JIRA_BASE="https://jira.nutanix.com"
OUT="/tmp/jch-tickets.json"

# ── PAT check ────────────────────────────────────────────────────────────────
if [ ! -f "$PAT_FILE" ]; then
  echo ""
  echo "ERROR: PAT file not found at $PAT_FILE"
  echo ""
  echo "Create it with:"
  echo "  echo 'your_jira_pat_token' > ~/.jira-pat"
  echo "  chmod 600 ~/.jira-pat"
  echo ""
  echo "Get your PAT: JIRA → Avatar → Profile → Personal Access Tokens"
  exit 1
fi

JIRA_PAT=$(cat "$PAT_FILE" | tr -d '[:space:]')

if [ -z "$JIRA_PAT" ]; then
  echo "ERROR: $PAT_FILE is empty. Paste your JIRA PAT into it."
  exit 1
fi

# ── Fetch ────────────────────────────────────────────────────────────────────
echo ""
echo "Fetching JCH tickets from $JIRA_BASE ..."
echo ""

HTTP_CODE=$(curl -s -o "$OUT" -w "%{http_code}" \
  -H "Authorization: Bearer $JIRA_PAT" \
  -H "Accept: application/json" \
  "$JIRA_BASE/rest/api/2/search" \
  --get \
  --data-urlencode 'jql=project = JCH AND reporter in (namratha.singh, membersOf("Team-BharatKumar-Beedu-Org"), membersOf("Team-Ashish-Kumar-Org")) ORDER BY created DESC' \
  --data-urlencode 'maxResults=500' \
  --data-urlencode 'fields=summary,description,status,assignee,reporter,issuetype,priority,created,updated,resolution,fixVersions,labels,comment')

# ── Result check ─────────────────────────────────────────────────────────────
if [ "$HTTP_CODE" -eq 200 ]; then
  TOTAL=$(python3 -c "import json,sys; d=json.load(open('$OUT')); print(d.get('total',0))" 2>/dev/null || echo "?")
  echo "✓ Success (HTTP $HTTP_CODE)"
  echo "  Total tickets found : $TOTAL"
  echo "  Saved to            : $OUT"
  echo ""
elif [ "$HTTP_CODE" -eq 401 ]; then
  echo "✗ HTTP 401 — Authentication failed."
  echo "  Your PAT in $PAT_FILE may be expired or incorrect."
  echo "  Get a fresh one: JIRA → Avatar → Profile → Personal Access Tokens"
  exit 1
elif [ "$HTTP_CODE" -eq 403 ]; then
  echo "✗ HTTP 403 — You don't have permission to query project JCH."
  cat "$OUT"
  exit 1
else
  echo "✗ HTTP $HTTP_CODE — Unexpected error."
  cat "$OUT"
  exit 1
fi
