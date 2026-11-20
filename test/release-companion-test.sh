#!/usr/bin/env bash
set -euo pipefail
# Test script for release companion tickets + FEAT + JCH dedup
# Run: bash test/release-companion-test.sh
# Asks for username + PAT blind (paste, no echo), then hits live /api/jira/* endpoints on localhost:8001

BASE_URL="${BASE_URL:-http://localhost:8001}"
VERSION_DEFAULT="NDB-2.12.0.1"

echo "=== Release Companion Tickets — Live Test ==="
echo "Server: $BASE_URL (backend 8001, frontend 8899 should be running)"
echo

# Check server health
echo -n "Checking $BASE_URL/api/health ... "
if curl -sf "$BASE_URL/api/health" >/dev/null; then
  echo "OK"
else
  echo "FAIL — is backend running? Run: apps/delivery-ops/scripts/start.sh or npm start"
  exit 1
fi

echo
read -p "JIRA username (e.g. namratha.singh): " JIRA_USER
if [ -z "$JIRA_USER" ]; then echo "Username required"; exit 1; fi

# Blind password/PAT input — no echo
read -s -p "JIRA PAT (paste blind, no echo — hit Enter when done): " JIRA_PAT
echo
echo # newline after blind input
if [ -z "$JIRA_PAT" ]; then echo "PAT required"; exit 1; fi

read -p "Version to test [$VERSION_DEFAULT]: " VERSION
VERSION="${VERSION:-$VERSION_DEFAULT}"
echo
echo "Testing version: $VERSION as $JIRA_USER"
echo "=================================================="

AUTH_HDR="Authorization: Bearer $JIRA_PAT"
USER_HDR="X-Username: $JIRA_USER"

check_version() {
  local proj="$1"
  echo -n "  $proj ... "
  resp=$(curl -s -X POST "$BASE_URL/api/jira/check-version-exists" -H "$AUTH_HDR" -H "$USER_HDR" -H "Content-Type: application/json" -d "{\"projectKey\":\"$proj\",\"versionName\":\"$VERSION\"}")
  echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(('exists' if d.get('exists') else 'MISSING') + (' id='+str(d.get('versionId')) if d.get('exists') else '') + (' error='+d.get('error','')[:80] if d.get('error') else ''))" 2>&1 || echo "$resp"
}

check_jch() {
  local proj="$1"
  echo -n "  JCH for $proj ... "
  resp=$(curl -s -X POST "$BASE_URL/api/jira/check-jch-exists" -H "$AUTH_HDR" -H "$USER_HDR" -H "Content-Type: application/json" -d "{\"versionName\":\"$VERSION\",\"projectKey\":\"$proj\"}")
  echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print('exists='+str(d.get('exists')) + (' key='+d.get('key','') if d.get('exists') else ''))" 2>&1 || echo "$resp"
}

echo
echo "1) FEAT + companion projects fixVersion check (should include FEAT):"
for proj in ERA FEAT SDL LBDR TECHPUBS LEG SR; do
  check_version "$proj"
done

echo
echo "2) Companion tickets check (6 templates):"
resp=$(curl -s -X POST "$BASE_URL/api/jira/check-companion-tickets" -H "$AUTH_HDR" -H "$USER_HDR" -H "Content-Type: application/json" -d "{\"version\":\"$VERSION\"}")
echo "$resp" | python3 -m json.tool 2>&1 | head -n 60
missing=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('missingCount','?'))" 2>&1)
echo "Missing count: $missing (expect 6 if fresh, 0 if already created, 4 after LBDR×2 etc.)"

echo
echo "3) JCH dedup check (should NOT create duplicate if already exists):"
for proj in SDL LBDR TECHPUBS LEG; do
  check_jch "$proj"
done

echo
read -p "Create 1 test companion ticket (SDL blackduck) to verify dedup? [y/N]: " do_create
if [[ "$do_create" =~ ^[yY] ]]; then
  echo "Creating sdl-blackduck..."
  resp=$(curl -s -X POST "$BASE_URL/api/jira/create-companion-tickets" -H "$AUTH_HDR" -H "$USER_HDR" -H "Content-Type: application/json" -d "{\"version\":\"$VERSION\",\"ids\":[\"sdl-blackduck\"]}")
  echo "$resp" | python3 -m json.tool
  echo "Retrying same (should be skipped as already exists)..."
  resp2=$(curl -s -X POST "$BASE_URL/api/jira/create-companion-tickets" -H "$AUTH_HDR" -H "$USER_HDR" -H "Content-Type: application/json" -d "{\"version\":\"$VERSION\",\"ids\":[\"sdl-blackduck\"]}")
  echo "$resp2" | python3 -m json.tool
fi

echo
echo "4) Frontend check:"
echo -n "  GET http://localhost:8899/ ... "
if curl -sf http://localhost:8899/ | grep -q "bundle.js"; then echo "OK (bundle.js)"; else echo "FAIL"; fi
echo "  Open http://localhost:8899/release-setup in browser, type $VERSION, click Check JIRA — verify:"
echo "    - FEAT appears in version grid"
echo "    - Companion Tickets section shows 6 with Security badge on LBDR sign-off"
echo "    - Gap banner appears if release exists but tickets missing"
echo "    - JCH shows existing ticket link instead of duplicate create button"

echo
echo "Done. Paste the output above (without PAT) back to the assistant for verification."
# Clear PAT from memory (bash variable will go out of scope)
unset JIRA_PAT
