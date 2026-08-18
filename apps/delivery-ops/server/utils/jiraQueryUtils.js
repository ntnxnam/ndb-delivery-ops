/**
 * Shared JQL query utilities for release version endpoints
 * Single source of truth for query logic
 */

/**
 * Build JQL query for commit items
 * @param {string} fixVersion - Release version (e.g., "NDB-2.11")
 * @param {Object} teamConfig - Team configuration object (optional, not used in current implementation)
 * @returns {string} JQL query string - fixVersion="..." AND issuetype in (Feature, Initiative) AND status != Cancelled AND (labels is EMPTY OR labels != "ndb-not-por")
 */
function buildCommitItemsJQL(fixVersion, teamConfig = null) {
  // Updated to use the correct query logic as specified
  const baseJQL = `fixVersion = "${fixVersion}" AND issuetype in (Feature, Initiative) AND status != Cancelled AND labels not in ("ndb-not-por")`;
  
  return baseJQL;
}

/**
 * Build JQL query for long-term funded items
 * @param {string} fixVersion - Release version (e.g., "NDB-2.11")
 * @param {Object} teamConfig - Team configuration object (optional, not used in current implementation)
 * @returns {string} JQL query string - labels="ndb-2.11-long-term-funded" AND issuetype in (Feature, Initiative) AND status != Cancelled
 */
function buildLongTermItemsJQL(fixVersion, teamConfig = null) {
  const versionLabel = fixVersion.toLowerCase();
  const baseJQL = `labels = "${versionLabel}-long-term-funded" AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`;
  
  return baseJQL;
}

/**
 * Build JQL query for extension label items scoped to a specific fix version label pattern
 * @param {string} fixVersion - Release version (e.g., "NDB-2.11")
 * @param {Object} teamConfig - Team configuration object (optional, not used in current implementation)
 * @returns {string} JQL query string - labels="ndb-2.11-code-complete-extention-recieved" AND issuetype in (Feature, Initiative) AND status != Cancelled
 */
function buildExtensionItemsJQL(fixVersion, teamConfig = null) {
  const versionLabel = fixVersion.toLowerCase();
  const baseJQL = `labels = "${versionLabel}-code-complete-extention-recieved" AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`;
  
  return baseJQL;
}

/**
 * Get all item keys for a release version (commit + long-term + extensions)
 * @param {string} fixVersion - Release version
 * @param {string} token - JIRA token
 * @param {Function} fetchIssuesWithJQL - Function to fetch issues with JQL
 * @param {Object} teamConfig - Team configuration object (optional)
 * @returns {Promise<string[]>} Array of JIRA issue keys
 */
async function getAllItemKeysForVersion(fixVersion, token, fetchIssuesWithJQL, teamConfig = null) {
  // Run all three JQL queries in parallel
  const [commitIssues, longTermIssues, extensionIssues] = await Promise.all([
    fetchIssuesWithJQL(buildCommitItemsJQL(fixVersion, teamConfig), 'key'),
    fetchIssuesWithJQL(buildLongTermItemsJQL(fixVersion, teamConfig), 'key'),
    fetchIssuesWithJQL(buildExtensionItemsJQL(fixVersion, teamConfig), 'key')
  ]);

  console.log(`[JiraQueryUtils] Fetched ${commitIssues.length} commit, ${longTermIssues.length} long-term, ${extensionIssues.length} extension items`);

  // Combine and deduplicate
  const allKeysSet = new Set();
  commitIssues.forEach(issue => allKeysSet.add(issue.key));
  longTermIssues.forEach(issue => allKeysSet.add(issue.key));
  extensionIssues.forEach(issue => allKeysSet.add(issue.key));

  const itemKeys = Array.from(allKeysSet);
  console.log(`[JiraQueryUtils] Total unique keys: ${itemKeys.length}`);

  return itemKeys;
}

/**
 * Build JQL query for task breakdown (outstanding tickets for a specific JIRA key)
 * @param {string} jiraKey - JIRA issue key (e.g., "FEAT-18162")
 * @returns {string} JQL query string for finding all related outstanding work
 */
function buildTaskBreakdownJQL(jiraKey) {
  const issueTypeExclusion = 'issuetype NOT IN ("Feature", "Initiative", "X-FEAT", "Capability", "Epic")';
  const statusExclusion = 'status NOT IN ("Done", "Closed")';
  
  // Comprehensive conditions to find all related work (matches backend breakdown logic)
  const conditions = [
    `key = ${jiraKey}`,
    `"Parent Link" = ${jiraKey}`,
    `"FEAT ID" ~ ${jiraKey}`,
    `"FEAT Number" = ${jiraKey}`,
    `issueFunction in portfolioChildrenOf("key=${jiraKey}")`,
    `issueFunction in subtasksOf("key=${jiraKey}")`,
    `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key=${jiraKey}')")`,
    `issueFunction in subtasksOf("issueFunction in issuesInEpics('issueFunction in portfolioChildrenOf(\\\"key=${jiraKey}\\\")')")`,
    `issueFunction in linkedIssuesOf("key=${jiraKey}")`
  ];
  
  const baseQuery = `(${conditions.join(' OR ')})`;
  return `${issueTypeExclusion} AND ${baseQuery} AND ${statusExclusion}`;
}

