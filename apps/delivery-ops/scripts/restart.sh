#!/usr/bin/env bash
set -euo pipefail
export PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$(dirname "${BASH_SOURCE[0]}")/lib/lib.sh"
lifecycle_init
do_restart

# ---- bin-packing standalone on 8890 ----
BINPACKING_PORT="${BINPACKING_PORT:-8890}"
BINPACKING_PIDFILE="$PROJECT_ROOT/.pid-binpacking"
BINPACKING_ROOT="$(cd "$PROJECT_ROOT/../bin-packing" && pwd)"
BINPACKING_LOG="$PROJECT_ROOT/logs/binpacking.log"
# stop
if [[ -f "$BINPACKING_PIDFILE" ]] && kill -0 "$(cat "$BINPACKING_PIDFILE")" 2>/dev/null; then pid=$(cat "$BINPACKING_PIDFILE"); kill -TERM "$pid" 2>/dev/null || true; sleep 2; kill -9 "$pid" 2>/dev/null || true; rm -f "$BINPACKING_PIDFILE"; fi
lsof -ti :"$BINPACKING_PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
# start
mkdir -p "$(dirname "$BINPACKING_LOG")" "$BINPACKING_ROOT"
if command -v npx >/dev/null 2>&1 && npx --yes serve --help >/dev/null 2>&1; then
  (cd "$BINPACKING_ROOT" && nohup npx --yes serve . -l "$BINPACKING_PORT" --cors >>"$BINPACKING_LOG" 2>&1 & echo $! > "$BINPACKING_PIDFILE")
else
  (cd "$BINPACKING_ROOT" && nohup python3 -m http.server "$BINPACKING_PORT" >>"$BINPACKING_LOG" 2>&1 & echo $! > "$BINPACKING_PIDFILE")
fi
echo "✓ bin-packing :${BINPACKING_PORT} (pid $(cat "$BINPACKING_PIDFILE")) → ${BINPACKING_LOG#$PROJECT_ROOT/}  http://localhost:${BINPACKING_PORT}"
