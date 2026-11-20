#!/usr/bin/env bash
set -euo pipefail
export PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$(dirname "${BASH_SOURCE[0]}")/lib/lib.sh"
lifecycle_init
do_stop

# ---- bin-packing standalone on 8890 ----
BINPACKING_PORT="${BINPACKING_PORT:-8890}"
BINPACKING_PIDFILE="$PROJECT_ROOT/.pid-binpacking"
if [[ -f "$BINPACKING_PIDFILE" ]] && kill -0 "$(cat "$BINPACKING_PIDFILE")" 2>/dev/null; then
  pid=$(cat "$BINPACKING_PIDFILE"); kill -TERM "$pid" 2>/dev/null || true; sleep 2; kill -9 "$pid" 2>/dev/null || true; rm -f "$BINPACKING_PIDFILE"
  echo "✓ stopped bin-packing (pid $pid)"
else
  rm -f "$BINPACKING_PIDFILE" 2>/dev/null || true
  pids=$(lsof -ti :"$BINPACKING_PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then kill -TERM $pids 2>/dev/null || true; sleep 2; lsof -ti :"$BINPACKING_PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true; echo "✓ stopped bin-packing on :$BINPACKING_PORT"; else echo "ℹ bin-packing: nothing on :$BINPACKING_PORT"; fi
fi
