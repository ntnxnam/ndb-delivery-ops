#!/usr/bin/env bash
#
# deploy-to-production.sh — run from your Mac. One command to ship the whole
# monorepo to the production server and (re)deploy it.
#
# What it does:
#   1. Runs the no-localhost guard on app code (fails early if violated).
#   2. Zips the repo (excluding node_modules / .git / build / logs / .env).
#   3. SCPs the archive to the server.
#   4. SSHes in, extracts (flattening the top folder), and runs
#      apps/delivery-ops/scripts/server-deploy.sh — which installs deps,
#      builds the client, configures Nginx + PM2, and restarts the backend.
#
# First-time deploy and redeploy use the EXACT same command. The server-side
# script is idempotent.
#
# Usage:
#   ./deploy-to-production.sh
#   ./deploy-to-production.sh --server user@host --path /var/www/html/ndb-delivery-ops
#   ./deploy-to-production.sh --http-port 80 --yes
#
# Configure the defaults below (or pass flags / env vars) for your server.

set -euo pipefail

# ----------------------------- Configuration -----------------------------
# Set these to your production box.
PRODUCTION_SERVER="${PRODUCTION_SERVER:-santhosh.s@santhosh-s-1.umsvm.nutanix.com}"
SERVER_PATH="${SERVER_PATH:-/var/www/html/ndb-delivery-ops}"
PM2_APP_NAME="${PM2_APP_NAME:-delivery-ops}"
HTTP_PORT="${HTTP_PORT:-8899}"      # public Nginx port on the server
ASSUME_YES="${ASSUME_YES:-false}"   # skip the confirmation prompt

# ----------------------------- Pretty output -----------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
print_header()  { echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"; echo -e "${CYAN}║  $1${NC}"; echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"; echo ""; }
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error()   { echo -e "${RED}✗ $1${NC}"; }
print_info()    { echo -e "${BLUE}ℹ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_step()    { echo -e "${CYAN}▶ $1${NC}"; }

# ----------------------------- Resolve paths ------------------------------
# Script lives at apps/delivery-ops/scripts/ → repo root is three levels up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJECT_NAME="$(basename "$REPO_ROOT")"
WORKING_DIR="$(dirname "$REPO_ROOT")"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
ZIP_FILENAME="${PROJECT_NAME}-${TIMESTAMP}.zip"

# ----------------------------- Arg parsing --------------------------------
show_help() {
  cat <<EOF
Usage: $0 [OPTIONS]

Zip the monorepo and deploy/redeploy it to the production server.

Options:
  --server USER@HOST     SSH target            (default: \$PRODUCTION_SERVER)
  --path PATH            Server deploy path    (default: $SERVER_PATH)
  --http-port PORT       Public Nginx port     (default: $HTTP_PORT)
  --app-name NAME        PM2 app name          (default: $PM2_APP_NAME)
  --yes, -y              Skip confirmation prompt
  --help, -h             Show this help

Current config:
  Server : $PRODUCTION_SERVER
  Path   : $SERVER_PATH
  Port   : $HTTP_PORT (Nginx)
  PM2    : $PM2_APP_NAME

The server-side script (apps/delivery-ops/scripts/server-deploy.sh) is
idempotent — the same command works for first deploy and every redeploy.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --server)    PRODUCTION_SERVER="$2"; shift 2 ;;
    --path)      SERVER_PATH="$2"; shift 2 ;;
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --app-name)  PM2_APP_NAME="$2"; shift 2 ;;
    --yes|-y)    ASSUME_YES="true"; shift ;;
    --help|-h)   show_help; exit 0 ;;
    *)           print_error "Unknown option: $1"; echo ""; show_help; exit 1 ;;
  esac
done

# ----------------------------- Prerequisites ------------------------------
check_prerequisites() {
  for cmd in zip scp ssh; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      print_error "'$cmd' not found. Install it and retry (e.g. brew install $cmd)."
      exit 1
    fi
  done
  if [ ! -f "$REPO_ROOT/package.json" ] || [ ! -d "$REPO_ROOT/apps/delivery-ops" ]; then
    print_error "Could not locate the monorepo root (expected package.json + apps/delivery-ops at $REPO_ROOT)."
    exit 1
  fi
  if [[ "$PRODUCTION_SERVER" == CHANGE_ME* ]]; then
    print_error "Production server is not set."
    print_info "Pass --server user@host, or edit PRODUCTION_SERVER at the top of this script."
    exit 1
  fi
}

