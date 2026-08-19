/**
 * Team-config lookup helpers. Encapsulates the two config files that
 * NDB-Ops projects use to identify teams, boards, and KPIs:
 *
 *   - config/teamBoardConfig.json — team -> { id, baseFilter, sprintBaseFilter, boardId, ... }
 *   - config/kpiConfig.json       — { teams: { [teamId]: KPI[] } }
 *
 * Pulled out of server/routes/jira/index.js during Phase 2a.
 */

const fs = require('fs');
const path = require('path');

const KPI_CONFIG_PATH = path.join(__dirname, '..', 'config', 'kpiConfig.json');
const TEAM_CONFIG_PATH = path.join(__dirname, '..', 'config', 'teamBoardConfig.json');

/**
 * Normalize a teamId for consistent lookup: trim + lowercase.
 * @param {*} teamId
 * @returns {string} normalized id, or '' if input is invalid
 */
function normalizeTeamId(teamId) {
  if (teamId == null || typeof teamId !== 'string') return '';
  return String(teamId).trim().toLowerCase();
}

/**
 * Load the KPI config file synchronously and return the teams map as
 * { [normalizedTeamId]: KPI[] }. Returns {} on parse / read failure.
 * Logs a warning rather than throwing so the calling route stays alive.
 */
function loadKpiConfigSync() {
  let config = { teams: {} };
  try {
    const raw = fs.readFileSync(KPI_CONFIG_PATH, 'utf8');
    if (raw && raw.trim()) config = JSON.parse(raw);
  } catch (e) {
    console.warn('KPI config load failed:', e.message);
    return {};
  }
  const teams = config.teams;
  if (!teams || typeof teams !== 'object') return {};
  const out = {};
  for (const [tid, arr] of Object.entries(teams)) {
    const key = normalizeTeamId(tid) || tid;
    out[key] = Array.isArray(arr) ? arr : [];
  }
  return out;
}

/**
 * Given a teams map (from loadKpiConfigSync) and a teamId, return the team's
 * KPI array. Returns { kpis: null, normalizedTeamId: '' } if not found.
 */
function getKpisForTeam(teams, teamId) {
  const normalizedTeamId = normalizeTeamId(teamId);
  if (!normalizedTeamId) return { kpis: null, normalizedTeamId: '' };
  const kpis = teams[normalizedTeamId];
  return {
    kpis: Array.isArray(kpis) ? kpis : null,
    normalizedTeamId,
  };
}

/**
 * Internal: load teamBoardConfig fresh (bypassing require cache) so live
 * config edits during dev take effect without restart.
 */
function loadTeamBoardConfig() {
  try {
    delete require.cache[require.resolve(TEAM_CONFIG_PATH)];
    return require(TEAM_CONFIG_PATH);
  } catch (e) {
    return null;
  }
}

/**
 * Return the JQL base filter for a team (e.g. "filter=NDB-All-Base-Filter and statusCategory!=Done").
 * Returns null if the team is not configured or config can't be read.
 * @param {string} teamId
 * @returns {string|null}
 */
function getTeamBaseFilter(teamId) {
  const config = loadTeamBoardConfig();
  if (!config) return null;
  const teams = config.teams || [];
  const team = teams.find((t) => t.id === teamId);
  const base = (team && team.baseFilter) ? String(team.baseFilter).trim() : '';
  return base || null;
}

/**
 * Sprint-specific base filter (project scope only — no statusCategory!=Done clause,
 * because sprint reports must count completed/Resolved issues).
 * @param {string} teamId
 * @returns {string|null}
 */
function getTeamSprintBaseFilter(teamId) {
  const config = loadTeamBoardConfig();
  if (!config) return null;
  const teams = config.teams || [];
  const team = teams.find((t) => t.id === teamId);
  const sprintBase = (team && team.sprintBaseFilter) ? String(team.sprintBaseFilter).trim() : '';
  return sprintBase || null;
}

/**
 * SoS-specific base filter (used by the SoS Summary page — always live JIRA, no cache).
 * @param {string} teamId
 * @returns {string|null}
 */
function getTeamSosBaseFilter(teamId) {
  const config = loadTeamBoardConfig();
  if (!config) return null;
  const teams = config.teams || [];
  const team = teams.find((t) => t.id === teamId);
  const sosBase = (team && team.sosBaseFilter) ? String(team.sosBaseFilter).trim() : '';
  return sosBase || null;
}

module.exports = {
  normalizeTeamId,
  loadKpiConfigSync,
  getKpisForTeam,
  getTeamBaseFilter,
  getTeamSprintBaseFilter,
  getTeamSosBaseFilter,
};
