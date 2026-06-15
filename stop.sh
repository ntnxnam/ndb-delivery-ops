#!/bin/bash
set -e

echo "🛑 Stopping servers..."

# Kill process on backend port (6001)
if lsof -i :6001 > /dev/null 2>&1; then
  echo "  Killing process on port 6001..."
  lsof -ti :6001 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Kill process on frontend port (8888 or 3000)
for port in 8888 3000; do
  if lsof -i :$port > /dev/null 2>&1; then
    echo "  Killing process on port $port..."
    lsof -ti :$port | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
done

echo "✓ Ports cleaned up"
