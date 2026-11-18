#!/usr/bin/env bash
# ~/.ntnx/app-lifecycle/deploy.sh
#
# Generic deploy script: packages the local project, pushes to a remote server
# via SCP/SSH, and runs the on-server lifecycle (build → PM2 restart → Nginx reload).
#
# CALLER CONTRACT:
#   PROJECT_ROOT  — set by project-level ./deploy wrapper
#
# REQUIRED in $PROJECT_ROOT/.env:
#   DEPLOY_SERVER   — user@host  (e.g. santhosh.s@santhosh-s-1.umsvm.nutanix.com)
#   DEPLOY_PATH     — absolute path on server (e.g. /var/www/html/ndb-status-sender)
#
# OPTIONAL in $PROJECT_ROOT/.env (all have sensible defaults):
#   APP_NAME             — human label + PM2 process name   (default: basename PROJECT_ROOT)
#   BACKEND_PORT         — backend listen port              (default: auto-detect or 3000)
#   FRONTEND_PORT        — Nginx/frontend port              (default: auto-detect or BACKEND_PORT+1)
#   BACKEND_DIR          — subdir with backend code         (default: auto-detect)
#   FRONTEND_DIR         — subdir with frontend code        (default: auto-detect; omit = API-only)
#   BACKEND_ENTRY        — JS entry point relative to BACKEND_DIR (default: auto-detect)
#   DEPLOY_BUILD_ENV     — extra env vars injected into npm run build (default: "")
#   NGINX_CONF           — local nginx config file to install on server (default: auto-detect)
#   DEPLOY_EXCLUDE       — space-separated extra zip exclusion patterns
#   DEPLOY_BACKUP_KEEP   — number of backups to retain on server (default: 5)
#   NO_LOCALHOST_CHECK   — set to "1" to skip localhost check (default: run if script exists)

set -euo pipefail

# ── source lib for colours, port/dir detection and helpers ───────────────────
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/lib.sh"
lifecycle_init   # loads .env, sets APP_NAME, BACKEND/FRONTEND _PORT/_DIR/_CMD

# ── colours already set by lib.sh ────────────────────────────────────────────
step()   { echo -e "\n${BLUE}▶  $*${NC}"; }
die()    { err "$*"; exit 1; }

# ── validate required config ─────────────────────────────────────────────────
[[ -z "${DEPLOY_SERVER:-}" ]] && die "DEPLOY_SERVER not set. Add it to $PROJECT_ROOT/.env"
[[ -z "${DEPLOY_PATH:-}"   ]] && die "DEPLOY_PATH not set. Add it to $PROJECT_ROOT/.env"

DEPLOY_BACKUP_KEEP="${DEPLOY_BACKUP_KEEP:-5}"
DEPLOY_BUILD_ENV="${DEPLOY_BUILD_ENV:-}"
DEPLOY_EXCLUDE="${DEPLOY_EXCLUDE:-}"

# Auto-detect nginx config file if not specified
if [[ -z "${NGINX_CONF:-}" ]]; then
  for candidate in \
    "$PROJECT_ROOT/nginx-${APP_NAME}.conf" \
    "$PROJECT_ROOT/nginx.conf" \
    "$PROJECT_ROOT/${APP_NAME}.conf"; do
    [[ -f "$candidate" ]] && { NGINX_CONF="$candidate"; break; }
  done
fi

# Auto-detect backend entry point (for PM2 start fallback)
if [[ -z "${BACKEND_ENTRY:-}" ]]; then
  for candidate in index.js server.js app.js src/server.js; do
    [[ -f "$BACKEND_DIR/$candidate" ]] && { BACKEND_ENTRY="$candidate"; break; }
  done
  BACKEND_ENTRY="${BACKEND_ENTRY:-index.js}"
fi

# Relative backend dir from project root (used for PM2 path on server)
BACKEND_REL="${BACKEND_DIR#$PROJECT_ROOT/}"
[[ "$BACKEND_REL" == "$PROJECT_ROOT" ]] && BACKEND_REL="."

FRONTEND_REL=""
[[ -n "${FRONTEND_DIR:-}" ]] && FRONTEND_REL="${FRONTEND_DIR#$PROJECT_ROOT/}"

# ── args ──────────────────────────────────────────────────────────────────────
SKIP_BUILD=false
FORCE=false
DRY_RUN=false

