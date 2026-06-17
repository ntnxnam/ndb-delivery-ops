#!/usr/bin/env bash
#
# server-deploy.sh — runs ON the production server (Rocky Linux 9.x).
#
# Idempotent: first run installs everything; subsequent runs just reinstall
# deps, rebuild the client, and restart the backend. Safe to re-run any time.
#
# Architecture on the box:
#   Browser ──:HTTP_PORT──> Nginx ──┬─ /            -> React build (static)
#                                   ├─ /api/*       -> Node backend (PM2) :BACKEND_PORT
#                                   └─ /bin-packing -> Node backend (PM2) :BACKEND_PORT
#
# Usage (normally invoked by deploy-to-production.sh over SSH):
#   bash apps/delivery-ops/scripts/server-deploy.sh
#
# Overridable via env:
#   HTTP_PORT=8899        Public Nginx port
#   PM2_APP_NAME=delivery-ops
#   NODE_MAJOR=20         Node major version to install if missing
#   BACKEND_PORT=8001     Internal Node port; written into server/.env

set -euo pipefail

# ---- Resolve paths (scripts -> delivery-ops -> apps -> repo root) ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_DIR="$REPO_ROOT/apps/delivery-ops"
SERVER_DIR="$APP_DIR/server"
CLIENT_DIR="$APP_DIR/client"
BUILD_DIR="$CLIENT_DIR/build"

# ---- Config ----
HTTP_PORT="${HTTP_PORT:-8899}"
PM2_APP_NAME="${PM2_APP_NAME:-delivery-ops}"
NODE_MAJOR="${NODE_MAJOR:-20}"
NGINX_CONF="/etc/nginx/conf.d/${PM2_APP_NAME}.conf"

# Internal port the Node backend listens on (Nginx proxies /api here). This is
# authoritative: ensure_env writes it into server/.env so the backend listener
# and the Nginx proxy target can never drift apart. Override with BACKEND_PORT=.
BACKEND_PORT="${BACKEND_PORT:-8001}"

