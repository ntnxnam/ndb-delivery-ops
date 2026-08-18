#!/bin/bash
set -e

echo "🚀 Starting servers..."

# Rebuild shared if needed
if [ ! -d "shared/dist" ] || [ $(find shared/src -name "*.ts" -newer shared/dist -type f 2>/dev/null | wc -l) -gt 0 ]; then
  echo "  Building shared package..."
  cd shared
  npm run build > /dev/null 2>&1
  cd ..
  echo "  ✓ Shared built"
fi

# Install dependencies once at workspace root if needed.
# This avoids recreating duplicate nested node_modules trees.
if [ ! -d "node_modules" ]; then
  echo "  Installing workspace dependencies (root only)..."
  npm install > /dev/null 2>&1
  echo "  ✓ Workspace dependencies installed"
fi

# Start backend
echo "  Starting backend (port 8001)..."
cd apps/delivery-ops/server
node index.js > /tmp/server.log 2>&1 &
BACKEND_PID=$!
cd ../../..
echo "  ✓ Backend started (PID: $BACKEND_PID)"

# Start frontend
echo "  Starting frontend (port 8899)..."
cd apps/delivery-ops/client
npm start > /tmp/client.log 2>&1 &
FRONTEND_PID=$!
cd ../../..
echo "  ✓ Frontend started (PID: $FRONTEND_PID)"

# Give services a moment to start
sleep 5

# Check if services are up
echo ""
echo "📋 Service Status:"
if lsof -i :8001 > /dev/null 2>&1; then
  echo "  ✓ Backend running on http://localhost:8001"
else
  echo "  ✗ Backend failed to start (check /tmp/server.log)"
  tail -20 /tmp/server.log
  exit 1
fi

if lsof -i :8899 > /dev/null 2>&1; then
  echo "  ✓ Frontend running on http://localhost:8899"
else
  echo "  ⏳ Frontend starting... (may take 30-60s, check /tmp/client.log)"
fi

echo ""
echo "✅ Done! Application ready at http://localhost:8899"
