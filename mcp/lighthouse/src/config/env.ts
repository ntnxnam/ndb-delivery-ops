/**
 * MCP host env — thin adapter over shared `loadEnv()`.
 *
 * JIRA auth is Data Center PAT only (`Authorization: Bearer`). The PAT
 * comes from the host's mcp.json `env` block (`JIRA_PAT` or `JIRA_TOKEN`).
 */

import { loadEnv as loadSharedEnv, type Env } from '@portfolio-delivery-ops/shared';

export type { Env };

export function loadEnv(): Env {
  try {
    return loadSharedEnv({ requirePat: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/JIRA_PAT|JIRA_TOKEN/.test(message)) {
      throw new Error(
        'JIRA_PAT (or JIRA_TOKEN) is required. Set a JIRA Data Center PAT in your mcp.json `env` block.'
      );
    }
    throw err;
  }
}