# ---- Pretty output ----
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
step()    { echo -e "${CYAN}▶ $1${NC}"; }
ok()      { echo -e "${GREEN}✓ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }
err()     { echo -e "${RED}✗ $1${NC}"; }

# sudo helper: works whether or not we're already root.
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

echo -e "${CYAN}== delivery-ops server deploy ==${NC}"
echo "  Repo root   : $REPO_ROOT"
echo "  HTTP port   : $HTTP_PORT  (Nginx)"
echo "  Backend port: $BACKEND_PORT  (PM2 -> Node)"
echo "  PM2 app     : $PM2_APP_NAME"
echo ""

# -------------------------------------------------------------------------
# 1. System dependencies (only installs what's missing)
# -------------------------------------------------------------------------
install_system_deps() {
  step "Checking system dependencies..."

  local node_major=0
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  fi
  if [ "${node_major:-0}" -lt 18 ]; then
    step "Installing Node.js ${NODE_MAJOR}.x (found: ${node_major:-none})..."
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
    $SUDO dnf install -y nodejs
  fi
  ok "Node $(node -v) / npm $(npm -v)"

  # Build toolchain for native modules (e.g. sqlite3) + policy tools for SELinux.
  $SUDO dnf install -y gcc-c++ make python3 policycoreutils-python-utils >/dev/null 2>&1 || \
    $SUDO dnf install -y gcc-c++ make python3 >/dev/null 2>&1 || true
  ok "Build tools present"

  if ! command -v nginx >/dev/null 2>&1; then
    step "Installing Nginx..."
    $SUDO dnf install -y nginx
  fi
  ok "Nginx present"

  if ! command -v pm2 >/dev/null 2>&1; then
    step "Installing PM2 (global)..."
    $SUDO npm install -g pm2
  fi
  ok "PM2 present"
}

# -------------------------------------------------------------------------
# 2. Backend environment file
# -------------------------------------------------------------------------
ensure_env() {
  step "Checking backend environment (server/.env)..."
  if [ ! -f "$SERVER_DIR/.env" ]; then
    if [ -f "$SERVER_DIR/.env.example" ]; then
      cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
      warn "server/.env was missing — created from .env.example."
      warn "Edit $SERVER_DIR/.env and set SMTP_*, AI_*, ALLOWED_ORIGINS, then re-run."
    else
      err "server/.env is missing and no .env.example to seed from. Aborting."
      exit 1
    fi
  fi
  # Keep the backend PORT in sync with the Nginx proxy target (avoids 502s).
  if grep -qE '^[[:space:]]*PORT=' "$SERVER_DIR/.env"; then
    sed -i -E "s|^[[:space:]]*PORT=.*|PORT=${BACKEND_PORT}|" "$SERVER_DIR/.env"
  else
    printf '\nPORT=%s\n' "$BACKEND_PORT" >> "$SERVER_DIR/.env"
  fi
  ok "server/.env present (backend PORT=$BACKEND_PORT)"
}

# -------------------------------------------------------------------------
# 3. Install workspace deps + build the React client
# -------------------------------------------------------------------------
build_app() {
  step "Installing workspace dependencies (npm install at repo root)..."
  ( cd "$REPO_ROOT" && npm install --no-audit --no-fund )
  ok "Dependencies installed"

  step "Building React client for production..."
  # CI= so ESLint warnings don't fail the production build.
  ( cd "$CLIENT_DIR" && CI= npm run build )
  if [ ! -f "$BUILD_DIR/index.html" ]; then
    err "Client build did not produce $BUILD_DIR/index.html. Aborting."
    exit 1
  fi
  ok "Client build complete"
}

# -------------------------------------------------------------------------
# 4. Nginx site config (serve build, reverse-proxy /api + /bin-packing)
# -------------------------------------------------------------------------
configure_nginx() {
  step "Writing Nginx config -> $NGINX_CONF ..."
  $SUDO tee "$NGINX_CONF" >/dev/null <<EOF
# Managed by server-deploy.sh — do not edit by hand.
server {
    listen ${HTTP_PORT} default_server;
    listen [::]:${HTTP_PORT} default_server;
    server_name _;

    root ${BUILD_DIR};
    index index.html;

    client_max_body_size 25m;

    # React Router — serve index.html for client-side routes.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API -> Node backend (same host). Allowed per no-localhost rule (server config).
    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Legacy bin-packing app is static-mounted by the Node backend.
    location /bin-packing/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  # Our server block is default_server on :HTTP_PORT. Strip default_server from
  # the stock block in nginx.conf to avoid a duplicate-default_server conflict.
  if [ "$HTTP_PORT" = "80" ] || grep -qE "listen[[:space:]]+(\[::\]:)?${HTTP_PORT}[[:space:]]+default_server;" /etc/nginx/nginx.conf 2>/dev/null; then
    $SUDO cp -n /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.deliveryops || true
    $SUDO sed -i -E 's/(listen[[:space:]]+(\[::\]:)?80)[[:space:]]+default_server;/\1;/g' /etc/nginx/nginx.conf
    warn "Removed 'default_server' from stock nginx.conf :80 block (backup: nginx.conf.bak.deliveryops)"
  fi

  if $SUDO nginx -t; then
    $SUDO systemctl enable nginx >/dev/null 2>&1 || true
    $SUDO systemctl reload nginx 2>/dev/null || $SUDO systemctl restart nginx
    ok "Nginx config valid and (re)loaded"
  else
    err "Nginx config test failed. Fix the errors above, then re-run."
    exit 1
  fi
}

# -------------------------------------------------------------------------
# 5. SELinux + filesystem perms so Nginx can read build & proxy to backend
# -------------------------------------------------------------------------
configure_selinux_and_perms() {
  # Let Nginx traverse to and read the static build.
  chmod -R o+rX "$BUILD_DIR" 2>/dev/null || true
  local p="$BUILD_DIR"
  while [ "$p" != "/" ] && [ "$p" != "$REPO_ROOT/.." ]; do
    chmod o+x "$p" 2>/dev/null || true
    p="$(dirname "$p")"
  done

  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
    step "Configuring SELinux..."
    $SUDO setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    $SUDO restorecon -R "$BUILD_DIR" 2>/dev/null || true
    if [ "$HTTP_PORT" != "80" ] && [ "$HTTP_PORT" != "443" ]; then
      $SUDO semanage port -a -t http_port_t -p tcp "$HTTP_PORT" 2>/dev/null \
        || $SUDO semanage port -m -t http_port_t -p tcp "$HTTP_PORT" 2>/dev/null || true
    fi
    ok "SELinux configured (httpd_can_network_connect, build relabeled)"
  fi
}

# -------------------------------------------------------------------------
# 6. Firewall
# -------------------------------------------------------------------------
configure_firewall() {
  if command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    step "Opening firewall port ${HTTP_PORT}/tcp..."
    $SUDO firewall-cmd --permanent --add-port="${HTTP_PORT}/tcp" >/dev/null 2>&1 || true
    $SUDO firewall-cmd --reload >/dev/null 2>&1 || true
    ok "Firewall updated"
  fi
}

# -------------------------------------------------------------------------
# 7. PM2 — start or reload backend, persist across reboot
# -------------------------------------------------------------------------
start_backend() {
  local eco="$APP_DIR/ecosystem.config.js"
  step "Writing PM2 ecosystem -> $eco ..."
  cat > "$eco" <<EOF
// Managed by server-deploy.sh — do not edit by hand.
module.exports = {
  apps: [
    {
      name: '${PM2_APP_NAME}',
      cwd: '${SERVER_DIR}',
      script: 'index.js',
      // MUST be fork: index.js guards app.listen() with require.main===module,
      // which is false under PM2 cluster mode (the server would never listen).
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '${BACKEND_PORT}',
      },
    },
  ],
};
EOF

  # Clear any stale listener on the backend port so PM2 can bind cleanly
  # (a leftover process here causes an EADDRINUSE crash-loop / errored state).
  if command -v lsof >/dev/null 2>&1; then
    $SUDO lsof -ti ":${BACKEND_PORT}" 2>/dev/null | xargs -r $SUDO kill -9 2>/dev/null || true
  fi
  # Self-heal: an older deploy may have created this app in cluster mode.
  # exec_mode can't be changed by reload, so recreate it in that case.
  if pm2 describe "$PM2_APP_NAME" 2>/dev/null | grep -qi 'cluster_mode'; then
    pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
  fi

  step "Starting/reloading backend via PM2..."
  pm2 startOrReload "$eco" --update-env
  pm2 save >/dev/null 2>&1 || true

  # Configure boot persistence once (no-op if already set).
  if ! systemctl list-unit-files 2>/dev/null | grep -q "pm2-$(whoami)"; then
    local cmd
    cmd="$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null | grep -E '^sudo ' || true)"
    if [ -n "$cmd" ]; then eval "$cmd" || true; pm2 save >/dev/null 2>&1 || true; fi
  fi
  ok "Backend online (PM2: $PM2_APP_NAME)"
}

# -------------------------------------------------------------------------
# 8. Health checks
# -------------------------------------------------------------------------
verify() {
  step "Verifying deployment..."
  local ok_backend=0 ok_front=0 i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then ok_backend=1; break; fi
    sleep 2
  done
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/api/health" >/dev/null 2>&1; then ok_front=1; fi

  if [ "$ok_backend" -eq 1 ]; then ok "Backend health OK (:$BACKEND_PORT/api/health)"; else err "Backend health check failed — see: pm2 logs $PM2_APP_NAME"; fi
  if [ "$ok_front" -eq 1 ]; then ok "Nginx -> backend proxy OK (:$HTTP_PORT/api/health)"; else warn "Could not reach backend via Nginx on :$HTTP_PORT — check: sudo nginx -t / sudo tail -f /var/log/nginx/error.log"; fi
}

main() {
  install_system_deps
  ensure_env
  build_app
  configure_nginx
  configure_selinux_and_perms
  configure_firewall
  start_backend
  verify
  echo ""
  ok "Deploy finished. App URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${HTTP_PORT}"
}

main "$@"
