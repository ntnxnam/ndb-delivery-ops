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

  // For outer JQL context — e.g.  component = "CommonLayer"
  const compOuter = `component = "${componentName.replace(/"/g, '\\"')}"`;

  // For nested JQL inside function args — quotes must be escaped again
  // portfolioChildrenOf("... component = \"CommonLayer\" ...")
  const compInner = `component = \\"${componentName.replace(/"/g, '\\\\"')}\\"`; 

  return {
    // Direct component membership on projects/initiatives
    topLevelProjects:
      `project = ${projectKey} AND issuetype in (Feature, Initiative) AND ${compOuter} AND status not in (Closed, Cancelled)`,

    // Children of those projects — portfolioChildrenOf needs escaped inner quotes
    portfolioChildren:
      `project = ${projectKey} AND issuefunction in portfolioChildrenOf("project = ${projectKey} AND issuetype in (Feature, Initiative) AND ${compInner} AND status not in (Closed, Cancelled)")`,

    // Implementation tickets (non-portfolio) with component, linked to an epic —
    // avoids triple-nested JQL quoting issues; semantically equivalent for the component view.
    epicChildren:
      `project = ${projectKey} AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability) AND ${compOuter} AND "Epic link" is not EMPTY AND status not in (Closed, Cancelled)`,

    // Standalone epics with no parent link
    standaloneEpics:
      `project = ${projectKey} AND issuetype = Epic AND ${compOuter} AND "Parent Link" is EMPTY AND status not in (Closed, Cancelled)`,

    // Children of standalone epics — same simple approach as epicChildren above
    standaloneEpicChildren:
      `project = ${projectKey} AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability) AND ${compOuter} AND "Epic link" is not EMPTY AND status not in (Closed, Cancelled)`,

    // Loose tickets with no epic link that carry the component
    directTickets:
      `project = ${projectKey} AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability) AND ${compOuter} AND "Epic link" is EMPTY AND status not in (Closed, Cancelled)`,
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
 * Fetch 6-part component payload in parallel.
 * runSearchByJql signature: (token, jql, maxResults)
 */
async function fetchComponentPayload(componentName, jiraToken) {
  const q = buildComponentPayloadJQL(componentName);
  console.log('[componentReportService] Fetching payload for component:', componentName);

  const [r0, r1, r2, r3, r4, r5] = await Promise.all([
    safeJqlSearch(jiraToken, q.topLevelProjects, 100, 'topLevelProjects'),
    safeJqlSearch(jiraToken, q.portfolioChildren, 100, 'portfolioChildren'),
    safeJqlSearch(jiraToken, q.epicChildren, 500, 'epicChildren'),
    safeJqlSearch(jiraToken, q.standaloneEpics, 100, 'standaloneEpics'),
    safeJqlSearch(jiraToken, q.standaloneEpicChildren, 500, 'standaloneEpicChildren'),
    safeJqlSearch(jiraToken, q.directTickets, 500, 'directTickets'),
  ]);

  return {
    topLevelProjects:       r0?.issues || [],
    portfolioChildren:      r1?.issues || [],
    epicChildren:           r2?.issues || [],
    standaloneEpics:        r3?.issues || [],
    standaloneEpicChildren: r4?.issues || [],
    directTickets:          r5?.issues || [],
  };
}

module.exports = {
  fetchComponentsFromERA,
  buildComponentPayloadJQL,
  fetchComponentPayload,
};
