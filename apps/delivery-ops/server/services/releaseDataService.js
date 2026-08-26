/**
 * Release-data service: orchestration for the release-versions dropdown.
 *
 * Versions are unreleased names from GET /project/{team.projectKey}/versions.
 * One JIRA call. Ticket queries still AND the team's baseFilter.
 * The next upcoming JIRA GA (releaseDate) among those names is the default.
 */

const fs = require('fs');
const path = require('path');
const { getJira } = require('../utils/jiraClient');
const {
  getReleaseBaseFilter,
  getConfigOverride,
  resolveRequestedTeam,
} = require('../utils/jiraRouteHelpers');
const {
  loadTeamBoardConfig,
  saveTeamBoardConfig,
  findTeamInList,
  normalizeTeamId,
  invalidateTeamBoardCache,
} = require('../utils/teamConfig');
const {
  listFixVersionsForTeam,
  pickNextUpcomingGaVersion,
} = require('../utils/teamScope');

const COLUMNS_CONFIG_PATH = path.join(__dirname, '..', 'config', 'releaseVersionsColumnsConfig.json');

async function createAxiosJira(jiraToken) {
  return getJira(jiraToken);
}

function persistDefaultReleaseVersion(teamId, defaultVersion) {
  if (process.env.NODE_ENV === 'test') return;
  if (!teamId || !defaultVersion) return;

  try {
    // Re-read from disk so a stale in-memory snapshot cannot wipe teams
    // Admin just saved (D43 multi-team registry).
    invalidateTeamBoardCache();
    const config = loadTeamBoardConfig();
    const team = findTeamInList(config.teams, teamId);
    if (team && team.defaultReleaseVersion !== defaultVersion) {
      team.defaultReleaseVersion = defaultVersion;
      saveTeamBoardConfig(config);
    }
  } catch (err) {
    console.warn(`[releaseDataService] Could not persist team.defaultReleaseVersion: ${err.message}`);
  }

  if (normalizeTeamId(teamId) !== 'ndb') return;

  try {
    const raw = JSON.parse(fs.readFileSync(COLUMNS_CONFIG_PATH, 'utf8'));
    if (raw.defaultReleaseVersion === defaultVersion) return;
    raw.defaultReleaseVersion = defaultVersion;
    fs.writeFileSync(COLUMNS_CONFIG_PATH, `${JSON.stringify(raw, null, 2)}\n`);
  } catch (err) {
    console.warn(`[releaseDataService] Could not persist columns defaultReleaseVersion: ${err.message}`);
  }
}

function wrapJiraError(apiError) {
  if (apiError.statusCode) return apiError;
  if (apiError.response?.status === 429 || apiError.message?.includes('rate limit')) {
    const err = new Error('JIRA rate limit exceeded. Please wait 60-90 seconds and try again.');
    err.statusCode = 429;
    err.publicError = 'Rate limit exceeded';
    return err;
  }
  const err = new Error(apiError.response?.data?.errorMessages?.join(', ') || apiError.message);
  err.statusCode = apiError.response?.status || 500;
  err.publicError = 'Failed to fetch release versions';
  return err;
}

/**
 * List unreleased versions in the requested team's JIRA project.
 *
 * @returns {Promise<{ versions: Array, projectKey: string, defaultVersion: string|null }>}
 */
async function listOpenReleaseVersions(jiraToken, { teamId } = {}) {
  const { effectiveTeamId, team, projectKey } = resolveRequestedTeam(teamId);

  if (!teamId || !effectiveTeamId) {
    const err = new Error('Select a team in the header to load release versions.');
    err.statusCode = 400;
    err.publicError = 'Team not selected';
    throw err;
  }

  try {
    const jira = await createAxiosJira(jiraToken);
    const versions = await listFixVersionsForTeam(
      { id: effectiveTeamId, baseFilter: team.baseFilter, projectKey },
      jira
    );
    const defaultVersion = pickNextUpcomingGaVersion(versions);
    persistDefaultReleaseVersion(effectiveTeamId, defaultVersion);
    return { versions, projectKey, defaultVersion, teamId: effectiveTeamId };
  } catch (apiError) {
    throw wrapJiraError(apiError);
  }
}

/**
 * Same list, annotated with per-version release base filters
 * for Release Setup / discovery tooling.
 */
async function discoverVersionsWithFilters(jiraToken, { teamId } = {}) {
  const { effectiveTeamId, team, projectKey } = resolveRequestedTeam(teamId);
  if (!effectiveTeamId || !team) {
    const err = new Error('Select a valid team to discover release versions.');
    err.statusCode = 400;
    err.publicError = 'Team not found';
    throw err;
  }

  const jira = await createAxiosJira(jiraToken);
  const versions = await listFixVersionsForTeam(
    { id: effectiveTeamId, baseFilter: team.baseFilter, projectKey },
    jira
  );
  const defaultVersion = pickNextUpcomingGaVersion(versions);
  persistDefaultReleaseVersion(effectiveTeamId, defaultVersion);
  const versionsWithFilters = versions.map((v) => ({
    name: v.name,
    released: v.released,
    releaseDate: v.releaseDate,
    dynamicFilter: getReleaseBaseFilter(v.name, effectiveTeamId),
    hasConfigOverride: !!getConfigOverride(v.name),
  }));

  return {
    teamId: effectiveTeamId,
    teamName: team.name,
    projectKey,
    projectType: team.projectType || 'dedicated',
    defaultVersion,
    versions: versionsWithFilters,
  };
}

module.exports = {
  listOpenReleaseVersions,
  discoverVersionsWithFilters,
  createAxiosJira,
};
