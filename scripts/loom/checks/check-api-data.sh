#!/usr/bin/env bash
# API Data Gate — every API touched must prove live non-empty data before merge.
# See agent-pack/loom/rules/api-data-gate.mdc and weave.mdc stage 8.7.
#
# Usage:
#   bash scripts/loom/checks/check-api-data.sh              # auto-detect touched APIs from diff
#   bash scripts/loom/checks/check-api-data.sh --all        # check all known AI + JIRA endpoints
#   ENDPOINTS="POST /api/ai/exec-summary,GET /api/jira/releases" bash scripts/loom/checks/check-api-data.sh # check only listed
#
# Contract:
#   - For each touched endpoint: hit live (server on 8001), assert HTTP 200 + non-empty body.
#   - For POST /api/ai/*: additionally assert finish_reason != "length" and content non-empty.
#   - Exit 0 only if every touched endpoint passes; exit 1 blocks merge (Blocking MISS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

# dev harness default — not deployed app code; override via API_DATA_GATE_BASE_URL per port-and-env-contracts.mdc:8001
BASE_URL="${API_DATA_GATE_BASE_URL:-http://localhost:8001}"
ALL_FLAG=0
if [[ "${1:-}" == "--all" ]]; then ALL_FLAG=1; fi

# -- Resolve what was touched: diff vs main + untracked + client fetch heuristic.
resolve_touched() {
  local diff_files=""
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    diff_files="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
    # Include untracked files (new routes not yet staged)
    local untracked
    untracked="$(git ls-files --others --exclude-standard 2>/dev/null || true)"
    if [[ -n "$untracked" ]]; then
      diff_files="$diff_files
$untracked"
    fi
  fi
  if [[ -z "$diff_files" ]]; then
    diff_files="$(git diff --name-only HEAD 2>/dev/null || true)"
  fi

  local touched=""
  local has_ai=0 has_cfg=0 has_jira=0 has_routes=0

  # Any server route change triggers the gate (broad: all routes, not just ai/jira)
  if echo "$diff_files" | grep -qE 'apps/delivery-ops/server/routes/|server/routes/'; then
    has_routes=1
    touched="$touched,server routes"
  fi
  # AI transport / prompt / config is an AI change specifically
  if echo "$diff_files" | grep -qE 'apps/delivery-ops/server/services/naiService|apps/delivery-ops/server/config/aiConfig|shared/src/connectors/aiConnector|server/services/naiService|server/config/aiConfig'; then
    has_ai=1
    touched="$touched,ai transport/prompt/config"
  fi
  # Client fetch — use diff patch content, not just filenames (filenames never contain fetch())
  if git diff origin/main...HEAD -p 2>/dev/null | grep -qE "fetch\(.*\/api\/|authenticatedPost\(.*\/api\/|apiService" \
    || git diff HEAD -p 2>/dev/null | grep -qE "fetch\(.*\/api\/|authenticatedPost\(.*\/api\/|apiService"; then
    touched="$touched,client api call"
  fi

  # Classify for granular probing
  if echo "$diff_files" | grep -qE 'server/routes/ai|naiService|aiConfig|aiConnector'; then
    has_ai=1
  fi
  if echo "$diff_files" | grep -qE 'server/routes/config|releaseVersions'; then
    has_cfg=1
  fi
  if echo "$diff_files" | grep -qE 'server/routes/jira|jiraConnector'; then
    has_jira=1
  fi

  # Export flags for granular probe selection
  export API_GATE_HAS_AI="$has_ai"
  export API_GATE_HAS_CFG="$has_cfg"
  export API_GATE_HAS_JIRA="$has_jira"
  export API_GATE_HAS_ROUTES="$has_routes"

  echo "$touched"
}

# -- Check if server is up — single canonical probe
is_up() {
  curl -sf --max-time 3 "$BASE_URL/api/health" >/dev/null 2>&1
}

# -- Probe one endpoint; returns 0 on pass, 1 on fail (prints one line)
probe() {
  local method="$1" path="$2" label="$3"
  local url="$BASE_URL$path"
  local body_file
  body_file="$(mktemp)"
  trap 'rm -f "$body_file"' RETURN
  local http_code
  http_code="$(curl -s -o "$body_file" -w "%{http_code}" --max-time 15 -X "$method" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TEST_JIRA_TOKEN:-dummy}" \
    -H "x-username: ${TEST_USERNAME:-test.user}" \
    "$url" 2>/dev/null || echo "000")"
  local body
  body="$(cat "$body_file" 2>/dev/null || true)"

  if [[ "$http_code" == "401" || "$http_code" == "403" ]]; then
    echo "  STALE  $label  $method $path → HTTP $http_code (no live token; needs live proof before merge to main)"
    return 1
  fi

  if [[ "$http_code" != "200" ]]; then
    echo "  FAIL   $label  $method $path → HTTP $http_code (expected 200) body: ${body:0:120}"
    return 1
  fi

  local trimmed
  trimmed="$(echo "$body" | tr -d '[:space:]')"
  if [[ -z "$trimmed" || "$trimmed" == "{}" || "$trimmed" == "[]" || "$trimmed" == "null" ]]; then
    echo "  FAIL   $label  $method $path → 200 but empty body"
    return 1
  fi

  if echo "$path" | grep -qE '/api/ai/'; then
    if echo "$body" | grep -q '"finish_reason"[[:space:]]*:[[:space:]]*"length"'; then
      echo "  FAIL   $label  $method $path → 200 but finish_reason=length (reasoning burned maxTokens, no content)"
      return 1
    fi
    if echo "$body" | grep -q '"finishReason"[[:space:]]*:[[:space:]]*"length"'; then
      echo "  FAIL   $label  $method $path → 200 but finishReason=length"
      return 1
    fi
    if echo "$body" | grep -qE '"content"[[:space:]]*:[[:space:]]*""|"summary"[[:space:]]*:[[:space:]]*""'; then
      echo "  FAIL   $label  $method $path → 200 but content/summary is empty string"
      return 1
    fi
  fi

  local preview
  preview="$(echo "$body" | tr '\n' ' ' | cut -c1-100)"
  echo "  ok     $label  $method $path → 200 non-empty (${preview})"
  return 0
}

