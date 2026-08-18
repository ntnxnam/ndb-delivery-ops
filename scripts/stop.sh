#!/bin/bash
# Stop all running servers and clean up ports

set -e

echo "Stopping servers..."

# Kill processes on port 8001 (backend)
echo "Cleaning port 8001 (backend)..."
lsof -ti :8001 | xargs kill -9 2>/dev/null || true

# Kill processes on port 8899 (client)
echo "Cleaning port 8899 (client)..."
lsof -ti :8899 | xargs kill -9 2>/dev/null || true

sleep 1
echo "✓ All servers stopped"
