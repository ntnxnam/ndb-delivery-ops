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
 *   - createJchTicket     — create JCH Task when version creation fails (fallback)
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
    const wrapped = wrapJiraError(error, 'Failed to create version');
    if (wrapped.statusCode === 403 || wrapped.statusCode === 401) {
      wrapped.message = `${wrapped.message} — project admin required. Use JCH fallback to request this version.`;
    }
    throw wrapped;
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

async function checkJchTicketExists(jiraToken, { versionName, projectKey }) {
  if (!versionName || !projectKey) {
    const e = new Error('versionName and projectKey are required');
    e.statusCode = 400;
    throw e;
  }
  const jira = await getJira(jiraToken);
  const summary = `Request: Create fixVersion ${versionName} in ${projectKey}`;
  // Search by project + summary substring; then exact-match in code to avoid JQL fuzzy issues
  const jql = `project = JCH AND summary ~ "${summary.replace(/"/g, '\\"').slice(0, 80)}"`;
  try {
    const res = await jira.get('/rest/api/2/search', { params: { jql, maxResults: 20, fields: 'key,summary,status,issuetype' }, timeout: JIRA_TIMEOUT_MS });
    const issues = res.data?.issues || [];
    const exact = issues.find(it => String(it.fields?.summary || '').trim() === summary);
    if (exact) {
      return { exists: true, key: exact.key, id: exact.id, status: exact.fields?.status?.name, url: `${JIRA_API_V2.BASE_URL}/browse/${exact.key}` };
    }
  } catch (_) {}
  // Fallback: try broader JQL by fixVersion text in summary without JQL escaping issues
  try {
    const jql2 = `project = JCH AND text ~ "${`${versionName} ${projectKey}`.replace(/"/g, '\\"')}"`;
    const res2 = await jira.get('/rest/api/2/search', { params: { jql: jql2, maxResults: 20, fields: 'key,summary,status' }, timeout: JIRA_TIMEOUT_MS });
    const exact2 = (res2.data?.issues || []).find(it => String(it.fields?.summary || '').includes(versionName) && String(it.fields?.summary || '').includes(projectKey));
    if (exact2) return { exists: true, key: exact2.key, id: exact2.id, status: exact2.fields?.status?.name, url: `${JIRA_API_V2.BASE_URL}/browse/${exact2.key}` };
  } catch (_) {}
  return { exists: false };
}

/**
 * Create a JCH ticket requesting version creation when direct creation failed.
 * Idempotent: if a JCH with same summary already exists, return it instead of creating duplicate.
 * Uses POST /rest/api/2/issue. If JCH mandates Component/s (or other required
 * fields) we fetch createmeta + project components and retry once.
 */
async function createJchTicket(jiraToken, { versionName, projectKey, errorDetail, releaseDate }) {
  if (!versionName || !projectKey) {
    const err = new Error('versionName and projectKey are required');
    err.statusCode = 400;
    throw err;
  }
  // Dedup: if JCH already exists for this version/project, return it (don't create duplicate)
  try {
    const existing = await checkJchTicketExists(jiraToken, { versionName, projectKey });
    if (existing.exists) {
      return { key: existing.key, id: existing.id, url: existing.url, alreadyExists: true, status: existing.status };
    }
  } catch (_) {}

  async function doCreate(extraFields = null) {
    const jira = await getJira(jiraToken);
    const summary = `Request: Create fixVersion ${versionName} in ${projectKey}`;
    const safeError = errorDetail ? String(errorDetail).slice(0, 1000).replace(/\s+/g, ' ').trim() : '';
    const description = [
      `Automated request from Release Setup (delivery-ops).`,
      ``,
      `Version: ${versionName}`,
      `Target project: ${projectKey}`,
      releaseDate ? `Requested release date: ${releaseDate}` : `Requested release date: not set`,
      safeError ? `Creation error: ${safeError}` : ``,
      ``,
      `Please create fixVersion "${versionName}" in project ${projectKey} and assign / transition this ticket when done.`,
    ].filter(Boolean).join('\n');

    const payload = {
      fields: {
        project: { key: 'JCH' },
        summary,
        description,
        issuetype: { name: 'Task' },
        ...extraFields,
      },
    };
    const createUrl = JIRA_API_V2.CREATE_ISSUE || `${JIRA_API_V2.BASE_URL}/rest/api/2/issue`;
    const res = await jira.post(createUrl, payload, { timeout: JIRA_TIMEOUT_MS });
    return {
      key: res.data?.key,
      id: res.data?.id,
      url: res.data?.key ? `${JIRA_API_V2.BASE_URL}/browse/${res.data.key}` : null,
    };
  }

  try {
    return await doCreate(null);
  } catch (error) {
    const msg = error.response?.data?.errors ? Object.values(error.response.data.errors).join(' ') : '';
    const msg2 = (error.response?.data?.errorMessages || []).join(' ');
    const combined = `${msg} ${msg2}`.toLowerCase();
    const needsComponent = combined.includes('component') && combined.includes('required');
    const is400 = error.response?.status === 400 || error.statusCode === 400;
    if (is400 && needsComponent) {
      try {
        const jira = await getJira(jiraToken);
        let compName = null;
        try {
          const compRes = await jira.get(`${JIRA_API_V2.BASE_URL}/rest/api/2/project/JCH/components`, { timeout: JIRA_TIMEOUT_MS });
          const comps = Array.isArray(compRes.data) ? compRes.data : [];
          if (comps.length) compName = comps[0].name || comps[0].id;
        } catch (_) {}
        if (!compName) {
          try {
            const metaRes = await jira.get(`${JIRA_API_V2.BASE_URL}/rest/api/2/issue/createmeta?projectKeys=JCH&issuetypeNames=Task&expand=projects.issuetypes.fields`, { timeout: JIRA_TIMEOUT_MS });
            const projects = metaRes.data?.projects || [];
            const issuetype = projects[0]?.issuetypes?.find(t => t.name === 'Task') || projects[0]?.issuetypes?.[0];
            const fields = issuetype?.fields || {};
            if (!compName && fields['components']?.required) {
              const allowed = fields['components']?.allowedValues || [];
              if (allowed.length) compName = allowed[0].name || allowed[0].id;
            }
          } catch (_) {}
        }
        if (compName) {
          return await doCreate({ components: [{ name: compName }] });
        }
      } catch (_) {}
    }
    const wrapped = wrapJiraError(error, 'Failed to create JCH ticket');
    if (wrapped.statusCode === 403) {
      wrapped.message = `${wrapped.message} — you need Create permission in JCH. Contact a JCH admin or ask in Slack #jch.`;
    } else if (wrapped.statusCode === 400 && combined.includes('component')) {
      wrapped.message = `${wrapped.message} — JCH requires Component/s. Tried auto-fill; if this persists, set a Component manually in JIRA or contact JCH admin.`;
    }
    throw wrapped;
  }
}

module.exports = {
  checkVersionExists,
  createVersion,
  checkFilterExists,
  createFilter,
  createJchTicket,
  checkJchTicketExists,
};
