#!/bin/bash
set -e

# Cleanup and restart both servers

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "🔄 Restarting servers..."
echo ""

# Stop
bash stop.sh

echo ""

# Start
bash start.sh
