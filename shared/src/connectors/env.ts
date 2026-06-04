/**
 * Environment + configuration for shared connectors.
 *
 * Shared between mcp-server and apps/delivery-ops/server. Each runtime
 * loads env once and passes the resulting object to connector
 * constructors.
 *
 * Per `no-localhost.mdc`, NO defaults that reference localhost in
 * production code.
 */

export interface Env {
  /** e.g. https://jira.nutanix.com (no trailing slash). Required. */
  jiraBaseUrl: string;
  /** JIRA Personal Access Token. Required. */
  jiraPat: string;
  /** Per-request timeout in milliseconds. Default 30s. */
  jiraTimeoutMs: number;
  /** Optional HTTPS proxy URL for corporate environments. */
  httpsProxy: string | null;
  /** Confluence base URL. Optional until Phase D2 (Confluence connector). */
  confluenceBaseUrl?: string;
  /** Confluence PAT — may reuse the JIRA PAT if Atlassian SSO. */
  confluencePat?: string;
  /** Default product id when caller omits it (typical: 'ndb'). */
  defaultProductId: string | null;
}

const DEFAULT_BASE_URL = 'https://jira.nutanix.com';
const DEFAULT_TIMEOUT_MS = 30000;

export interface LoadEnvOptions {
  /**
   * Throw when no JIRA PAT is found in the process environment.
   *
   * Default: `true` (backward compatible with mcp-server and any other
   * batch-process caller where the PAT must be set at boot).
   *
   * HTTP server routes that accept a per-user PAT in the request should
   * pass `false` — they intend to override `jiraPat` after `loadEnv()`
   * returns, and don't want the env-level check to fail when no
   * process-wide PAT exists.
   */
  requirePat?: boolean;
}

export function loadEnv(options?: LoadEnvOptions): Env {
  const requirePat = options?.requirePat ?? true;
  const jiraBaseUrl = (process.env.JIRA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const jiraPat = process.env.JIRA_PAT || process.env.JIRA_TOKEN || '';
  if (requirePat && !jiraPat) {
    throw new Error(
      'JIRA_PAT (or JIRA_TOKEN) is required. Set it in your environment, ' +
        'or call loadEnv({ requirePat: false }) when overriding per-request.'
    );
  }
  const jiraTimeoutMs = Number(process.env.JIRA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const httpsProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null;
  const confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL
    ? process.env.CONFLUENCE_BASE_URL.replace(/\/+$/, '')
    : undefined;
  const confluencePat = process.env.CONFLUENCE_PAT || jiraPat || undefined;
  const defaultProductId =
    process.env.DEFAULT_PRODUCT_ID ||
    process.env.NDB_DEFAULT_TEAM_ID || // legacy
    null;
  return {
    jiraBaseUrl,
    jiraPat,
    jiraTimeoutMs,
    httpsProxy,
    confluenceBaseUrl,
    confluencePat,
    defaultProductId,
  };
}
