#!/usr/bin/env bash
#
# deploy-bin-packing.sh — run from your Mac. Deploys ONLY bin-packing to :8890.
# Leaves apps/delivery-ops/scripts/deploy-to-production.sh (Lighthouse 8899/8001) untouched.
#
# Usage:
#   ./apps/bin-packing/scripts/deploy-bin-packing.sh
#   ./apps/bin-packing/scripts/deploy-bin-packing.sh --server user@host --path /var/www/html/ndb-delivery-ops --http-port 8890 --yes
#
set -euo pipefail

PRODUCTION_SERVER="${PRODUCTION_SERVER:-santhosh.s@santhosh-s-1.umsvm.nutanix.com}"
SERVER_PATH="${SERVER_PATH:-/var/www/html/ndb-delivery-ops}"
HTTP_PORT="${HTTP_PORT:-8890}"
ASSUME_YES="${ASSUME_YES:-false}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
print_header(){ echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"; echo -e "${CYAN}║  $1${NC}"; echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"; echo ""; }
print_success(){ echo -e "${GREEN}✓ $1${NC}"; }
print_error(){ echo -e "${RED}✗ $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJECT_NAME="$(basename "$REPO_ROOT")"
WORKING_DIR="$(dirname "$REPO_ROOT")"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
ZIP_FILENAME="${PROJECT_NAME}-${TIMESTAMP}.zip"

show_help(){ cat <<EOF
Usage: $0 [OPTIONS]
Deploy bin-packing (standalone :${HTTP_PORT}) — leaves Lighthouse deploy untouched.

Options:
  --server USER@HOST   SSH target            (default: \$PRODUCTION_SERVER)
  --path PATH          Server deploy path    (default: $SERVER_PATH)
  --http-port PORT     Public Nginx port     (default: $HTTP_PORT)
  --yes, -y            Skip confirmation prompt
  --help, -h           Show this help

Current config:
  Server : $PRODUCTION_SERVER
  Path   : $SERVER_PATH
  Port   : $HTTP_PORT (bin-packing Nginx)
EOF
}
while [ $# -gt 0 ]; do case "$1" in --server) PRODUCTION_SERVER="$2"; shift 2;; --path) SERVER_PATH="$2"; shift 2;; --http-port) HTTP_PORT="$2"; shift 2;; --yes|-y) ASSUME_YES="true"; shift;; --help|-h) show_help; exit 0;; *) print_error "Unknown option: $1"; show_help; exit 1;; esac; done

check_prerequisites(){
  for cmd in zip scp ssh; do if ! command -v "$cmd" >/dev/null 2>&1; then print_error "'$cmd' not found"; exit 1; fi; done
  if [ ! -f "$REPO_ROOT/package.json" ] || [ ! -d "$REPO_ROOT/apps/bin-packing" ]; then print_error "Could not locate monorepo root at $REPO_ROOT"; exit 1; fi
}

main(){
  print_header "bin-packing — Production Deployment (:${HTTP_PORT})"
  echo -e "${BLUE}Source      : ${YELLOW}${REPO_ROOT}${NC}"
  echo -e "${BLUE}Destination : ${YELLOW}${PRODUCTION_SERVER}:${SERVER_PATH}${NC}"
  echo -e "${BLUE}Nginx port  : ${YELLOW}${HTTP_PORT}${NC}"
  echo -e "${BLUE}Archive     : ${YELLOW}${ZIP_FILENAME}${NC}"
  echo ""
  if [ "$ASSUME_YES" != "true" ]; then read -p "$(echo -e "${YELLOW}Continue? [y/N]: ${NC}")" -n 1 -r; echo ""; [[ $REPLY =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }; fi

  print_success "Creating archive..."
  cd "$WORKING_DIR"; rm -f "$ZIP_FILENAME"
  zip -r "$ZIP_FILENAME" "$PROJECT_NAME" -x "*/node_modules/*" -x "*/.git/*" -x "${PROJECT_NAME}/.git/*" -x "*/build/*" -x "*/coverage/*" -x "*/.DS_Store" -x "*/*.log" -x "*/server/.env" -x "*/${ZIP_FILENAME}" > /dev/null

  ssh "$PRODUCTION_SERVER" "sudo mkdir -p '$SERVER_PATH' && sudo chown \$(whoami) '$SERVER_PATH'"
  scp "$ZIP_FILENAME" "${PRODUCTION_SERVER}:${SERVER_PATH}/"
  rm -f "$ZIP_FILENAME"

  ssh -t "$PRODUCTION_SERVER" "SERVER_PATH='$SERVER_PATH' ZIP_FILENAME='$ZIP_FILENAME' PROJECT_NAME='$PROJECT_NAME' TIMESTAMP='$TIMESTAMP' HTTP_PORT='$HTTP_PORT' bash -s" <<'ENDSSH'
    set -euo pipefail; CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
    if [ -d "$SERVER_PATH/apps" ]; then BACKUP_DIR="${SERVER_PATH}_backups/backup_${TIMESTAMP}"; sudo mkdir -p "$BACKUP_DIR" && sudo chown "$(whoami)" "$BACKUP_DIR"; sudo cp -a "/etc/nginx/conf.d/bin-packing.conf" "$BACKUP_DIR/nginx.conf" 2>/dev/null || true; echo -e "${GREEN}✓ Backup at $BACKUP_DIR${NC}"; fi
    echo -e "${CYAN}▶ Extracting...${NC}"; EXTRACT_DIR="$(mktemp -d /tmp/binpacking-XXXXXX)"; unzip -o -q "$SERVER_PATH/$ZIP_FILENAME" -d "$EXTRACT_DIR"
    SRC="$EXTRACT_DIR/$PROJECT_NAME"; [ -d "$SRC" ] || SRC="$EXTRACT_DIR"
    rsync -rl --no-perms --no-owner --no-group --omit-dir-times --exclude='.git' --exclude='node_modules' --exclude='apps/delivery-ops/server/.env' "$SRC/" "$SERVER_PATH/"; rm -rf "$EXTRACT_DIR"
    if [ -n "${BACKUP_DIR:-}" ]; then mv "$SERVER_PATH/$ZIP_FILENAME" "$BACKUP_DIR/" 2>/dev/null || rm -f "$SERVER_PATH/$ZIP_FILENAME"; else rm -f "$SERVER_PATH/$ZIP_FILENAME"; fi
    chmod +x "$SERVER_PATH/apps/bin-packing/scripts/"*.sh 2>/dev/null || true
    HTTP_PORT="$HTTP_PORT" bash "$SERVER_PATH/apps/bin-packing/scripts/server-deploy.sh"
ENDSSH
  echo ""; print_success "Deploy done. Bin-packing: http://<server-ip>:${HTTP_PORT}/"
}
check_prerequisites; main
