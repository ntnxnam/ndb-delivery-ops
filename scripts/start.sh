#!/bin/bash
# Start all servers (backend + client dev server)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Starting servers..."

# Start backend (Express)
echo "Starting backend on port 8001..."
cd "$PROJECT_ROOT/apps/delivery-ops/server"
PORT=8001 nohup node index.js > /tmp/server.log 2>&1 &
BACKEND_PID=$!
disown $BACKEND_PID
echo "Backend started (PID: $BACKEND_PID)"

# Wait for backend to be ready
sleep 3
if ! kill -0 $BACKEND_PID 2>/dev/null; then
  echo "ERROR: Backend failed to start"
  tail -20 /tmp/server.log
  exit 1
fi

# Start client (React dev server) in background
echo "Starting client on port 8899..."
cd "$PROJECT_ROOT/apps/delivery-ops/client"
PORT=8899 \
npm start > /tmp/client.log 2>&1 &
CLIENT_PID=$!
disown $CLIENT_PID
echo "Client started (PID: $CLIENT_PID)"

sleep 2

echo ""
echo "✓ All servers started:"
echo "  Backend: http://localhost:8001"
echo "  Client:  http://localhost:8899"
echo ""
echo "Logs:"
echo "  Backend: /tmp/server.log"
echo "  Client:  /tmp/client.log"
