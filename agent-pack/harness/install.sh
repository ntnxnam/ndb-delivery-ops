#!/usr/bin/env bash
set -euo pipefail
HARNESS="${1:-}"
if [[ "$HARNESS" == "--harness" ]]; then HARNESS="${2:-}"; fi
if [[ -z "$HARNESS" ]]; then echo "Usage: $0 --harness opencode|cursor|claude|codex|all"; exit 1; fi
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
install_one() {
  local h="$1"
  case "$h" in
    cursor) mkdir -p "$REPO_ROOT/.cursor"; ln -sf ../agent-pack/product/lighthouse/identity "$REPO_ROOT/.cursor/agents"; ln -sf ../agent-pack/product/lighthouse/skills "$REPO_ROOT/.cursor/skills"; ln -sf ../agent-pack/product/lighthouse/workflows "$REPO_ROOT/.cursor/workflows"; echo "cursor: agents/skills/workflows linked" ;;
    opencode) mkdir -p "$REPO_ROOT/.opencode"; echo "opencode: uses AGENT_PACK_ROOT directly" ;;
    *) echo "$h: packs at agent-pack/product/lighthouse + agent-pack/loom" ;;
  esac
}
if [[ "$HARNESS" == "all" ]]; then for h in opencode cursor claude codex; do install_one "$h"; done; else install_one "$HARNESS"; fi
echo "Done. SoT is agent-pack/ (D38)."
