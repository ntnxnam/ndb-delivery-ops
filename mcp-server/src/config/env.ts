/**
 * Environment + configuration for the NDB-Ops MCP server.
 *
 * The server is process-spawned by the host (Cursor, Claude Desktop) over
 * stdio, so environment variables come from whatever the host injects via
 * `env` in its mcp.json. We keep the surface small and explicit:
 *
 *   JIRA_BASE_URL         e.g. https://jira.nutanix.com  (no trailing slash)
 *   JIRA_PAT              required — JIRA Personal Access Token
 *   JIRA_TIMEOUT_MS       optional, default 30000
 *   HTTPS_PROXY           optional — passthrough for corporate proxies
 *   NDB_DEFAULT_TEAM_ID   optional — defaults the team scope when omitted
 *
 * Missing-PAT is fatal: tools that need JIRA can't function without it, and
 * a noisy startup error is much better than per-tool 401s the LLM has to
 * puzzle through.
 */

export type Env = {
  jiraBaseUrl: string;
  jiraPat: string;
  jiraTimeoutMs: number;
  httpsProxy: string | null;
  defaultTeamId: string | null;
};

const DEFAULT_BASE_URL = 'https://jira.nutanix.com';
const DEFAULT_TIMEOUT_MS = 30000;

export function loadEnv(): Env {
  const jiraBaseUrl = (process.env.JIRA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const jiraPat = process.env.JIRA_PAT || process.env.JIRA_TOKEN || '';
  if (!jiraPat) {
    throw new Error(
      'JIRA_PAT (or JIRA_TOKEN) is required. Set it in your mcp.json `env` block.'
    );
  }
  const jiraTimeoutMs = Number(process.env.JIRA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || null;
  const defaultTeamId = process.env.NDB_DEFAULT_TEAM_ID || null;
  return { jiraBaseUrl, jiraPat, jiraTimeoutMs, httpsProxy, defaultTeamId };
}
