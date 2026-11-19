#!/usr/bin/env bash
set -euo pipefail
export PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$(dirname "${BASH_SOURCE[0]}")/lib/lib.sh"
lifecycle_init
do_start
