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

// ── Velocity / burndown helpers ────────────────────────────────────────────

/**
 * Paginated JIRA search fetching only specific fields.
 * Returns an array of issue.fields objects.
 */
async function paginatedJqlFetch(jql, fields, jiraToken, maxIssues = 5000) {
  const httpsAgent = createHttpsAgent();
  const allFields = [];
  let startAt = 0;
  const pageSize = 100;

  while (allFields.length < maxIssues) {
    let response;
    try {
      response = await axios.get(JIRA_API_V2.SEARCH, {
        headers: {
          Authorization: `Bearer ${jiraToken.trim()}`,
          Accept: 'application/json',
        },
        params: { jql, fields, maxResults: pageSize, startAt },
        httpsAgent,
        timeout: 30000,
      });
    } catch (err) {
      console.error('[componentReportService] paginatedJqlFetch error:', err.message, '| jql:', jql.substring(0, 100));
      break;
    }

    const data = response.data;
    const issues = data.issues || [];
    allFields.push(...issues.map(i => i.fields));
    startAt += issues.length;
    if (issues.length === 0 || startAt >= (data.total || 0)) break;
  }

  return allFields;
}

/** Return the Monday of the ISO week containing `date`. */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun … 6=Sat
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "Jan 06", "Mar 24" style label for a week-start date. */
function formatWeekLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Fetch weekly Created-vs-Resolved burndown for a component.
 *
 * New JQL (net-new — does not modify any existing query):
 *   created:  project=ERA AND (component="X" OR "Primary Component"="X") AND created >= "-Nd"
 *   resolved: same base, resolutiondate >= "-Nd"
 *
 * Returns: { weeks: string[], created: number[], resolved: number[] }
 */
async function fetchComponentVelocity(componentName, jiraToken, weeks = 52) {
  const projectKey = getProjectKey();
  const esc = componentName.replace(/"/g, '\\"');
  const compFilter = `(component = "${esc}" OR "Primary Component" = "${esc}")`;
  // Add a buffer week so partial current week is included without cutting off history
  const daysBack = weeks * 7 + 7;

  const jqlBase = `project = ${projectKey} AND ${compFilter}`;
  console.log('[componentReportService] Velocity fetch for:', componentName, `(${weeks} weeks, ${daysBack}d lookback)`);

  const [createdFields, resolvedFields] = await Promise.all([
    paginatedJqlFetch(
      `${jqlBase} AND created >= "-${daysBack}d" ORDER BY created ASC`,
      'created',
      jiraToken,
    ),
    paginatedJqlFetch(
      `${jqlBase} AND resolutiondate >= "-${daysBack}d" ORDER BY resolutiondate ASC`,
      'resolutiondate',
      jiraToken,
    ),
  ]);

  console.log('[componentReportService] Velocity raw counts — created:', createdFields.length, 'resolved:', resolvedFields.length);

  // Build Monday-aligned week slots from cutoff to now
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const cutoff = new Date(now.getTime() - daysBack * 86400000);

  const weekSlots = [];
  const cursor = getWeekStart(cutoff);
  while (cursor <= now) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekSlots.push({ start: weekStart, end: weekEnd, label: formatWeekLabel(weekStart) });
    cursor.setDate(cursor.getDate() + 7);
  }

  const countByWeek = (fieldsList, fieldName) =>
    weekSlots.map(slot =>
      fieldsList.filter(f => {
        const v = f[fieldName];
        if (!v) return false;
        const d = new Date(v);
        return d >= slot.start && d < slot.end;
      }).length
    );

  return {
    weeks: weekSlots.map(w => w.label),
    created: countByWeek(createdFields, 'created'),
    resolved: countByWeek(resolvedFields, 'resolutiondate'),
  };
}

module.exports = {
  fetchComponentsFromERA,
  buildComponentPayloadJQL,
  fetchComponentPayload,
  fetchComponentVelocity,
};
