import type { AuthProvider, AuthContext } from '../../../shared/src/connectors/auth.js';

export const loomAuth: AuthProvider = () => ({
  jiraPat: process.env.JIRA_PAT || process.env.JIRA_TOKEN || '',
  jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://jira.nutanix.com',
  confluencePat: process.env.CONFLUENCE_PAT || process.env.JIRA_PAT || undefined,
  confluenceBaseUrl: process.env.CONFLUENCE_BASE_URL || undefined,
  githubToken: process.env.GITHUB_TOKEN || undefined,
});