usage() {
  echo "Usage: ./deploy [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --no-build     Skip frontend rebuild on server"
  echo "  --force        Skip port-conflict checks on server"
  echo "  --dry-run      Show what would happen; don't transfer or run remote commands"
  echo "  --help, -h     Show this help"
  echo ""
  echo "Configuration (in .env):"
  echo "  DEPLOY_SERVER=$DEPLOY_SERVER"
  echo "  DEPLOY_PATH=$DEPLOY_PATH"
  echo "  APP_NAME=$APP_NAME"
  echo "  BACKEND_PORT=$BACKEND_PORT"
  [[ -n "$FRONTEND_REL" ]] && echo "  FRONTEND_PORT=${FRONTEND_PORT:-auto}"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)   SKIP_BUILD=true;  shift ;;
    --force)      FORCE=true;       shift ;;
    --dry-run)    DRY_RUN=true;     shift ;;
    --help|-h)    usage ;;
    *)            die "Unknown option: $1 (use --help)" ;;
  esac
done

# ── helpers ───────────────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE="${APP_NAME}-${TIMESTAMP}.zip"

confirm() {
  echo -e "\n${YELLOW}$*${NC}"
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { warn "Cancelled."; exit 0; }
}

# ── pre-flight ────────────────────────────────────────────────────────────────
step "Pre-flight checks"

for cmd in zip scp ssh; do
  command -v "$cmd" >/dev/null 2>&1 || die "$cmd not found"
done

