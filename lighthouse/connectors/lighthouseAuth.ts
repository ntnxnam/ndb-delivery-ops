import type { AuthProvider, AuthContext } from '../../../shared/src/connectors/auth.js';

// Per-user auth: session holds userId, memoryStore holds user PAT (injected per-request).
// Caller passes user-specific context; this is a factory, not a global.
export function lighthouseAuthProvider(session: { userId: string; pat?: string; jiraBaseUrl?: string }): AuthProvider {
  return () => ({
    jiraPat: session.pat || process.env.JIRA_PAT_FALLBACK || '',
    jiraBaseUrl: session.jiraBaseUrl || process.env.JIRA_BASE_URL || 'https://jira.nutanix.com',
    confluencePat: undefined,
    githubToken: undefined,
  });
}
