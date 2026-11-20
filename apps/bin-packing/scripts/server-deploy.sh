#!/usr/bin/env bash
#
# server-deploy.sh — bin-packing standalone deploy to :8890 (Rocky Linux 9.x).
# Mirrors apps/delivery-ops/scripts/server-deploy.sh pattern (Nginx + firewall + SELinux)
# but static-only: no Node/PM2 backend, no build step beyond perms.
#
# Usage (normally via deploy-to-production.sh over SSH):
#   bash apps/bin-packing/scripts/server-deploy.sh
# Overridable: HTTP_PORT=8890 BINPACKING_ROOT=/var/www/html/ndb-delivery-ops/apps/bin-packing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_DIR="$REPO_ROOT/apps/bin-packing"

HTTP_PORT="${HTTP_PORT:-8890}"
NGINX_CONF="/etc/nginx/conf.d/bin-packing.conf"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
step() { echo -e "${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; }
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

echo -e "${CYAN}== bin-packing server deploy ==${NC}"
echo "  Repo root : $REPO_ROOT"
echo "  App dir   : $APP_DIR"
echo "  HTTP port : $HTTP_PORT (Nginx static)"
echo "  Nginx conf: $NGINX_CONF"
echo ""

check_port() {
  step "Checking port ${HTTP_PORT} availability..."
  local holder=""
  if command -v ss >/dev/null 2>&1; then
    holder="$(ss -tlnp 2>/dev/null | grep -E ":${HTTP_PORT}[[:space:]]" || true)"
  elif command -v netstat >/dev/null 2>&1; then
    holder="$(netstat -tlnp 2>/dev/null | grep -E ":${HTTP_PORT}[[:space:]]" || true)"
  fi
  # If holder is our own Nginx already listening on this port, it's OK — we'll reload it.
  if [ -n "$holder" ] && echo "$holder" | grep -q "nginx"; then
    ok "Port ${HTTP_PORT} already held by Nginx (will reload)"
    return 0
  fi
  if [ -n "$holder" ]; then
    err "Port ${HTTP_PORT} is already in use:"
    echo "$holder" | sed "s/^/  /"
    if command -v lsof >/dev/null 2>&1; then
      echo "  Details (lsof -i :${HTTP_PORT}):"
      $SUDO lsof -i :"${HTTP_PORT}" 2>/dev/null | sed "s/^/  /" || true
    fi
    err "Free the port or redeploy with HTTP_PORT=<free-port> bash $0"
    err "Example: HTTP_PORT=8891 bash apps/bin-packing/scripts/server-deploy.sh"
    exit 1
  fi
  ok "Port ${HTTP_PORT} is free"
}

install_system_deps() {
  step "Checking system dependencies..."
  if ! command -v nginx >/dev/null 2>&1; then
    $SUDO dnf install -y nginx
  fi
  ok "Nginx present"
  command -v nginx >/dev/null && ok "Nginx $(nginx -v 2>&1)" || true
}

configure_nginx() {
  step "Writing Nginx config -> $NGINX_CONF ..."
  $SUDO tee "$NGINX_CONF" >/dev/null <<EOF
# Managed by bin-packing server-deploy.sh — do not edit by hand.
server {
    listen ${HTTP_PORT} default_server;
    listen [::]:${HTTP_PORT} default_server;
    server_name _;
    root ${APP_DIR};
    index index.html upload.html;
    client_max_body_size 25m;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;
        proxy_cache off;
    }
}
EOF
  if $SUDO nginx -t; then
    $SUDO systemctl enable nginx >/dev/null 2>&1 || true
    $SUDO systemctl reload nginx 2>/dev/null || $SUDO systemctl restart nginx
    ok "Nginx config valid and (re)loaded"
  else
    err "Nginx config test failed"; exit 1
  fi
}

configure_selinux_and_perms() {
  chmod -R o+rX "$APP_DIR" 2>/dev/null || true
  local p="$APP_DIR"
  while [ "$p" != "/" ] && [ "$p" != "$REPO_ROOT/.." ]; do chmod o+x "$p" 2>/dev/null || true; p="$(dirname "$p")"; done
  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
    step "Configuring SELinux..."
    $SUDO restorecon -R "$APP_DIR" 2>/dev/null || true
    if [ "$HTTP_PORT" != "80" ] && [ "$HTTP_PORT" != "443" ]; then
      $SUDO semanage port -a -t http_port_t -p tcp "$HTTP_PORT" 2>/dev/null || $SUDO semanage port -m -t http_port_t -p tcp "$HTTP_PORT" 2>/dev/null || true
    fi
    ok "SELinux configured"
  fi
}

configure_firewall() {
  if command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    step "Opening firewall port ${HTTP_PORT}/tcp..."
    $SUDO firewall-cmd --permanent --add-port="${HTTP_PORT}/tcp" >/dev/null 2>&1 || true
    $SUDO firewall-cmd --reload >/dev/null 2>&1 || true
    ok "Firewall updated"
  fi
}

verify() {
  step "Verifying deployment..."
  sleep 1
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/" >/dev/null 2>&1; then
    ok "Nginx static OK (:${HTTP_PORT}/)"
  else
    err "Could not reach :${HTTP_PORT}/ after deploy"
    if command -v ss >/dev/null 2>&1; then
      echo "  Listening ports:"
      ss -tlnp 2>/dev/null | grep -E ":${HTTP_PORT}|:8899|:8001" | sed "s/^/  /" || true
    fi
    echo "  Check: sudo nginx -t; sudo systemctl status nginx; sudo tail -f /var/log/nginx/error.log"
    exit 1
  fi
}

main() {
  check_port
  install_system_deps
  configure_nginx
  configure_selinux_and_perms
  configure_firewall
  verify
  echo ""
  ok "Deploy finished. Bin-packing URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'): ${HTTP_PORT}  (or http://<host>:${HTTP_PORT}/)"
}
main "$@"