# ----------------------------- Main ---------------------------------------
main() {
  print_header "delivery-ops — Production Deployment"
  echo -e "${BLUE}Deployment details:${NC}"
  echo -e "  Source      : ${YELLOW}${REPO_ROOT}${NC}"
  echo -e "  Destination : ${YELLOW}${PRODUCTION_SERVER}:${SERVER_PATH}${NC}"
  echo -e "  Nginx port  : ${YELLOW}${HTTP_PORT}${NC}"
  echo -e "  PM2 app     : ${YELLOW}${PM2_APP_NAME}${NC}"
  echo -e "  Archive     : ${YELLOW}${ZIP_FILENAME}${NC}"
  echo ""

  if [ "$ASSUME_YES" != "true" ]; then
    read -p "$(echo -e "${YELLOW}Continue with deployment? [y/N]: ${NC}")" -n 1 -r
    echo ""
    [[ $REPLY =~ ^[Yy]$ ]] || { print_warning "Deployment cancelled."; exit 0; }
    echo ""
  fi

  # 0. No-localhost guard (fail before packaging).
  print_step "Checking for hardcoded localhost in app code..."
  if ( cd "$REPO_ROOT/apps/delivery-ops" && npm run check:no-localhost ) >/tmp/no-localhost.out 2>&1; then
    print_success "No hardcoded localhost in app code"
  else
    print_error "App code contains hardcoded localhost/127.0.0.1. Fix before deploying."
    cat /tmp/no-localhost.out
    print_info "See .cursor/rules/no-localhost.mdc"
    exit 1
  fi

  # 1. Zip the repo (from its parent so the archive contains PROJECT_NAME/...).
  print_step "Creating archive..."
  cd "$WORKING_DIR"
  rm -f "$ZIP_FILENAME"
  zip -r "$ZIP_FILENAME" "$PROJECT_NAME" \
      -x "*/node_modules/*" \
      -x "*/.git/*" -x "${PROJECT_NAME}/.git/*" \
      -x "*/build/*" \
      -x "*/coverage/*" \
      -x "*/.DS_Store" \
      -x "*/*.log" \
      -x "*/server/.env" \
      -x "*/${ZIP_FILENAME}" \
      > /dev/null
  print_success "Archive created: ${ZIP_FILENAME} ($(du -h "$ZIP_FILENAME" | cut -f1))"

  # 2. Ensure remote dir exists, then transfer.
  print_step "Ensuring remote directory exists..."
  ssh "$PRODUCTION_SERVER" "sudo mkdir -p '$SERVER_PATH' && sudo chown \$(whoami) '$SERVER_PATH'"
  print_step "Transferring archive to server..."
  scp "$ZIP_FILENAME" "${PRODUCTION_SERVER}:${SERVER_PATH}/"
  print_success "Transfer complete"

  print_info "Removing local archive..."
  rm -f "$ZIP_FILENAME"

  # 3. Extract + run the idempotent server-side deploy.
  print_step "Deploying on production server..."
  echo ""
  ssh -t "$PRODUCTION_SERVER" \
      "SERVER_PATH='$SERVER_PATH' ZIP_FILENAME='$ZIP_FILENAME' PROJECT_NAME='$PROJECT_NAME' TIMESTAMP='$TIMESTAMP' HTTP_PORT='$HTTP_PORT' PM2_APP_NAME='$PM2_APP_NAME' bash -s" <<'ENDSSH'
    set -euo pipefail
    CYAN='\033[0;36m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

    echo -e "${CYAN}▶ Backing up current deployment...${NC}"
    if [ -d "$SERVER_PATH/apps" ]; then
      BACKUP_DIR="${SERVER_PATH}_backups/backup_${TIMESTAMP}"
      sudo mkdir -p "$BACKUP_DIR" && sudo chown "$(whoami)" "$BACKUP_DIR"
      # Back up only config + nginx (code is in git; this keeps backups small).
      cp -a "$SERVER_PATH/apps/delivery-ops/server/.env" "$BACKUP_DIR/" 2>/dev/null || true
      sudo cp -a "/etc/nginx/conf.d/${PM2_APP_NAME}.conf" "$BACKUP_DIR/nginx.conf" 2>/dev/null || true
      echo -e "${GREEN}✓ Backup at $BACKUP_DIR${NC}"
    fi

    echo -e "${CYAN}▶ Extracting archive...${NC}"
    EXTRACT_DIR="$(mktemp -d /tmp/deliveryops-XXXXXX)"
    unzip -o -q "$SERVER_PATH/$ZIP_FILENAME" -d "$EXTRACT_DIR"
    echo -e "${BLUE}ℹ Extracted to $EXTRACT_DIR${NC}"

    echo -e "${CYAN}▶ Syncing files into $SERVER_PATH (preserving server/.env)...${NC}"
    SRC="$EXTRACT_DIR/$PROJECT_NAME"; [ -d "$SRC" ] || SRC="$EXTRACT_DIR"
    rsync -rl --no-perms --no-owner --no-group --omit-dir-times \
          --exclude='.git' --exclude='node_modules' \
          --exclude='apps/delivery-ops/server/.env' \
          "$SRC/" "$SERVER_PATH/"
    rm -rf "$EXTRACT_DIR"

    # Stash the archive into the backup dir (or remove it).
    if [ -n "${BACKUP_DIR:-}" ]; then
      mv "$SERVER_PATH/$ZIP_FILENAME" "$BACKUP_DIR/" 2>/dev/null || rm -f "$SERVER_PATH/$ZIP_FILENAME"
    else
      rm -f "$SERVER_PATH/$ZIP_FILENAME"
    fi

    echo -e "${CYAN}▶ Running idempotent server deploy...${NC}"
    chmod +x "$SERVER_PATH/apps/delivery-ops/scripts/"*.sh 2>/dev/null || true
    HTTP_PORT="$HTTP_PORT" PM2_APP_NAME="$PM2_APP_NAME" \
      bash "$SERVER_PATH/apps/delivery-ops/scripts/server-deploy.sh"
ENDSSH

  echo ""
  print_success "Deployment completed."
  print_info "App URL : http://<server-ip>:${HTTP_PORT}"
  print_info "Logs    : ssh ${PRODUCTION_SERVER} 'pm2 logs ${PM2_APP_NAME}'"
}

check_prerequisites
main
