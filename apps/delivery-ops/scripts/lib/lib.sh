#!/usr/bin/env bash
# apps/delivery-ops/scripts/lib/lib.sh
#
# Universal stop/start/restart library for delivery-ops.
# Sourced by start.sh / stop.sh / restart.sh — never executed directly.
#
# CALLER CONTRACT:
#   PROJECT_ROOT  — absolute path to the project (set by each project's wrapper)
#
# CONFIGURATION (read from $PROJECT_ROOT/.env, all optional):
#
#   APP_NAME            Human label in log output          default: basename $PROJECT_ROOT
#   BACKEND_PORT        Backend listen port                default: auto-detect or 3000
#   FRONTEND_PORT       Frontend listen port               default: auto-detect or 3001
#   BACKEND_DIR         Absolute path to backend dir       default: auto-detected
#   FRONTEND_DIR        Absolute path to frontend dir      default: auto-detected (omit = API-only)
#   BACKEND_CMD         Shell command to launch backend    default: auto-detected
#   FRONTEND_CMD        Shell command to launch frontend   default: auto-detected
#   LOG_BACKUP_KEEP     Archived log sets to keep          default: 5
#   GRACEFUL_WAIT       Seconds between SIGTERM→SIGKILL    default: 3
#   HEALTH_CHECK_RETRIES                                   default: 12
#   HEALTH_CHECK_INTERVAL  Seconds between health retries  default: 5

# ── colours ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' BLUE='\033[0;34m' BOLD='\033[1m' NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi
info()   { echo -e "${BLUE}ℹ  $*${NC}"; }
ok()     { echo -e "${GREEN}✓  $*${NC}"; }
warn()   { echo -e "${YELLOW}⚠  $*${NC}"; }
err()    { echo -e "${RED}✗  $*${NC}"; }
banner() { echo -e "\n${BOLD}${YELLOW}═══ $* ═══${NC}\n"; }

# ── safety ────────────────────────────────────────────────────────────────────
[[ -z "${PROJECT_ROOT:-}" ]] && { err "PROJECT_ROOT not set. Use a project wrapper, not this script directly."; exit 1; }

# ── load .env ─────────────────────────────────────────────────────────────────
# Only exports lines that are clean KEY=value (no spaces around =, no shell-
# special values). This prevents errors from lines like JIRA_JQL=filter = 165194.
_load_env() {
  local f="$PROJECT_ROOT/.env"
  [[ -f "$f" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    # skip comments and blanks
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    # only process lines matching KEY=value with no spaces around =
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}" val="${BASH_REMATCH[2]}"
      # strip surrounding quotes if present
      val="${val#\"}" ; val="${val%\"}"
      val="${val#\'}"  ; val="${val%\'}"
      export "$key=$val"
    fi
  done < "$f"
}

# ── apply defaults ────────────────────────────────────────────────────────────
_apply_defaults() {
  APP_NAME="${APP_NAME:-$(basename "$PROJECT_ROOT")}"
  LOG_BACKUP_KEEP="${LOG_BACKUP_KEEP:-5}"
  GRACEFUL_WAIT="${GRACEFUL_WAIT:-3}"
  HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-12}"
  HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-5}"
  LOGS_DIR="$PROJECT_ROOT/logs"
  PIDFILE_BACKEND="$PROJECT_ROOT/.pid-backend"
  PIDFILE_FRONTEND="$PROJECT_ROOT/.pid-frontend"
  LOG_BACKEND="$LOGS_DIR/backend.log"
  LOG_FRONTEND="$LOGS_DIR/frontend.log"
}

# ── layout detection ──────────────────────────────────────────────────────────
# Handles four real-world layouts seen across your apps:
#
#   FLAT       root/server.js + root/public/          (ndb-story-point-calculator)
#   SERVER     root/server/ + root/client/            (ndb-status-sender, ndb-status-update-app)
#   BACKEND    root/backend/ + root/frontend/         (shipwatch in monorepo)
#   MONOREPO   root/<name>/backend/ + root/<name>/frontend/  (NDB-Outstanding monorepo)

