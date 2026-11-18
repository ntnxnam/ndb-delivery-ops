/**
 * Client-side JQL query utilities
 * Shared functions for building JIRA queries
 */

/**
 * Build JQL query for task breakdown (outstanding tickets for a specific JIRA key)
 * @param {string} jiraKey - JIRA issue key (e.g., "FEAT-18162") 
 * @returns {string} JQL query string for finding all related outstanding work
 */
export function buildTaskBreakdownJQL(jiraKey) {
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
    // eslint-disable-next-line no-useless-escape
    `issueFunction in subtasksOf("issueFunction in issuesInEpics('issueFunction in portfolioChildrenOf(\\\"key=${jiraKey}\\\")')")`,
    `issueFunction in linkedIssuesOf("key=${jiraKey}")`
  ];
  
  const baseQuery = `(${conditions.join(' OR ')})`;
  return `${issueTypeExclusion} AND ${baseQuery} AND ${statusExclusion}`;
}