# localhost check (project-specific script, optional)
if [[ "${NO_LOCALHOST_CHECK:-}" != "1" ]]; then
  if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    HAS_CHECK=$(python3 -c "
import json, sys
d = json.load(open('$PROJECT_ROOT/package.json'))
print('yes' if 'check:no-localhost' in d.get('scripts', {}) else 'no')
" 2>/dev/null || echo "no")
    if [[ "$HAS_CHECK" == "yes" ]]; then
      step "Checking for hardcoded localhost in app code"
      (cd "$PROJECT_ROOT" && npm run check:no-localhost) \
        || die "Hardcoded localhost found — fix before deploying"
      ok "No hardcoded localhost"
    fi
  fi
fi

# ── show deployment plan ──────────────────────────────────────────────────────
banner "$APP_NAME — deploy to production"
echo -e "  Source       ${YELLOW}$PROJECT_ROOT${NC}"
echo -e "  Server       ${YELLOW}$DEPLOY_SERVER${NC}"
echo -e "  Remote path  ${YELLOW}$DEPLOY_PATH${NC}"
echo -e "  Archive      ${YELLOW}$ARCHIVE${NC}"
echo -e "  Backend      ${YELLOW}:$BACKEND_PORT${NC}  ($BACKEND_REL/$BACKEND_ENTRY)"
[[ -n "$FRONTEND_REL" ]] && echo -e "  Frontend     ${YELLOW}:${FRONTEND_PORT:-?}${NC}  ($FRONTEND_REL)"
[[ -n "${NGINX_CONF:-}" ]] && echo -e "  Nginx conf   ${YELLOW}$(basename "$NGINX_CONF")${NC}"
$SKIP_BUILD  && echo -e "  Build        ${YELLOW}skipped${NC}"
$DRY_RUN     && echo -e "\n  ${RED}DRY RUN — nothing will be transferred${NC}"
echo ""

$DRY_RUN || confirm "Deploy $APP_NAME to $DEPLOY_SERVER?"

# ── step 1: create archive ────────────────────────────────────────────────────
step "Creating archive"

# Build exclusion list
EXCLUDES=(
  "*/node_modules/*"
  "*/.git/*"
  "*/build/*"
  "*/logs/*"
  "*/.DS_Store"
  "*/*.log"
  "*/coverage/*"
  "*/.pid-*"
  "$ARCHIVE"
)
for pat in $DEPLOY_EXCLUDE; do EXCLUDES+=("$pat"); done

EXCL_ARGS=()
for pat in "${EXCLUDES[@]}"; do EXCL_ARGS+=(-x "$pat"); done

(cd "$(dirname "$PROJECT_ROOT")" && \
  zip -r "/tmp/$ARCHIVE" "$(basename "$PROJECT_ROOT")" "${EXCL_ARGS[@]}" >/dev/null)

ZIP_SIZE=$(du -h "/tmp/$ARCHIVE" | cut -f1)
ok "Archive created: $ARCHIVE ($ZIP_SIZE)"

if $DRY_RUN; then
  info "Dry run — skipping transfer and remote steps"
  rm -f "/tmp/$ARCHIVE"
  exit 0
fi

# ── step 2: transfer ──────────────────────────────────────────────────────────
step "Transferring to $DEPLOY_SERVER"
scp "/tmp/$ARCHIVE" "${DEPLOY_SERVER}:${DEPLOY_PATH}/"
ok "Transfer complete"
rm -f "/tmp/$ARCHIVE"

# ── step 3: remote deployment ─────────────────────────────────────────────────
step "Running remote deployment"

# Resolve variables that need to expand on the remote side
NGINX_CONF_BASENAME="${NGINX_CONF:+$(basename "$NGINX_CONF")}"
HAS_FRONTEND="${FRONTEND_REL:+yes}"

# shellcheck disable=SC2087
ssh -t "${DEPLOY_SERVER}" bash -s <<REMOTE
set -euo pipefail

# ── colours (remote) ──────────────────────────────────────────────────────────
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' BLUE='\033[0;34m' NC='\033[0m'
info()  { echo -e "\${BLUE}ℹ  \$*\${NC}"; }
ok()    { echo -e "\${GREEN}✓  \$*\${NC}"; }
warn()  { echo -e "\${YELLOW}⚠  \$*\${NC}"; }
err()   { echo -e "\${RED}✗  \$*\${NC}"; }
step()  { echo -e "\n\${BLUE}▶  \$*\${NC}"; }

APP_NAME="$APP_NAME"
DEPLOY_PATH="$DEPLOY_PATH"
ARCHIVE="$ARCHIVE"
BACKEND_PORT="$BACKEND_PORT"
FRONTEND_PORT="${FRONTEND_PORT:-}"
FRONTEND_REL="$FRONTEND_REL"
BACKEND_REL="$BACKEND_REL"
BACKEND_ENTRY="$BACKEND_ENTRY"
NGINX_CONF_BASENAME="$NGINX_CONF_BASENAME"
TIMESTAMP="$TIMESTAMP"
SKIP_BUILD="$SKIP_BUILD"
FORCE="$FORCE"
DEPLOY_BACKUP_KEEP="$DEPLOY_BACKUP_KEEP"
DEPLOY_BUILD_ENV="$DEPLOY_BUILD_ENV"
HAS_FRONTEND="$HAS_FRONTEND"

cd "\$DEPLOY_PATH"

# ── stop ──────────────────────────────────────────────────────────────────────
step "Stopping application"
if command -v pm2 >/dev/null 2>&1 && pm2 describe "\$APP_NAME" >/dev/null 2>&1; then
  pm2 stop "\$APP_NAME" 2>/dev/null || true
  ok "PM2 process stopped"
else
  # Fallback: kill by port
  PIDS=\$(lsof -ti ":\$BACKEND_PORT" 2>/dev/null || true)
  if [[ -n "\$PIDS" ]]; then
    kill \$PIDS 2>/dev/null || true
    sleep 2
    ok "Killed process on port \$BACKEND_PORT"
  else
    info "Nothing running on port \$BACKEND_PORT"
  fi
fi

# ── backup ────────────────────────────────────────────────────────────────────
step "Backing up current version"
BACKUP_ROOT="\${DEPLOY_PATH}_backups"
BACKUP_DIR="\$BACKUP_ROOT/\${APP_NAME}_backup_\${TIMESTAMP}"
sudo mkdir -p "\$BACKUP_DIR"
DEPLOY_USER=\$(whoami)
sudo chown "\$DEPLOY_USER" "\$BACKUP_DIR"

for item in "\$BACKEND_REL" "\$FRONTEND_REL" package.json nginx*.conf *.sh restart start stop; do
  [[ -z "\$item" ]] && continue
  [[ -e "\$DEPLOY_PATH/\$item" ]] && cp -a "\$DEPLOY_PATH/\$item" "\$BACKUP_DIR/" 2>/dev/null || true
done
# Backup nginx config if present
[[ -f "/etc/nginx/conf.d/\${APP_NAME}.conf" ]] && \
  sudo cp "/etc/nginx/conf.d/\${APP_NAME}.conf" "\$BACKUP_DIR/\${APP_NAME}.nginx.conf" 2>/dev/null || true

ok "Backup: \$BACKUP_DIR"

# Prune old backups
backup_count=\$(ls -1d "\$BACKUP_ROOT"/\${APP_NAME}_backup_* 2>/dev/null | wc -l || echo 0)
if (( backup_count > DEPLOY_BACKUP_KEEP )); then
  ls -1td "\$BACKUP_ROOT"/\${APP_NAME}_backup_* 2>/dev/null | \
    tail -n +\$((DEPLOY_BACKUP_KEEP + 1)) | xargs rm -rf
  info "Pruned old backups (kept \$DEPLOY_BACKUP_KEEP)"
fi

# ── extract ───────────────────────────────────────────────────────────────────
step "Extracting new version"
EXTRACT_DIR=\$(mktemp -d /tmp/deploy-XXXXXX)
unzip -o -q "\$ARCHIVE" -d "\$EXTRACT_DIR"

# Flatten: zip may contain a top-level project dir
SRC="\$EXTRACT_DIR"
[[ -d "\$EXTRACT_DIR/\$(basename "\$DEPLOY_PATH")" ]] && SRC="\$EXTRACT_DIR/\$(basename "\$DEPLOY_PATH")"
[[ -d "\$EXTRACT_DIR/\$APP_NAME" ]]                  && SRC="\$EXTRACT_DIR/\$APP_NAME"

rsync -rl --no-perms --no-owner --no-group --omit-dir-times \
  --exclude='.git' --exclude='node_modules' \
  "\$SRC/" "\$DEPLOY_PATH/"

rm -rf "\$EXTRACT_DIR"
mv "\$ARCHIVE" "\$BACKUP_DIR/" 2>/dev/null || rm -f "\$ARCHIVE"
ok "Files deployed"

# ── fix ownership ─────────────────────────────────────────────────────────────
step "Setting ownership and permissions"
DEPLOY_USER=\$(whoami)
DEPLOY_GROUP=\$(id -gn 2>/dev/null || echo "\$DEPLOY_USER")
sudo chown -R "\$DEPLOY_USER:\$DEPLOY_GROUP" "\$DEPLOY_PATH"
chmod +x "\$DEPLOY_PATH"/*.sh 2>/dev/null || true
chmod +x "\$DEPLOY_PATH"/restart "\$DEPLOY_PATH"/start "\$DEPLOY_PATH"/stop 2>/dev/null || true
ok "Ownership: \$DEPLOY_USER:\$DEPLOY_GROUP"

# ── install nginx config ──────────────────────────────────────────────────────
if [[ -n "\$NGINX_CONF_BASENAME" && -f "\$DEPLOY_PATH/\$NGINX_CONF_BASENAME" ]]; then
  step "Installing Nginx config"
  sudo cp "\$DEPLOY_PATH/\$NGINX_CONF_BASENAME" "/etc/nginx/conf.d/\${APP_NAME}.conf"
  if sudo nginx -t >/dev/null 2>&1; then
    ok "Nginx config valid"
  else
    warn "Nginx config copied but failed validation — check manually"
  fi
fi

# ── install dependencies ──────────────────────────────────────────────────────
step "Installing dependencies"

if [[ -f "\$DEPLOY_PATH/package.json" && ! -f "\$DEPLOY_PATH/\$BACKEND_REL/package.json" ]]; then
  # Root-level package.json (monorepo or flat)
  (cd "\$DEPLOY_PATH" && npm install --production)
  ok "Root deps installed"
fi

BACKEND_ABS="\$DEPLOY_PATH/\$BACKEND_REL"
if [[ -f "\$BACKEND_ABS/package.json" ]]; then
  (cd "\$BACKEND_ABS" && npm install --production)
  ok "Backend deps installed"
fi

# ── build frontend ────────────────────────────────────────────────────────────
if [[ -n "\$HAS_FRONTEND" && "\$SKIP_BUILD" != "true" ]]; then
  step "Building frontend"
  FRONTEND_ABS="\$DEPLOY_PATH/\$FRONTEND_REL"
  if [[ -f "\$FRONTEND_ABS/package.json" ]]; then
    (cd "\$FRONTEND_ABS" && npm install)
    (cd "\$FRONTEND_ABS" && eval "\$DEPLOY_BUILD_ENV npm run build")
    ok "Frontend built"

    # Permissions for Nginx
    chmod o+x "\$DEPLOY_PATH" "\$FRONTEND_ABS" 2>/dev/null || true
    if [[ -d "\$FRONTEND_ABS/build" ]]; then
      chmod o+x "\$FRONTEND_ABS/build" 2>/dev/null || true
      chmod -R o+rX "\$FRONTEND_ABS/build" 2>/dev/null || true
    fi
    if [[ -d "\$FRONTEND_ABS/dist" ]]; then
      chmod o+x "\$FRONTEND_ABS/dist" 2>/dev/null || true
      chmod -R o+rX "\$FRONTEND_ABS/dist" 2>/dev/null || true
    fi

    # SELinux
    if command -v getenforce >/dev/null 2>&1 && [[ "\$(getenforce)" != "Disabled" ]]; then
      for outdir in "\$FRONTEND_ABS/build" "\$FRONTEND_ABS/dist"; do
        [[ -d "\$outdir" ]] && sudo chcon -R -t httpd_sys_content_t "\$outdir" 2>/dev/null || true
      done
    fi
  fi
else
  info "Frontend build skipped"
fi

# ── kill stale port holders ───────────────────────────────────────────────────
step "Clearing port \$BACKEND_PORT"
STALE=\$(lsof -ti ":\$BACKEND_PORT" 2>/dev/null || true)
if [[ -n "\$STALE" ]]; then
  kill -9 \$STALE 2>/dev/null || true
  sleep 2
  ok "Stale processes cleared"
else
  info "Port \$BACKEND_PORT is free"
fi

# ── set up PM2 log rotation ───────────────────────────────────────────────────
if command -v pm2 >/dev/null 2>&1; then
  if ! pm2 list 2>/dev/null | grep -q "pm2-logrotate"; then
    pm2 install pm2-logrotate 2>/dev/null || true
    pm2 set pm2-logrotate:max_size 10M 2>/dev/null || true
    pm2 set pm2-logrotate:retain 10 2>/dev/null || true
    pm2 set pm2-logrotate:compress true 2>/dev/null || true
    info "PM2 log rotation configured"
  fi
fi

# ── start / restart via PM2 ──────────────────────────────────────────────────
step "Starting application via PM2"
mkdir -p "\$DEPLOY_PATH/logs"

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "\$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "\$APP_NAME" --update-env
    ok "PM2 restarted: \$APP_NAME"
  else
    if [[ -f "\$DEPLOY_PATH/ecosystem.config.js" ]]; then
      (cd "\$DEPLOY_PATH" && pm2 start ecosystem.config.js)
    else
      pm2 start "\$DEPLOY_PATH/\$BACKEND_REL/\$BACKEND_ENTRY" --name "\$APP_NAME"
    fi
    ok "PM2 started: \$APP_NAME"
  fi
  pm2 save 2>/dev/null || true
else
  # No PM2 — fall back to nohup
  warn "PM2 not found; starting with nohup"
  mkdir -p "\$DEPLOY_PATH/logs"
  nohup node "\$DEPLOY_PATH/\$BACKEND_REL/\$BACKEND_ENTRY" \
    >"\$DEPLOY_PATH/logs/backend.log" 2>&1 &
  echo \$! > "\$DEPLOY_PATH/.pid-backend"
  ok "Backend started (nohup, pid \$(cat \$DEPLOY_PATH/.pid-backend))"
fi

# ── reload nginx ──────────────────────────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1 && command -v nginx >/dev/null 2>&1; then
  step "Reloading Nginx"
  if sudo systemctl is-active --quiet nginx 2>/dev/null; then
    sudo systemctl reload nginx && ok "Nginx reloaded"
  else
    sudo systemctl start nginx && ok "Nginx started"
  fi
fi

# ── health check ──────────────────────────────────────────────────────────────
step "Health check"
sleep 3
HEALTHY=false
for i in \$(seq 1 8); do
  if curl -sf --connect-timeout 3 "http://127.0.0.1:\${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=true; break
  fi
  sleep 3
done

\$HEALTHY && ok "Backend healthy on :\$BACKEND_PORT" \
           || warn "Backend not responding yet — check: pm2 logs \$APP_NAME"

# ── summary ───────────────────────────────────────────────────────────────────
SERVER_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}' || echo "server")
echo ""
echo -e "\${GREEN}═══ Deployment complete ═══\${NC}"
echo -e "  backend   http://\${SERVER_IP}:\${BACKEND_PORT}"
[[ -n "\$HAS_FRONTEND" && -n "\$FRONTEND_PORT" ]] && echo -e "  frontend  http://\${SERVER_IP}:\${FRONTEND_PORT}"
echo -e "  logs      pm2 logs \$APP_NAME"
echo -e "  monitor   pm2 monit"
echo -e "  backup    \$BACKUP_DIR"
echo ""
REMOTE

ok "Deployment complete"
