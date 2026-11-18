#!/usr/bin/env bash
set -euo pipefail
# Harness-agnostic installer: generates per-harness symlinks/config from canonical agent-pack/
# Usage: ./agent-pack/harness/install.sh --harness opencode|cursor|claude|codex|all
HARNESS="${1:-}"
if [[ "$HARNESS" == "--harness" ]]; then HARNESS="${2:-}"; fi
if [[ -z "$HARNESS" ]]; then echo "Usage: $0 --harness opencode|cursor|claude|codex|all"; exit 1; fi
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACK_ROOT="$REPO_ROOT/agent-pack/product/lighthouse"
LOOM_ROOT="$REPO_ROOT/agent-pack/loom"
install_one() {
  local h="$1"
  echo "Installing harness: $h (packs: $PACK_ROOT, $LOOM_ROOT)"
  # Placeholder: actual symlink generation after Phase 2 moves land
  echo "  -> $h harness config would point to $PACK_ROOT and $LOOM_ROOT"
}
if [[ "$HARNESS" == "all" ]]; then
  for h in opencode cursor claude codex; do install_one "$h"; done
else
  install_one "$HARNESS"
fi
echo "Done. Source of truth remains agent-pack/ (D38)."
