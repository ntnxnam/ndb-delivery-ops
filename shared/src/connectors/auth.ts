export interface AuthContext {
  jiraPat: string;
  jiraBaseUrl?: string;
  confluencePat?: string;
  confluenceBaseUrl?: string;
  githubToken?: string;
}

export type AuthProvider = () => Promise<AuthContext> | AuthContext;

export function loomAuthProvider(): AuthProvider {
  return () => ({
    jiraPat: process.env.JIRA_PAT || process.env.JIRA_TOKEN || '',
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://jira.nutanix.com',
    confluencePat: process.env.CONFLUENCE_PAT || process.env.JIRA_PAT || undefined,
    confluenceBaseUrl: process.env.CONFLUENCE_BASE_URL || undefined,
    githubToken: process.env.GITHUB_TOKEN || undefined,
  });
}
