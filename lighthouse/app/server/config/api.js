const jiraConfig = require('./jiraConfig.json');
const confluenceConfig = require('./confluenceConfig.json');

// Helper function to normalize JIRA base URL (remove trailing slash)
function normalizeJiraBaseUrl(url) {
  if (!url) return 'https://jira.nutanix.com';
  return url.replace(/\/+$/, ''); // Remove trailing slashes
}

// Helper function to normalize Confluence base URL (remove trailing slash)
function normalizeConfluenceBaseUrl(url) {
  if (!url) return 'https://confluence.eng.nutanix.com:8443';
  return url.replace(/\/+$/, ''); // Remove trailing slashes
}

// Fixed base URLs
const JIRA_BASE_URL = normalizeJiraBaseUrl(jiraConfig.baseUrl);
const CONFLUENCE_BASE_URL = normalizeConfluenceBaseUrl(confluenceConfig.baseUrl);

// JIRA API v2 endpoints
const JIRA_API_V2 = {
  BASE_URL: JIRA_BASE_URL,
  MYSELF: `${JIRA_BASE_URL}/rest/api/2/myself`,
  SERVER_INFO: `${JIRA_BASE_URL}/rest/api/2/serverInfo`,
  ISSUE: (key) => `${JIRA_BASE_URL}/rest/api/2/issue/${key}`,
  SEARCH: `${JIRA_BASE_URL}/rest/api/2/search`,
  FIELD: `${JIRA_BASE_URL}/rest/api/2/field`,
  FILTER: (id) => `${JIRA_BASE_URL}/rest/api/2/filter/${id}`,
  FILTER_SEARCH: `${JIRA_BASE_URL}/rest/api/2/filter/search`,
  CREATE_FILTER: `${JIRA_BASE_URL}/rest/api/2/filter`,
  PROJECT_VERSIONS: (projectKey) => `${JIRA_BASE_URL}/rest/api/2/project/${projectKey}/versions`,
  PROJECT: (projectKey) => `${JIRA_BASE_URL}/rest/api/2/project/${projectKey}`,
  CREATE_VERSION: `${JIRA_BASE_URL}/rest/api/2/version`,
  VERSION: (id) => `${JIRA_BASE_URL}/rest/api/2/version/${id}`
};

// JIRA Agile (board/sprint) - same auth as API v2
const JIRA_AGILE = {
  BASE_URL: JIRA_BASE_URL,
  BOARD_SPRINTS: (boardId) => `${JIRA_BASE_URL}/rest/agile/1.0/board/${boardId}/sprint`,
  SPRINT_ISSUES: (sprintId) => `${JIRA_BASE_URL}/rest/agile/1.0/sprint/${sprintId}/issue`
};

// Confluence API endpoints
const CONFLUENCE_API = {
  BASE_URL: CONFLUENCE_BASE_URL,
  USER_CURRENT: `${CONFLUENCE_BASE_URL}/rest/api/user/current`,
  USER: `${CONFLUENCE_BASE_URL}/rest/api/user`,
  CONTENT: `${CONFLUENCE_BASE_URL}/rest/api/content`
};

module.exports = {
  JIRA_BASE_URL,
  CONFLUENCE_BASE_URL,
  JIRA_API_V2,
  JIRA_AGILE,
  CONFLUENCE_API,
  normalizeJiraBaseUrl,
  normalizeConfluenceBaseUrl
};

