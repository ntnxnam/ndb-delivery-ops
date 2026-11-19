#!/usr/bin/env bash
# Usage: ~/.ntnx/app-lifecycle/install.sh [/path/to/project]
# Installs stop / start / restart wrappers into a project directory.
# Defaults to the current working directory.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$(pwd)}"

if [[ ! -d "$TARGET" ]]; then
  echo "Error: '$TARGET' is not a directory"
  exit 1
fi

for script in stop start restart deploy; do
cat > "$TARGET/$script" <<WRAPPER
#!/usr/bin/env bash
export PROJECT_ROOT="\$(cd "\$(dirname "\$0")" && pwd)"
exec "$LIB_DIR/${script}.sh" "\$@"
WRAPPER
  chmod +x "$TARGET/$script"
  echo "✓  installed $TARGET/$script"
done

echo ""
echo "Done. From $TARGET you can now run:"
echo "  ./restart              stop + start (dev)"
echo "  ./start / ./stop       individual lifecycle"
echo "  ./deploy               package + push to production"
echo "  ./deploy --no-build    deploy without rebuilding frontend"
echo "  ./deploy --dry-run     see what would happen"
echo ""
echo "Required in $TARGET/.env for deploy:"
echo "  DEPLOY_SERVER=user@host"
echo "  DEPLOY_PATH=/var/www/html/my-app"
echo ""
echo "Optional in $TARGET/.env:"
echo "  APP_NAME=my-app"
echo "  BACKEND_PORT=6001"
echo "  FRONTEND_PORT=6100"
echo "  BACKEND_DIR=/absolute/path     # auto-detected if omitted"
echo "  FRONTEND_DIR=/absolute/path    # auto-detected; omit for API-only"
echo "  DEPLOY_BUILD_ENV='REACT_APP_X=true'  # injected into npm run build"
echo "  NGINX_CONF=./nginx-my-app.conf # auto-detected if omitted"
