#!/usr/bin/env bash
# archive-decommissioned-projects.sh
#
# Tarball every project that's either been imported into ndb-delivery-ops
# or is on the Tier D archive list. Does NOT delete the originals — see
# DECOMMISSION.md step 5 for the cleanup commands.
#
# Exclusions: node_modules, venv, .venv, __pycache__, dist, build, *.log
# (the .git directory IS preserved so the tarball is a full restore.)
#
# Usage:
#   ./scripts/archive-decommissioned-projects.sh
#
# Idempotent: re-running overwrites an existing tarball for the same project.

set -euo pipefail

ARCHIVE_DIR="$HOME/NDB-Ops-Tools/_archive"
mkdir -p "$ARCHIVE_DIR"

IMPORTED=(
  "ndb-status-sender"
  "Confluence-Page-Creator"
  "ndb-date-mover"
  "ndb-story-point-calculator"
  "ndb-say-vs-do"
  "ndb-projects-bin-packing"
  "Release-Timelines-Visualizer"
  "ndb-capacity-planner"
  "GitHub-Commits"
)

TIER_D=(
  "NDB-Outstanding-Work-Realistic-Timelines"
  "NDB-SWOT"
  "ndb-status-update-app"
  "ndb-release-sprint-analysis-with-chatbot"
  "NamPortfolioManagement"
  "jira-pm-app-full"
  "PM-App"
  "Data-Dash"
)

archive_one() {
  local name="$1"
  local src="$HOME/$name"
  local out="$ARCHIVE_DIR/${name}.tar.gz"

  if [[ ! -d "$src" ]]; then
    printf '  skip  %s  (not present)\n' "$name"
    return 0
  fi

  tar \
    --exclude="*/node_modules" \
    --exclude="*/venv" \
    --exclude="*/.venv" \
    --exclude="*/__pycache__" \
    --exclude="*/dist" \
    --exclude="*/build" \
    --exclude="*.log" \
    --exclude=".DS_Store" \
    -czf "$out" \
    -C "$HOME" "$name"

  local size
  size="$(du -sh "$out" | awk '{print $1}')"
  printf '  done  %-50s -> %s\n' "$name" "$size"
}

printf '\n== Imported (already inside apps/ or ported to mcp-server/) ==\n'
for n in "${IMPORTED[@]}"; do archive_one "$n"; done

printf '\n== Tier D (no migration) ==\n'
for n in "${TIER_D[@]}"; do archive_one "$n"; done

printf '\nArchive complete. Tarballs live in %s\n' "$ARCHIVE_DIR"
printf 'Originals are untouched — see DECOMMISSION.md step 5 to delete them.\n\n'
ls -lh "$ARCHIVE_DIR" | tail -n +2
