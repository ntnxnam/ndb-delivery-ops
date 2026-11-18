#!/usr/bin/env bash
export PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "/Users/namratha.singh/.ntnx/app-lifecycle/stop.sh" "$@"
