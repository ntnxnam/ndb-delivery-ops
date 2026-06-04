/**
 * Component Report Service
 *
 * Fetches components directly from the JIRA project components API
 * and aggregates component-scoped payload data.
 */

const axios = require('axios');
const https = require('https');
const { JIRA_API_V2 } = require('../config/api');
const { runSearchByJql } = require('../utils/jiraSearchByJql');
const { createHttpsAgent } = require('../services/jiraService');
const teamBoardConfig = require('../config/teamBoardConfig.json');

function getProjectKey() {
  const teams = Array.isArray(teamBoardConfig.teams) ? teamBoardConfig.teams : Object.values(teamBoardConfig.teams || {});
  return (teams[0] && teams[0].projectKey) || 'ERA';
}

/**
 * Fetch all components registered on the JIRA project.
 * Uses /rest/api/2/project/{key}/components — direct API, no JQL scanning.
 */
async function fetchComponentsFromERA(jiraToken) {
  const projectKey = getProjectKey();
  const url = `${JIRA_API_V2.PROJECT(projectKey)}/components`;
  const httpsAgent = createHttpsAgent();

  console.log('[componentReportService] Fetching components from:', url);

  let response;
  try {
    response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${jiraToken.trim()}`,
        Accept: 'application/json',
      },
      httpsAgent,
      timeout: 15000,
    });
  } catch (axiosErr) {
    const status = axiosErr.response?.status;
    const body = axiosErr.response?.data;
    console.error('[componentReportService] JIRA returned', status, JSON.stringify(body));
    throw axiosErr;
  }

  const raw = Array.isArray(response.data) ? response.data : [];

  if (raw.length > 0) {
    const s = raw[0];
    console.log('[componentReportService] raw component sample:', JSON.stringify({
      name: s.name, archived: s.archived, deleted: s.deleted, active: s.active,
      isAssigneeTypeValid: s.isAssigneeTypeValid
    }));
  }

  const components = raw
    .filter(c => c.archived !== true && c.deleted !== true)
    .map(c => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    components,
    count: components.length,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Build JQL parts for the 6-part component payload.
 * componentName is the human-readable JIRA component name (e.g. "Storage").
 *
 * JIRA JQL quoting rules:
 *   - Outer JQL: component = "Name"
 *   - Inside portfolioChildrenOf("...") or issuesInEpics("..."): use \" to escape inner quotes
 */
function buildComponentPayloadJQL(componentName) {
  const projectKey = getProjectKey();

  const esc = componentName.replace(/"/g, '\\"');
  const escInner = componentName.replace(/"/g, '\\\\"');

  // Match component via standard field OR "Primary Component" custom field.
  // No project constraint on Feature/Initiative queries — Features live in both ERA and FEAT projects.
  const compOuter = `(component = "${esc}" OR "Primary Component" = "${esc}")`;
  const compInner = `(component = \\"${escInner}\\" OR \\"Primary Component\\" = \\"${escInner}\\")`;

  return {
    // Active Features/Initiatives — no project constraint so FEAT-* tickets are included
    topLevelProjects:
      `issuetype in (Feature, Initiative) AND ${compOuter} AND status not in (Closed, Cancelled, Done, Resolved)`,

    // Children of those active projects — outer project = ERA because children live in ERA
    portfolioChildren:
      `project = ${projectKey} AND issuefunction in portfolioChildrenOf("issuetype in (Feature, Initiative) AND ${compInner} AND status not in (Closed, Cancelled, Done, Resolved)")`,

    // Work items (non-portfolio) with component and an epic link (outstanding only)
    epicChildren:
      `project = ${projectKey} AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability) AND ${compOuter} AND "Epic link" is not EMPTY AND statusCategory != Done`,

    // Active standalone epics — no parent link (not closed/cancelled)
    standaloneEpics:
      `project = ${projectKey} AND issuetype = Epic AND ${compOuter} AND "Parent Link" is EMPTY AND status not in (Closed, Cancelled, Done, Resolved)`,

    // Children of standalone epics
    standaloneEpicChildren:
      `project = ${projectKey} AND issueFunction in issuesInEpics("project = ${projectKey} AND issuetype = Epic AND ${compInner} AND \\"Parent Link\\" is EMPTY AND status not in (Closed, Cancelled, Done, Resolved)") AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability) AND statusCategory != Done`,

    // Outstanding loose tickets with component, no epic link
    directTickets:
      `project = ${projectKey} AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability) AND ${compOuter} AND "Epic link" is EMPTY AND statusCategory != Done`,

    // Stale Features/Initiatives (done/cancelled) — no project constraint, same as topLevelProjects
    staleTopLevel:
      `issuetype in (Feature, Initiative) AND ${compOuter} AND statusCategory = Done`,

    // Stale standalone Epics (done/cancelled)
    staleEpics:
      `project = ${projectKey} AND issuetype = Epic AND ${compOuter} AND "Parent Link" is EMPTY AND statusCategory = Done`,
  };
}

/**
 * Safe wrapper for runSearchByJql — returns empty result instead of throwing.
 */
async function safeJqlSearch(jiraToken, jql, maxResults, label) {
  try {
    return await runSearchByJql(jiraToken, jql, maxResults);
  } catch (err) {
    console.error(`[componentReportService] JQL failed (${label}):`, err.message, '|', jql.substring(0, 120));
    return { issues: [] };
  }
}

/**
 * Fetch component payload in parallel — active issues + stale items for Cleanup section.
 * runSearchByJql signature: (token, jql, maxResults)
 */
async function fetchComponentPayload(componentName, jiraToken) {
  const q = buildComponentPayloadJQL(componentName);
  console.log('[componentReportService] Fetching payload for component:', componentName);

  const [r0, r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
    safeJqlSearch(jiraToken, q.topLevelProjects,      100, 'topLevelProjects'),
    safeJqlSearch(jiraToken, q.portfolioChildren,     200, 'portfolioChildren'),
    safeJqlSearch(jiraToken, q.epicChildren,          500, 'epicChildren'),
    safeJqlSearch(jiraToken, q.standaloneEpics,       100, 'standaloneEpics'),
    safeJqlSearch(jiraToken, q.standaloneEpicChildren, 500, 'standaloneEpicChildren'),
    safeJqlSearch(jiraToken, q.directTickets,         200, 'directTickets'),
    safeJqlSearch(jiraToken, q.staleTopLevel,         100, 'staleTopLevel'),
    safeJqlSearch(jiraToken, q.staleEpics,            100, 'staleEpics'),
  ]);

  return {
    topLevelProjects:       r0?.issues || [],
    portfolioChildren:      r1?.issues || [],
    epicChildren:           r2?.issues || [],
    standaloneEpics:        r3?.issues || [],
    standaloneEpicChildren: r4?.issues || [],
    directTickets:          r5?.issues || [],
    staleTopLevel:          r6?.issues || [],
    staleEpics:             r7?.issues || [],
  };
}

module.exports = {
  fetchComponentsFromERA,
  buildComponentPayloadJQL,
  fetchComponentPayload,
};
