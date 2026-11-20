/**
 * teamResolve — shared helper for release version → team resolution.
 * Extracted to avoid duplication between releaseFinalizeService and releaseAnnouncementService (D3 one feature one place).
 * This copy lives under apps/delivery-ops/server/utils/ so that
 * apps/delivery-ops/server/services/* can require('../utils/teamResolve') without
 * crossing to the legacy root server/ directory.
 */
const { loadTeamBoardConfig, getTeamById } = require('./teamConfig');

function resolveTeamForRelease(version, teamId) {
  if (teamId) {
    const t = getTeamById(teamId);
    if (t) return t;
  }
  const cfg = loadTeamBoardConfig();
  const teams = cfg.teams || [];
  for (const tm of teams) {
    const prefixes = tm.releasePrefixes || [];
    for (const p of prefixes) {
      if (version.startsWith(p)) return tm;
    }
  }
  const def = cfg.defaultTeamId && getTeamById(cfg.defaultTeamId);
  return def || teams[0] || null;
}

module.exports = { resolveTeamForRelease };
