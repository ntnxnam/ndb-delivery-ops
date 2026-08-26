/**
 * Release-setup service: orchestrates JIRA version + filter administration
 * actions (check, create) for the Release Setup admin UI.
 *
 * Functions in this module:
 *   - checkVersionExists  — does a fixVersion already exist in a project?
 *   - createVersion       — create a new fixVersion
 *   - checkFilterExists   — does a saved JIRA filter exist by name?
 *   - createFilter        — create a saved JIRA filter (with auto-registration
 *                           of the X-All root filter in releaseVersionsColumnsConfig)
 *
 * Companion service `jiraFilterService.js` owns the heavier rename / cleanup
 * cascade operations. New release-setup admin actions belong here unless they
 * specifically need the cross-filter orchestration that lives there.
 *
 * Extracted from server/routes/jira/index.js during Phase 2b.1.
 */

const fs = require('fs');
const path = require('path');
const { JIRA_API_V2 } = require('../config/api');
const { getJira, wrapJiraError } = require('../utils/jiraClient');

const JIRA_TIMEOUT_MS = 15000;
const RELEASE_COLUMNS_CONFIG_PATH = path.join(__dirname, '..', 'config', 'releaseVersionsColumnsConfig.json');

/**
 * Check whether a fixVersion already exists in a JIRA project.
 *
 * @param {string} jiraToken - cleaned bearer token
 * @param {{ projectKey: string, versionName: string }} input
 * @returns {Promise<{ exists: boolean, versionId: string|null, releaseDate: string|null, released: boolean|null }>}
 * @throws {Error} on validation failure or unexpected JIRA response
 */
async function checkVersionExists(jiraToken, { projectKey, versionName }) {
  if (!projectKey || !versionName) {
    const err = new Error('projectKey and versionName are required');
    err.statusCode = 400;
    throw err;
  }
  try {
    const jira = await getJira(jiraToken);
    const versionsRes = await jira.get(
      JIRA_API_V2.PROJECT_VERSIONS(projectKey),
      { timeout: JIRA_TIMEOUT_MS }
    );
    const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [];
    const match = versions.find(v => v.name === versionName);
    return {
      exists: !!match,
      versionId: match ? match.id : null,
      releaseDate: match ? match.releaseDate : null,
      released: match ? match.released : null,
    };
  } catch (error) {
    throw wrapJiraError(error, 'Failed to check version');
  }
}

/**
 * Create a fixVersion in a JIRA project.
 *
 * @param {string} jiraToken
 * @param {{ projectKey: string, versionName: string, releaseDate?: string }} input
 * @returns {Promise<{ versionId: string, name: string, projectKey: string }>}
 */
async function createVersion(jiraToken, { projectKey, versionName, releaseDate }) {
  if (!projectKey || !versionName) {
    const err = new Error('projectKey and versionName are required');
    err.statusCode = 400;
    throw err;
  }
  try {
    const jira = await getJira(jiraToken);
    const payload = { name: versionName, project: projectKey, released: false };
    if (releaseDate) payload.releaseDate = releaseDate;

    const createRes = await jira.post(
      JIRA_API_V2.CREATE_VERSION,
      payload,
      { timeout: JIRA_TIMEOUT_MS }
    );
    return {
      versionId: createRes.data?.id,
      name: createRes.data?.name,
      projectKey,
    };
  } catch (error) {
    throw wrapJiraError(error, 'Failed to create version');
  }
}

/**
 * Check whether a saved JIRA filter exists by name.
 * Returns exists=false (not an error) when the filter/search endpoint 404s on
 * older JIRA Server instances, so callers can safely follow up with create.
 *
 * @param {string} jiraToken
 * @param {{ filterName: string }} input
 * @returns {Promise<{ exists: boolean, filterId: string|null, jql: string|null, filterName: string }>}
 */
async function checkFilterExists(jiraToken, { filterName }) {
  if (!filterName) {
    const err = new Error('filterName is required');
    err.statusCode = 400;
    throw err;
  }
  const jira = await getJira(jiraToken);
  const searchUrl = `${JIRA_API_V2.FILTER_SEARCH}?filterName=${encodeURIComponent(filterName)}&maxResults=50`;
  try {
    const listRes = await jira.get(searchUrl, { timeout: JIRA_TIMEOUT_MS });
    const filters = Array.isArray(listRes.data?.values)
      ? listRes.data.values
      : Array.isArray(listRes.data?.results)
        ? listRes.data.results
        : Array.isArray(listRes.data)
          ? listRes.data
          : [];
    const match = filters.find(f => f.name && String(f.name).trim() === filterName.trim());
    return {
      exists: !!match,
      filterId: match ? match.id : null,
      jql: match ? match.jql : null,
      filterName,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return { exists: false, filterId: null, jql: null, filterName };
    }
    throw wrapJiraError(error, 'Failed to check filter');
  }
}

/**
 * Create a saved JIRA filter. If the created filter is the root "<NDB-X.Y>-All"
 * pattern, register it in releaseVersionsColumnsConfig.json so the rest of the
 * app picks it up automatically. Config write errors are logged but not fatal.
 *
 * @param {string} jiraToken
 * @param {{ filterName: string, jql: string, description?: string }} input
 * @returns {Promise<{ filterId: string, filterName: string, jql: string }>}
 */
async function createFilter(jiraToken, { filterName, jql, description }) {
  if (!filterName || !jql) {
    const err = new Error('filterName and jql are required');
    err.statusCode = 400;
    throw err;
  }
  let createRes;
  try {
    const jira = await getJira(jiraToken);
    const payload = {
      name: filterName.trim(),
      jql: jql.trim(),
      favourite: true,
    };
    if (description) payload.description = description;

    createRes = await jira.post(
      JIRA_API_V2.CREATE_FILTER,
      payload,
      { timeout: JIRA_TIMEOUT_MS }
    );
  } catch (error) {
    throw wrapJiraError(error, 'Failed to create filter');
  }

  const createdName = createRes.data?.name || filterName;
  const allFilterMatch = createdName.match(/^(NDB-[\d.]+)-All$/i);
  if (allFilterMatch) {
    const releaseVersion = allFilterMatch[1];
    try {
      const raw = fs.readFileSync(RELEASE_COLUMNS_CONFIG_PATH, 'utf8');
      const config = raw && raw.trim() ? JSON.parse(raw) : {};
      if (!config.releaseBaseFilters || typeof config.releaseBaseFilters !== 'object') {
        config.releaseBaseFilters = {};
      }
      config.releaseBaseFilters[releaseVersion] = `filter=${createdName}`;
      fs.writeFileSync(RELEASE_COLUMNS_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (configErr) {
      console.warn('[releaseSetupService.createFilter] Could not auto-register base filter in config:', configErr.message);
    }
  }

  return {
    filterId: createRes.data?.id,
    filterName: createRes.data?.name,
    jql: createRes.data?.jql,
  };
}

module.exports = {
  checkVersionExists,
  createVersion,
  checkFilterExists,
  createFilter,
};
