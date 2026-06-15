#!/bin/bash
# Restart all servers: stop, rebuild if needed, then start

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

# Check if we need to rebuild shared package
echo "2. Checking if shared package needs rebuild..."
cd "$PROJECT_ROOT/shared"
if ! npm run build 2>&1 | tail -1 | grep -q "tsc"; then
  echo "   (skipping — no TypeScript files changed)"
else
  echo "   ✓ Shared package rebuilt"
fi
echo ""

# Start servers
echo "3. Starting servers..."
"$SCRIPT_DIR/start.sh"
echo ""

echo "================================================"
echo "✓ Restart complete"
echo "================================================"