_detect_dirs() {
  # ── backend ───────────────────────────────────────────────────────────────
  if [[ -z "${BACKEND_DIR:-}" ]]; then
    # 1. Explicit subdirs with their own package.json
    for candidate in backend server api; do
      [[ -d "$PROJECT_ROOT/$candidate" && -f "$PROJECT_ROOT/$candidate/package.json" ]] \
        && { BACKEND_DIR="$PROJECT_ROOT/$candidate"; break; }
    done

    # 2. Subdirs that have a JS entry point but no package.json (e.g. ndb-say-vs-do/server/)
    if [[ -z "${BACKEND_DIR:-}" ]]; then
      for candidate in backend server api; do
        for entry in index.js server.js app.js; do
          [[ -f "$PROJECT_ROOT/$candidate/$entry" ]] && { BACKEND_DIR="$PROJECT_ROOT/$candidate"; break 2; }
        done
      done
    fi

    # 3. Monorepo: <app>/backend/ or <app>/server/ one level down (with package.json)
    if [[ -z "${BACKEND_DIR:-}" ]]; then
      for subdir in "$PROJECT_ROOT"/*/; do
        for inner in backend server api; do
          [[ -d "${subdir}${inner}" && -f "${subdir}${inner}/package.json" ]] \
            && { BACKEND_DIR="${subdir}${inner}"; break 2; }
        done
      done
    fi

    # 4. Flat: server.js / index.js at project root (no sub-dir)
    if [[ -z "${BACKEND_DIR:-}" ]]; then
      for entry in server.js index.js app.js; do
        [[ -f "$PROJECT_ROOT/$entry" ]] && { BACKEND_DIR="$PROJECT_ROOT"; break; }
      done
    fi

    BACKEND_DIR="${BACKEND_DIR:-$PROJECT_ROOT}"
  fi

  # ── frontend ──────────────────────────────────────────────────────────────
  if [[ -z "${FRONTEND_DIR:-}" ]]; then
    # 1. Explicit subdirs with their own package.json
    for candidate in frontend client web ui; do
      [[ -d "$PROJECT_ROOT/$candidate" && -f "$PROJECT_ROOT/$candidate/package.json" ]] \
        && { FRONTEND_DIR="$PROJECT_ROOT/$candidate"; break; }
    done

    # 2. Monorepo: sibling of backend dir
    if [[ -z "${FRONTEND_DIR:-}" && "$BACKEND_DIR" != "$PROJECT_ROOT" ]]; then
      local parent; parent="$(dirname "$BACKEND_DIR")"
      for candidate in frontend client web ui; do
        [[ -d "$parent/$candidate" && -f "$parent/$candidate/package.json" ]] \
          && { FRONTEND_DIR="$parent/$candidate"; break; }
      done
    fi
    # FRONTEND_DIR stays empty for API-only / flat projects — that's correct
  fi
}

# ── port detection ────────────────────────────────────────────────────────────
# Reads PORT from the service's own package.json scripts or .env lines.
_port_from_pkg() {
  local pkg="$1"
  [[ -f "$pkg" ]] || return
  # e.g. "PORT=6001" or "PORT=6100" inside script strings
  python3 - "$pkg" <<'PY' 2>/dev/null
import sys, json, re
d = json.load(open(sys.argv[1]))
for v in d.get("scripts", {}).values():
    m = re.search(r'(?<!\w)PORT=(\d+)', v)
    if m:
        print(m.group(1)); sys.exit(0)
PY
}

_port_from_env() {
  local envfile="$1" key="$2"
  [[ -f "$envfile" ]] || { echo ""; return; }
  grep -E "^${key}=[0-9]+" "$envfile" 2>/dev/null | head -1 | cut -d= -f2
}

_port_from_source() {
  local dir="$1" result=""
  for f in "$dir/index.js" "$dir/server.js" "$dir/app.js" "$dir/src/server.js"; do
    [[ -f "$f" ]] || continue
    # const PORT = process.env.PORT || 3186
    result=$(grep -oE 'PORT \|\| [0-9]+' "$f" 2>/dev/null | head -1 | grep -oE '[0-9]+$')
    [[ -n "$result" ]] && { echo "$result"; return; }
    # const PORT = 6001;
    result=$(grep -oE 'PORT = [0-9]+' "$f" 2>/dev/null | head -1 | grep -oE '[0-9]+$')
    [[ -n "$result" ]] && { echo "$result"; return; }
    # app.listen(4000,
    result=$(grep -oE 'listen\([0-9]+' "$f" 2>/dev/null | head -1 | grep -oE '[0-9]+')
    [[ -n "$result" ]] && { echo "$result"; return; }
  done
  echo ""
}

_first_port() {
  # Returns first non-empty value from a list of candidates
  local val
  for val in "$@"; do
    [[ -n "$val" ]] && { echo "$val"; return; }
  done
  echo ""
}

_detect_ports() {
  if [[ -z "${BACKEND_PORT:-}" ]]; then
    local p
    p=$(_first_port \
      "$(_port_from_env "$PROJECT_ROOT/.env" "PORT")" \
      "$(_port_from_env "$BACKEND_DIR/.env" "PORT")" \
      "$(_port_from_source "$BACKEND_DIR")" \
      "$(_port_from_pkg "$BACKEND_DIR/package.json")" \
    )
    BACKEND_PORT="${p:-3000}"
  fi

  if [[ -z "${FRONTEND_PORT:-}" && -n "${FRONTEND_DIR:-}" ]]; then
    local p
    p=$(_first_port \
      "$(_port_from_env "$PROJECT_ROOT/.env" "FRONTEND_PORT")" \
      "$(_port_from_pkg "$FRONTEND_DIR/package.json")" \
      "$(_port_from_source "$FRONTEND_DIR")" \
    )
    FRONTEND_PORT="${p:-$((BACKEND_PORT + 1))}"
  fi
}

# ── command detection ─────────────────────────────────────────────────────────
_detect_cmds() {
  if [[ -z "${BACKEND_CMD:-}" ]]; then
    local pkg="$BACKEND_DIR/package.json"
    if [[ -f "$pkg" ]] && python3 -c "import sys,json; sys.exit(0 if 'start' in json.load(open('$pkg')).get('scripts',{}) else 1)" 2>/dev/null; then
      BACKEND_CMD="npm start"
    elif [[ -f "$BACKEND_DIR/src/server.js" ]]; then
      BACKEND_CMD="node src/server.js"
    elif [[ -f "$BACKEND_DIR/server.js" ]]; then
      BACKEND_CMD="node server.js"
    elif [[ -f "$BACKEND_DIR/index.js" ]]; then
      BACKEND_CMD="node index.js"
    else
      BACKEND_CMD="npm start"
    fi
  fi

  if [[ -z "${FRONTEND_CMD:-}" && -n "${FRONTEND_DIR:-}" ]]; then
    local pkg="$FRONTEND_DIR/package.json"
    if [[ -f "$pkg" ]] && python3 -c "
import sys, json
d = json.load(open('$pkg'))
deps = {**d.get('dependencies',{}), **d.get('devDependencies',{})}
sys.exit(0 if 'vite' in deps else 1)
" 2>/dev/null; then
      FRONTEND_CMD="npx vite --port \$FRONTEND_PORT --strictPort"
    elif [[ -f "$pkg" ]]; then
      # CRA — PORT env var controls the port
      FRONTEND_CMD="PORT=\$FRONTEND_PORT BROWSER=none npm start"
    else
      FRONTEND_CMD="npm start"
    fi
  fi
}

# ── port / pid helpers ────────────────────────────────────────────────────────
_pids_on_port() { lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null || true; }

_kill_gracefully() {
  [[ -z "${1:-}" ]] && return
  for pid in $1; do kill -TERM "$pid" 2>/dev/null || true; done
  sleep "$GRACEFUL_WAIT"
}

_kill_force() {
  [[ -z "${1:-}" ]] && return
  for pid in $1; do kill -9 "$pid" 2>/dev/null || true; done
  sleep 1
}

_pid_alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

# ── stop one service ──────────────────────────────────────────────────────────
_stop_service() {
  local name="$1" pidfile="$2" port="$3"

  if _pid_alive "$pidfile"; then
    local pid; pid=$(cat "$pidfile")
    _kill_gracefully "$pid"
    _kill_force "$(_pids_on_port "$port")"
    rm -f "$pidfile"
    ok "stopped $name (pid $pid)"
    return
  fi

  rm -f "$pidfile" 2>/dev/null || true
  local pids; pids=$(_pids_on_port "$port")
  if [[ -n "$pids" ]]; then
    _kill_gracefully "$pids"
    _kill_force "$(_pids_on_port "$port")"
    ok "stopped $name on :$port"
  else
    info "$name: nothing on :$port"
  fi
}

# ── log backup ────────────────────────────────────────────────────────────────
_backup_logs() {
  mkdir -p "$LOGS_DIR/archive"
  local any=false
  for f in "$LOGS_DIR"/*.log; do [[ -f "$f" ]] && any=true && break; done
  $any || return 0

  local stamp dest
  stamp=$(date +%Y-%m-%d_%H-%M-%S)
  dest="$LOGS_DIR/archive/restart-$stamp"
  mkdir -p "$dest"
  cp "$LOGS_DIR"/*.log "$dest/" 2>/dev/null || true
  ok "logs archived → logs/archive/restart-$stamp/"

  # prune oldest archives
  local archives=()
  while IFS= read -r d; do archives+=("$d"); done < <(ls -1td "$LOGS_DIR"/archive/restart-* 2>/dev/null)
  local count=${#archives[@]}
  if (( count > LOG_BACKUP_KEEP )); then
    printf '%s\n' "${archives[@]:$LOG_BACKUP_KEEP}" | xargs rm -rf
    info "pruned $(( count - LOG_BACKUP_KEEP )) old archive(s)"
  fi
}

# ── dependency check ──────────────────────────────────────────────────────────
_check_deps() {
  local dirs=()
  # Root (monorepo workspace root)
  [[ -f "$PROJECT_ROOT/package.json" ]] && dirs+=("$PROJECT_ROOT")
  # Backend / frontend (skip if same as root)
  [[ -f "$BACKEND_DIR/package.json" && "$BACKEND_DIR" != "$PROJECT_ROOT" ]] && dirs+=("$BACKEND_DIR")
  [[ -n "${FRONTEND_DIR:-}" && -f "$FRONTEND_DIR/package.json" ]] && dirs+=("$FRONTEND_DIR")

  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir/node_modules" || "$dir/package.json" -nt "$dir/node_modules" ]]; then
      info "installing deps: ${dir#$PROJECT_ROOT/}…"
      (cd "$dir" && npm install)
      ok "deps ready: ${dir#$PROJECT_ROOT/}"
    fi
  done
}

# ── health check ──────────────────────────────────────────────────────────────
_health_url() { curl -sf --connect-timeout 2 "$1" >/dev/null 2>&1; }

_wait_healthy() {
  info "waiting for services (up to $((HEALTH_CHECK_RETRIES * HEALTH_CHECK_INTERVAL))s)…"
  local i=0
  while (( i < HEALTH_CHECK_RETRIES )); do
    local b_ok=false f_ok=false
    _health_url "http://127.0.0.1:${BACKEND_PORT}/api/health" && b_ok=true || true
    [[ -n "${FRONTEND_DIR:-}" ]] && { _health_url "http://127.0.0.1:${FRONTEND_PORT}/" && f_ok=true || true; }
    [[ -z "${FRONTEND_DIR:-}" ]] && f_ok=true

    if $b_ok && $f_ok; then
      ok "all services healthy"
      return 0
    fi
    (( i++ ))
    sleep "$HEALTH_CHECK_INTERVAL"
  done
  warn "health-check timed out — services may still be starting (check logs/)"
  return 1
}

# ── start one service ─────────────────────────────────────────────────────────
_start_service() {
  local name="$1" dir="$2" cmd="$3" pidfile="$4" logfile="$5"

  if _pid_alive "$pidfile"; then
    warn "$name already running (pid $(cat "$pidfile")) — skipping"
    return
  fi

  mkdir -p "$(dirname "$logfile")"
  # Expand $FRONTEND_PORT / $BACKEND_PORT inside cmd
  local resolved_cmd
  resolved_cmd=$(eval echo "$cmd")
  ( cd "$dir" && eval "$resolved_cmd" >>"$logfile" 2>&1 ) &
  echo $! > "$pidfile"
  local port_var
  port_var="$(echo "$name" | tr '[:lower:]' '[:upper:]')_PORT"
  ok "started $name :${!port_var} (pid $(cat "$pidfile")) → ${logfile#$PROJECT_ROOT/}"
}

# Tiny helper so _start_service can print the right port
_start_backend()  {
  _start_service "backend"  "$BACKEND_DIR"  "$BACKEND_CMD"  "$PIDFILE_BACKEND"  "$LOG_BACKEND"
  echo -e "  ${BLUE}backend${NC}   http://localhost:${BACKEND_PORT}"
}
_start_frontend() {
  [[ -z "${FRONTEND_DIR:-}" ]] && return
  _start_service "frontend" "$FRONTEND_DIR" "$FRONTEND_CMD" "$PIDFILE_FRONTEND" "$LOG_FRONTEND"
  echo -e "  ${BLUE}frontend${NC}  http://localhost:${FRONTEND_PORT}"
}

# ── public API ────────────────────────────────────────────────────────────────
lifecycle_init() {
  _load_env
  _apply_defaults
  _detect_dirs
  _detect_ports
  _detect_cmds
}

do_stop() {
  banner "$APP_NAME — stop"
  _stop_service "backend"  "$PIDFILE_BACKEND"  "$BACKEND_PORT"
  [[ -n "${FRONTEND_DIR:-}" ]] && _stop_service "frontend" "$PIDFILE_FRONTEND" "$FRONTEND_PORT"
}

do_start() {
  banner "$APP_NAME — start"
  _backup_logs
  _check_deps
  echo ""
  _start_backend
  _start_frontend
  echo ""
  _wait_healthy || true
}

do_restart() {
  banner "$APP_NAME — restart"
  do_stop
  do_start
}
