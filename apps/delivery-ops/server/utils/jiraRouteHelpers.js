/**
 * Small JIRA helpers that are shared across every JIRA route family.
 * Pulled out of server/routes/jira/index.js during Phase 2a.
 *
 * Specifically these are:
 *   - upstreamStatus           — translate JIRA 501 -> 502 for client responses
 *   - getDefaultReleaseBaseFilter  — "filter={version}-All"
 *   - getTeamConfig            — find a team object in teamBoardConfig
 *   - constructParentProjectFilter — parent-project release filter
 *   - getConfigOverride        — release-specific overrides from columns config
 *   - getReleaseBaseFilter     — orchestrates all of the above
 */

const path = require('path');
const { getTeamById, loadTeamBoardConfig } = require('./teamConfig');

const COLUMNS_CONFIG_PATH = path.join(__dirname, '..', 'config', 'releaseVersionsColumnsConfig.json');

/**
 * JIRA occasionally returns 501 Not Implemented for queries we know are valid.
 * Translate that to 502 Bad Gateway for clients so the UI doesn't display a
 * misleading "feature missing" error.
 */
const upstreamStatus = (status) => (status === 501 ? 502 : status);

/**
 * Default release base filter when no override is configured.
 * Convention: "filter={version}-All" (e.g. "NDB-2.11" -> "filter=NDB-2.11-All").
 */
function getDefaultReleaseBaseFilter(releaseVersion) {
  if (!releaseVersion || typeof releaseVersion !== 'string') return null;
  const v = releaseVersion.trim();
  return v ? `filter=${v}-All` : null;
}

/**
 * Look up a team object in teamBoardConfig.json by id (case-insensitive).
 * Reads through the mtime-cached loader so a saved baseFilter is visible
 * on the next request without a process restart.
 */
function getTeamConfig(teamId) {
  return getTeamById(teamId);
}

/**
 * Build the release base filter for a parent-project team (DataLens, NCM).
 * Same shape as the default; kept as a named function so the orchestration
 * is readable and future per-team branches have a place to grow.
 */
function constructParentProjectFilter(releaseVersion, team) {
  if (!releaseVersion || !team) return null;
  const v = releaseVersion.trim();
  return v ? `filter=${v}-All` : null;
}

/**
 * Read releaseVersionsColumnsConfig.json fresh (bypassing require cache) and
 * return the configured override for a release version, if any.
 * The sentinel value "filter=0" means "no override, use default".
 */
function getConfigOverride(releaseVersion) {
  try {
    delete require.cache[require.resolve(COLUMNS_CONFIG_PATH)];
    const config = require(COLUMNS_CONFIG_PATH);
    const map = config.releaseBaseFilters || {};
    const override = map[releaseVersion] ? String(map[releaseVersion]).trim() : '';
    return (override && override !== 'filter=0') ? override : null;
  } catch (e) {
    return null;
  }
}

/**
 * Resolve the release base filter for a release version, optionally
 * scoped to a team. Tries (in order):
 *   1. Explicit override from releaseVersionsColumnsConfig.json
 *   2. Parent-project pattern if the team is a parent project
 *   3. Default pattern: filter={version}-All
 */
function getReleaseBaseFilter(releaseVersion, teamId = null) {
  const configOverride = getConfigOverride(releaseVersion);
  if (configOverride) return configOverride;

  const team = getTeamConfig(teamId);
  if (team && team.projectType === 'parent') {
    return constructParentProjectFilter(releaseVersion, team);
  }

  return getDefaultReleaseBaseFilter(releaseVersion);
}

/**
 * Resolve a team-scoped context from an optional teamId. Applies the
 * standard NDB-Ops fallback chain:
 *   1. The teamId the caller passed in
 *   2. teamBoardConfig.defaultTeamId
 *   3. The first team in the array (so we never return null in dev)
 *
 * Returns { effectiveTeamId, team, projectKey } so each caller can
 * destructure what it needs without re-loading the config.
 */
function resolveTeam(teamId) {
  const config = loadTeamBoardConfig();
  const teams = config.teams || [];
  const team = getTeamById(teamId) || getTeamById(config.defaultTeamId) || teams[0] || null;
  return {
    effectiveTeamId: (team && team.id) || teamId || config.defaultTeamId || null,
    team,
    projectKey: team && team.projectKey ? team.projectKey : null,
  };
}

/**
 * Standard error responder for service-backed route handlers. Maps the
 * { statusCode, message, details? } shape thrown by services into the
 * { success: false, error, message, details? } JSON envelope the client
 * expects. Use this in catch blocks so every endpoint reports failures
 * the same way.
 *
 * - 400-class errors echo the service's message as the user-facing `error`.
 * - Other statuses use `fallbackMessage` so internals don't leak.
 * - `error.details` (set by services for upstream JIRA payloads) passes
 *   through when present.
 */
function sendServiceError(res, error, fallbackMessage, opts = {}) {
  const status = error.statusCode || error.response?.status || 500;
  const isClientError = status >= 400 && status < 500;
  const body = {
    success: false,
    error: isClientError ? (error.message || fallbackMessage) : fallbackMessage,
    message: error.message,
  };
  if (error.details !== undefined) body.details = error.details;
  if (opts.includeStack && process.env.NODE_ENV !== 'production') {
    body.stack = error.stack;
  }
  return res.status(status).json(body);
}

module.exports = {
  upstreamStatus,
  getDefaultReleaseBaseFilter,
  getTeamConfig,
  constructParentProjectFilter,
  getConfigOverride,
  getReleaseBaseFilter,
  resolveTeam,
  sendServiceError,
};
