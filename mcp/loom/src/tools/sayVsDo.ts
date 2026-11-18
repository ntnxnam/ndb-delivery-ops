/**
 * Tool: say_vs_do
 *
 * For a release version, compare what we *committed* (planned story
 * points) against what we *delivered* (resolved story points). The
 * canonical Nutanix team-exec-level metric for release predictability.
 *
 * Replaces the standalone ~/ndb-say-vs-do/ Node app, which combined the
 * JIRA aggregation with its own React UI. We move the aggregation here;
 * the UI lives in apps/delivery-ops/ (already has a release-trends
 * view that can call this tool).
 *
 * For accurate Say-vs-Do we need both populations:
 *   "Said"  = items that had this fixVersion at commit gate
 *             (proxy: items currently in fixVersion + items that were
 *              moved out — we use the *current* set as the simplest
 *              first cut; a faithful port would also read the
 *              fixVersions change history)
 *   "Did"   = subset of "Said" that resolved before the release date
 *
 * This first port returns "current fixVersion" Say vs. Do; the
 * change-history-based version is queued as a follow-up.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JiraConnector } from '@portfolio-delivery-ops/shared';
import type { Env } from '../config/env.js';

const STORY_POINT_FIELD = 'customfield_10002';
const FIELDS = [
  'key', 'issuetype', 'status', 'resolution', 'resolutiondate',
  STORY_POINT_FIELD, 'fixVersions',
].join(',');

const inputSchema = {
  version: z.string()
    .describe('JIRA fixVersion name, e.g. "NDB-2.11".'),
  issueTypes: z.array(z.string()).optional()
    .describe('Restrict to specific issue types. Defaults to ["Feature","Initiative","X-FEAT","Capability"] — team-exec-level units of commitment.'),
};

export function registerSayVsDo(server: McpServer, env: Env): void {
  const jira = new JiraConnector(env);

  server.registerTool(
    'say_vs_do',
    {
      title: 'Say vs Do (release predictability)',
      description: 'Committed vs delivered story points for a release. Returns SP_said, SP_did, completion %, plus a per-issue-type breakdown. Use when the user asks "say vs do for NDB-2.x", "how predictable was this release", "what % did we deliver".',
      inputSchema,
      annotations: {
        title: 'Say vs Do',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ version, issueTypes }) => {
      try {
        const types = issueTypes && issueTypes.length > 0
          ? issueTypes
          : ['Feature', 'Initiative', 'X-FEAT', 'Capability'];
        const typeClause = types.map(t => `"${t}"`).join(',');

        const jql = `fixVersion = "${version}" AND issuetype in (${typeClause}) AND status not in (Cancelled, Backlog)`;
        const issues = await jira.searchAll(jql, FIELDS);

        let said = 0;
        let did = 0;
        const byType: Record<string, { said: number; did: number; count: number }> = {};

        for (const issue of issues) {
          const f = (issue.fields ?? {}) as Record<string, unknown>;
          const sp = typeof f[STORY_POINT_FIELD] === 'number' ? (f[STORY_POINT_FIELD] as number) : 0;
          const type = (f['issuetype'] as { name?: string } | undefined)?.name ?? 'Unknown';
          const done = ((f['status'] as { statusCategory?: { name?: string } } | undefined)?.statusCategory?.name) === 'Done';

          said += sp;
          if (done) did += sp;

          if (!byType[type]) byType[type] = { said: 0, did: 0, count: 0 };
          byType[type].said += sp;
          if (done) byType[type].did += sp;
          byType[type].count += 1;
        }

        const completionPct = said > 0 ? Math.round((did / said) * 100) : 0;

        const lines: string[] = [];
        lines.push(`# Say vs Do — ${version}`);
        lines.push('');
        lines.push(`**Said**: ${said} SP  •  **Did**: ${did} SP  •  **Predictability**: ${completionPct}%  •  **Items**: ${issues.length}`);
        lines.push('');
        lines.push('| Issue Type | Items | Said (SP) | Did (SP) | % |');
        lines.push('|---|---:|---:|---:|---:|');
        for (const [type, s] of Object.entries(byType).sort((a, b) => b[1].said - a[1].said)) {
          const pct = s.said > 0 ? Math.round((s.did / s.said) * 100) : 0;
          lines.push(`| ${type} | ${s.count} | ${s.said} | ${s.did} | ${pct}% |`);
        }
        lines.push('');
        lines.push('_Note: this first port uses **current** fixVersion membership. A faithful Say-vs-Do also accounts for items moved out of the version after commit gate — queued as a follow-up that reads fixVersion change history._');

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: {
            version,
            said,
            did,
            completionPct,
            itemCount: issues.length,
            byIssueType: byType,
            issueTypesUsed: types,
          },
        };
      } catch (err) {
        const wrapped = JiraConnector.wrapError(err, 'Failed to compute Say vs Do');
        return {
          content: [{ type: 'text', text: `JIRA error (${wrapped.statusCode}): ${wrapped.message}` }],
          isError: true,
        };
      }
    }
  );
}