/**
 * Build JQL for all related tickets including Done - no status exclusion
 * Used for total count calculation
 * @param {string} jiraKey - JIRA issue key (e.g., "FEAT-18162")
 * @returns {string} JQL query string for finding all related work (including completed)
 */
function buildAllTicketsJQL(jiraKey) {
  const issueTypeExclusion = 'issuetype NOT IN ("Feature", "Initiative", "X-FEAT", "Capability", "Epic")';
  
  // Same comprehensive conditions but without status exclusion
  const conditions = [
    `key = ${jiraKey}`,
    `"Parent Link" = ${jiraKey}`,
    `"FEAT ID" ~ ${jiraKey}`,
    `"FEAT Number" = ${jiraKey}`,
    `issueFunction in portfolioChildrenOf("key=${jiraKey}")`,
    `issueFunction in subtasksOf("key=${jiraKey}")`,
    `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key=${jiraKey}')")`,
    `issueFunction in subtasksOf("issueFunction in issuesInEpics('issueFunction in portfolioChildrenOf(\\\"key=${jiraKey}\\\")')")`,
    `issueFunction in linkedIssuesOf("key=${jiraKey}")`
  ];
  
  const baseQuery = `(${conditions.join(' OR ')})`;
  return `${issueTypeExclusion} AND ${baseQuery}`;
}

/**
 * Build a JQL query for fetching tickets across one or more "project" parent
 * items. Walks portfolio children, sub-tasks, linked issues, and FEAT-id
 * relationships so the returned set covers everything under the parent(s).
 *
 * For a single project, delegates to buildAllTicketsJQL (which keeps Done/Closed
 * for accurate counts). For multiple projects, builds a union with status
 * filtering removed so velocity/completion math has the full picture.
 *
 * @param {string[]} projectKeys - one or more JIRA item keys (typically X-FEAT or Feature)
 * @returns {string} JQL
 */
function buildOptimizedProjectTicketsJQL(projectKeys) {
  if (!projectKeys || projectKeys.length === 0) {
    throw new Error('At least one project key is required');
  }

  const excludedIssueTypes = ['Feature', 'Initiative', 'X-FEAT', 'Capability', 'Epic'];
  const issueTypeExclusion = `issuetype NOT IN (${excludedIssueTypes.map(t => `"${t}"`).join(', ')})`;

  if (projectKeys.length === 1) {
    return buildAllTicketsJQL(projectKeys[0]);
  }

  const keyList = projectKeys.map(key => `"${key}"`).join(', ');
  const featIdClauses = projectKeys.map(key => `"FEAT ID" ~ ${key}`).join(' OR ');
  const linkedIssuesClauses = projectKeys.map(key => `issueFunction in linkedIssuesOf("key=${key}")`).join(' OR ');

  const conditions = [
    `key IN (${keyList})`,
    `"Parent Link" IN (${keyList})`,
    `(${featIdClauses})`,
    `"FEAT Number" IN (${keyList})`,
    `issueFunction in portfolioChildrenOf("key IN (${keyList})")`,
    `issueFunction in subtasksOf("key IN (${keyList})")`,
    `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key IN (${keyList})')")`,
    `issueFunction in subtasksOf("issueFunction in issuesInEpics('issueFunction in portfolioChildrenOf(\\'key IN (${keyList})\\')')")`,
    `(${linkedIssuesClauses})`
  ];

  const baseQuery = `(${conditions.join(' OR ')})`;
  return `${issueTypeExclusion} AND ${baseQuery}`;
}

/**
 * Build a JQL query for a sprint report: tickets in the given sprint, scoped
 * to the team's sprintBaseFilter (which intentionally does NOT exclude
 * resolved/closed issues — sprint reports must count completed work).
 *
 * @param {number|string} sprintId
 * @param {string} teamId - resolved via teamConfig.getTeamSprintBaseFilter
 * @param {{ componentNames?: string[] }} [options]
 * @returns {string} JQL
 */
function buildSprintReportJql(sprintId, teamId, options) {
  // Lazy require to avoid a circular dep — teamConfig.js does not import from here.
  const { getTeamSprintBaseFilter } = require('./teamConfig');
  const sprintBaseFilter = getTeamSprintBaseFilter(teamId);
  const sprintClause = `Sprint = ${sprintId}`;
  let jql = !sprintBaseFilter ? sprintClause : `(${sprintBaseFilter}) AND (${sprintClause})`;
  const componentNames = options && Array.isArray(options.componentNames)
    ? options.componentNames.filter(Boolean)
    : [];
  if (componentNames.length > 0) {
    const escaped = componentNames.map(name => `"${String(name).replace(/"/g, '\\"')}"`);
    jql += ` AND component in (${escaped.join(', ')})`;
  }
  return jql;
}

module.exports = {
  buildCommitItemsJQL,
  buildLongTermItemsJQL,
  buildExtensionItemsJQL,
  buildTaskBreakdownJQL,
  buildAllTicketsJQL,
  getAllItemKeysForVersion,
  buildOptimizedProjectTicketsJQL,
  buildSprintReportJql,
};

