#!/bin/bash
# Restart all servers: stop, optionally rebuild shared, then start

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "================================================"
echo "NDB Delivery Ops — Full Restart"
echo "================================================"
echo ""

# Stop existing servers
echo "1. Stopping existing servers..."
"$SCRIPT_DIR/stop.sh"
echo ""

# Rebuild shared package if it has TypeScript sources
echo "2. Rebuilding shared package (if applicable)..."
SHARED_DIR="$PROJECT_ROOT/shared"
if [ -f "$SHARED_DIR/tsconfig.json" ] && [ -d "$SHARED_DIR/src" ]; then
  ( cd "$SHARED_DIR" && npm run build ) && echo "   ✓ Shared package rebuilt" \
    || echo "   ⚠ Shared build returned non-zero (check output above)"
else
  echo "   (skipping — no TypeScript sources found in shared/)"
fi
echo ""

# Start servers
echo "3. Starting servers..."
"$SCRIPT_DIR/start.sh"
echo ""

echo "================================================"
echo "✓ Restart complete"
echo "================================================"
