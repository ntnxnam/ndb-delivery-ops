#!/bin/bash
set -e

echo "🛑 Stopping servers..."

# Kill process on backend port (8001)
if lsof -i :8001 > /dev/null 2>&1; then
  echo "  Killing process on port 8001..."
  lsof -ti :8001 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Kill process on frontend port (8899 or legacy 8888/3000)
for port in 8899 8888 3000; do
  if lsof -i :$port > /dev/null 2>&1; then
    echo "  Killing process on port $port..."
    lsof -ti :$port | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
done

echo "✓ Ports cleaned up"