# -- Main
echo "▶ API Data Gate — every API touched must prove live non-empty data"
echo "  base: $BASE_URL"
echo ""

TOUCHED="$(resolve_touched)"

# ENDPOINTS override: caller specifies exact METHOD PATH list to probe (comma-separated)
if [[ -n "${ENDPOINTS:-}" ]]; then
  echo "  endpoints (from ENDPOINTS env): $ENDPOINTS"
  if ! is_up; then
    echo "  Server not reachable at $BASE_URL — cannot prove live data."
    echo "  Start it: node apps/delivery-ops/server/index.js  (port 8001)"
    echo "  check:api-data FAIL — server down, cannot verify APIs return data"
    exit 1
  fi
  echo "  server: up"
  echo ""
  FAIL=0
  IFS=',' read -ra EPS <<< "$ENDPOINTS"
  for ep in "${EPS[@]}"; do
    ep="$(echo "$ep" | xargs)"
    [[ -z "$ep" ]] && continue
    m="$(echo "$ep" | awk '{print $1}')"
    p="$(echo "$ep" | awk '{print $2}')"
    label="$(echo "$p" | tr '/' '-' | sed 's/^-//')"
    probe "$m" "$p" "$label" || FAIL=1
  done
  echo ""
  if [[ $FAIL -ne 0 ]]; then
    echo "check:api-data FAIL — one or more APIs did not return non-empty data. Fix before Merge. No waivers."
    exit 1
  fi
  echo "check:api-data PASS — every listed API returned live non-empty data."
  exit 0
fi

if [[ "$ALL_FLAG" -eq 1 ]]; then
  echo "  mode: --all (all known AI + JIRA endpoints)"
elif [[ -z "$TOUCHED" ]]; then
  echo "  No API-touched files in diff — gate N/A (no API surface changed)."
  echo "  check:api-data PASS (N/A — no API touched)"
  exit 0
else
  echo "  touched signals: ${TOUCHED#, }"
fi

if ! is_up; then
  echo "  Server not reachable at $BASE_URL — cannot prove live data."
  echo "  Start it: node apps/delivery-ops/server/index.js  (port 8001)"
  echo "  check:api-data FAIL — server down, cannot verify APIs return data"
  exit 1
fi
echo "  server: up"
echo ""

FAIL=0

# Health is always probed when gate runs — sanity that server is live
probe GET "/api/health" "health" || true

# Granular: only probe AI when AI surface was touched (avoids false STALE on creds for non-AI changes)
if [[ "${API_GATE_HAS_AI:-0}" == "1" ]] || [[ "${API_GATE_HAS_ROUTES:-0}" == "1" ]] || [[ "$ALL_FLAG" -eq 1 ]]; then
  # Probe all known LLM routes per api-data-gate.mdc contract
  for route in \
    "POST /api/ai/exec-summary ai:exec-summary" \
    "POST /api/ai/oncall-concern ai:oncall-concern" \
    "POST /api/ai/oncall-slice ai:oncall-slice" \
    "POST /api/ai/cfdcfi-concern ai:cfdcfi-concern" \
    "POST /api/ai/cfdcfi-slice ai:cfdcfi-slice" \
    "POST /api/ai/release-summary ai:release-summary" \
    "POST /api/ai/page-briefing ai:page-briefing"
  do
    m="$(echo "$route" | awk '{print $1}')"
    p="$(echo "$route" | awk '{print $2}')"
    l="$(echo "$route" | awk '{print $3}')"
    probe "$m" "$p" "$l" || FAIL=1
  done
fi

# JIRA — probe on --all only (POST /api/jira/release-versions needs auth; health+config already prove live)
if [[ "$ALL_FLAG" -eq 1 ]]; then
  probe POST "/api/jira/release-versions" "jira:release-versions" || true  # STALE on no-creds is OK for --all
fi

# Config — probed when config touched or any route touched or --all
if [[ "${API_GATE_HAS_CFG:-0}" == "1" ]] || [[ "${API_GATE_HAS_ROUTES:-0}" == "1" ]] || [[ "$ALL_FLAG" -eq 1 ]]; then
  probe GET "/api/config/release-versions" "cfg:release-versions" || FAIL=1
fi

echo ""
if [[ $FAIL -ne 0 ]]; then
  echo "check:api-data FAIL — one or more APIs did not return non-empty data. Fix before Merge. No waivers."
  exit 1
fi
echo "check:api-data PASS — every touched API returned live non-empty data."
