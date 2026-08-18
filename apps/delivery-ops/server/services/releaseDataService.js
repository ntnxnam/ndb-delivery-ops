/**
 * Release-data service: read-only orchestration for the release-versions
 * dropdowns and version-discovery diagnostics.
 *
 * Functions in this module:
 *   - listOpenReleaseVersions  — returns the filtered, sorted name list a
 *                                 team's Release Versions / Trends dropdowns use
 *   - discoverVersionsWithFilters
 *                              — same list plus per-version base-filter
 *                                 metadata used by Release Setup tooling
 *
 * Both endpoints hit JIRA's project-versions API, filter to non-released /
 * non-archived versions, optionally restrict to `team.versionPatterns` for
 * "parent project" teams (e.g. ENG), and sort newest-first. The version
 * discovery variant additionally annotates each version with the JQL base
 * filter the rest of the app uses to query items for that release.
 *
 * Extracted from server/routes/jira/index.js during Phase 2b.1b.
 */

const axios = require('axios');
const { JIRA_API_V2 } = require('../config/api');
const { createHttpsAgent, retryJiraCall, jiraHeaders } = require('./jiraService');
const {
  getReleaseBaseFilter,
  getConfigOverride,
  resolveTeam,
} = require('../utils/jiraRouteHelpers');

const JIRA_TIMEOUT_MS = 15000;

/**
 * Fetch the raw JIRA project versions and reduce to the "open" set the UI
 * shows: name only, released=false, not archived, optionally pattern-matched
 * for parent projects, sorted newest first.
 *
 * @returns {Promise<string[]>}
 */
async function fetchFilteredVersionNames(team, projectKey, jiraToken) {
  const httpsAgent = createHttpsAgent();
  const projectResponse = await retryJiraCall(() => axios.get(
    JIRA_API_V2.PROJECT_VERSIONS(projectKey),
    { headers: jiraHeaders(jiraToken), httpsAgent, timeout: JIRA_TIMEOUT_MS }
  ));

  let versions = (projectResponse.data && Array.isArray(projectResponse.data))
    ? projectResponse.data
      .filter(v => v.name && v.archived !== true)
      .map(v => ({ name: v.name, released: !!v.released, releaseDate: v.releaseDate || undefined }))
    : [];

  // Apply team-specific version filtering.
  // For parent-project teams (e.g. ENG) use versionPatterns to whitelist versions.
  // For all teams with a releasePrefix/activeVersionNames, use those to filter.
  if (team && team.projectType === 'parent' && Array.isArray(team.versionPatterns)) {
    const originalCount = versions.length;
    const patterns = team.versionPatterns.map(pattern => new RegExp(pattern, 'i'));
    versions = versions.filter(v => patterns.some(rx => rx.test(v.name)));
    console.log(`[releaseDataService] Parent project filtering for ${team.id}: ${originalCount} → ${versions.length} versions`);
  } else if (team && (team.releasePrefix || team.activeVersionNames)) {
    // Dedicated project teams: keep only versions matching the release prefix
    // or pinned version names (e.g. "master", "Era Future").
    const originalCount = versions.length;
    const prefix = team.releasePrefix || '';
    const pinned = new Set(Array.isArray(team.activeVersionNames) ? team.activeVersionNames : []);
    versions = versions.filter(v =>
      (prefix && v.name.startsWith(prefix)) || pinned.has(v.name)
    );
    console.log(`[releaseDataService] Prefix+pinned filtering for ${team.id}: ${originalCount} → ${versions.length} versions (prefix="${prefix}", pinned=[${[...pinned].join(', ')}])`);
  }

  return versions.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * List open release version names for a team's project.
 * Used by ReleaseVersionTab + ReleaseTrendsPage dropdowns.
 *
 * @param {string} jiraToken
 * @param {{ teamId?: string }} input
 * @returns {Promise<{ versions: string[] }>}
 * @throws {Error & { statusCode? }} on validation or upstream failure.
 *   - statusCode 400 if team / projectKey missing
 *   - statusCode 429 if JIRA reports rate-limit
 */
async function listOpenReleaseVersions(jiraToken, { teamId } = {}) {
  const { effectiveTeamId, team, projectKey } = resolveTeam(teamId);

  if (!effectiveTeamId || !projectKey) {
    const err = new Error(
      effectiveTeamId
        ? `Team "${effectiveTeamId}" has no projectKey in config. Add projectKey (e.g. "ERA" for dedicated projects, "ENG" for parent projects) to teamBoardConfig.json.`
        : 'Select a team in the header to load release versions.'
    );
    err.statusCode = 400;
    err.publicError = 'Team not selected or team has no project configured for versions';
    throw err;
  }

  try {
    const versions = await fetchFilteredVersionNames(team, projectKey, jiraToken);
    return { versions };
  } catch (apiError) {
    if (apiError.response?.status === 429 || apiError.message?.includes('rate limit')) {
      const err = new Error('JIRA rate limit exceeded. Please wait 60-90 seconds and try again.');
      err.statusCode = 429;
      err.publicError = 'Rate limit exceeded';
      throw err;
    }
    const err = new Error(apiError.response?.data?.errorMessages?.join(', ') || apiError.message);
    err.statusCode = apiError.response?.status || 500;
    err.publicError = 'Failed to fetch release versions';
    throw err;
  }
}

/**
 * List open release versions and annotate each with the dynamic base filter
 * (JQL or saved-filter ref) the rest of the app will use to query items for
 * that version. Used by Release Setup / discovery tooling.
 *
 * @param {string} jiraToken
 * @param {{ teamId?: string }} input
 * @returns {Promise<{ teamId, teamName, projectKey, projectType, versionPatterns, versions: Array<{ name, dynamicFilter, hasConfigOverride }> }>}
 */
async function discoverVersionsWithFilters(jiraToken, { teamId } = {}) {
  const { effectiveTeamId, team } = resolveTeam(teamId);
  if (!effectiveTeamId || !team) {
    const err = new Error('Select a valid team to discover release versions.');
    err.statusCode = 400;
    err.publicError = 'Team not found';
    throw err;
  }

  const versions = await fetchFilteredVersionNames(team, team.projectKey, jiraToken);
  const versionsWithFilters = versions.map(v => ({
    name: v.name,
    released: v.released,
    releaseDate: v.releaseDate,
    dynamicFilter: getReleaseBaseFilter(v.name, effectiveTeamId),
    hasConfigOverride: !!getConfigOverride(v.name),
  }));

  return {
    teamId: effectiveTeamId,
    teamName: team.name,
    projectKey: team.projectKey,
    projectType: team.projectType || 'dedicated',
    versionPatterns: team.versionPatterns || null,
    versions: versionsWithFilters,
  };
}

module.exports = {
  listOpenReleaseVersions,
  discoverVersionsWithFilters,
};
