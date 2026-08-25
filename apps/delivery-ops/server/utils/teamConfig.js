/**
 * Team-config lookup helpers. Encapsulates the two config files that
 * NDB-Ops projects use to identify teams, boards, and KPIs:
 *
 *   - config/teamBoardConfig.json — team -> { id, baseFilter, sprintBaseFilter, boardId, ... }
 *   - config/kpiConfig.json       — { teams: { [teamId]: KPI[] } }
 *
 * Pulled out of server/routes/jira/index.js during Phase 2a.
 *
 * Team lookups are case-insensitive. The board config is cached by file
 * mtime so getTeamBaseFilter / sprint / SoS paths do not re-parse JSON
 * on every request; writes call invalidateTeamBoardCache().
 */

const fs = require('fs');
const path = require('path');

const KPI_CONFIG_PATH = path.join(__dirname, '..', 'config', 'kpiConfig.json');
const TEAM_CONFIG_PATH = path.join(__dirname, '..', 'config', 'teamBoardConfig.json');

const EMPTY_BOARD_CONFIG = { teams: [], defaultTeamId: null };

let boardCache = { config: null, mtimeMs: -1 };

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
 * Coerce teams to an array. Older configs stored a map keyed by id.
 * @param {*} teams
 * @returns {Array<object>}
 */
function normalizeTeamsList(teams) {
  if (Array.isArray(teams)) return teams;
  if (teams && typeof teams === 'object') {
    return Object.entries(teams).map(([id, value]) => {
      if (value && typeof value === 'object') {
        return { ...value, id: value.id || id };
      }
      return { id };
    });
  }
  return [];
}

/**
 * Find a team in a list by id (case-insensitive).
 * @param {Array|object} teams
 * @param {string} teamId
 * @returns {object|null}
 */
function findTeamInList(teams, teamId) {
  const nid = normalizeTeamId(teamId);
  if (!nid) return null;
  return normalizeTeamsList(teams).find((t) => normalizeTeamId(t.id) === nid) || null;
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

function bustRequireCache() {
  try {
    delete require.cache[require.resolve(TEAM_CONFIG_PATH)];
  } catch (e) {
    // not yet required
  }
}

/**
 * Load teamBoardConfig. Cached by file mtime so live admin edits are
 * picked up without re-reading on every JIRA request.
 * @returns {{ teams: Array, defaultTeamId: string|null }}
 */
function loadTeamBoardConfig() {
  try {
    // Jest mocks teamBoardConfig.json; skip mtime cache so the mock is always read.
    const skipCache = process.env.NODE_ENV === 'test';
    const stat = skipCache ? { mtimeMs: -2 } : fs.statSync(TEAM_CONFIG_PATH);
    if (!skipCache && boardCache.config && boardCache.mtimeMs === stat.mtimeMs) {
      return boardCache.config;
    }
    bustRequireCache();
    const parsed = require(TEAM_CONFIG_PATH) || {};
    const config = {
      ...parsed,
      teams: normalizeTeamsList(parsed.teams),
      defaultTeamId: parsed.defaultTeamId || null,
    };
    boardCache = { config, mtimeMs: stat.mtimeMs };
    return config;
  } catch (e) {
    console.warn('teamBoardConfig load failed:', e.message);
    return boardCache.config || { ...EMPTY_BOARD_CONFIG, teams: [] };
  }
}

function invalidateTeamBoardCache() {
  boardCache = { config: null, mtimeMs: -1 };
  bustRequireCache();
}

/**
 * Persist teamBoardConfig and refresh the in-memory cache so the next
 * getTeamBaseFilter call sees the new base query without a restart.
 */
function saveTeamBoardConfig(config) {
  const toWrite = {
    ...config,
    teams: normalizeTeamsList(config && config.teams),
  };
  fs.writeFileSync(TEAM_CONFIG_PATH, JSON.stringify(toWrite, null, 2), 'utf8');
  invalidateTeamBoardCache();
  return loadTeamBoardConfig();
}

function getTeamById(teamId) {
  const config = loadTeamBoardConfig();
  return findTeamInList(config.teams, teamId);
}

function getTeamField(teamId, fieldName) {
  const team = getTeamById(teamId);
  const value = team && team[fieldName] ? String(team[fieldName]).trim() : '';
  return value || null;
}

/**
 * Return the JQL base filter for a team (e.g. "filter=NDB-All-Base-Filter and statusCategory!=Done").
 * Returns null if the team is not configured or has no baseFilter.
 * @param {string} teamId
 * @returns {string|null}
 */
function getTeamBaseFilter(teamId) {
  return getTeamField(teamId, 'baseFilter');
}

/**
 * Sprint-specific base filter (project scope only — no statusCategory!=Done clause,
 * because sprint reports must count completed/Resolved issues).
 * @param {string} teamId
 * @returns {string|null}
 */
function getTeamSprintBaseFilter(teamId) {
  return getTeamField(teamId, 'sprintBaseFilter');
}

/**
 * SoS-specific base filter (used by the SoS Summary page — always live JIRA, no cache).
 * @param {string} teamId
 * @returns {string|null}
 */
function getTeamSosBaseFilter(teamId) {
  return getTeamField(teamId, 'sosBaseFilter');
}

module.exports = {
  normalizeTeamId,
  normalizeTeamsList,
  findTeamInList,
  loadKpiConfigSync,
  getKpisForTeam,
  loadTeamBoardConfig,
  saveTeamBoardConfig,
  invalidateTeamBoardCache,
  getTeamById,
  getTeamBaseFilter,
  getTeamSprintBaseFilter,
  getTeamSosBaseFilter,
};
