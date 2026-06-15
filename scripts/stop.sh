#!/bin/bash
# Stop all running servers and clean up ports

set -e

echo "Stopping servers..."

# Kill processes on port 6001 (backend)
echo "Cleaning port 6001 (backend)..."
lsof -ti :6001 | xargs kill -9 2>/dev/null || true

# Kill processes on port 8888 (client)
echo "Cleaning port 8888 (client)..."
lsof -ti :8888 | xargs kill -9 2>/dev/null || true

# Kill processes on port 3000 (alternative React dev server)
echo "Cleaning port 3000..."
lsof -ti :3000 | xargs kill -9 2>/dev/null || true

sleep 1
echo "✓ All servers stopped"
