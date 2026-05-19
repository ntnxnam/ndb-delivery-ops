/**
 * Tool: calculate_story_points
 *
 * Roll up story points for a parent JIRA issue (Feature / Initiative /
 * X-FEAT / Epic) by walking its hierarchy and summing children.
 *
 * Replaces the standalone ~/ndb-story-point-calculator/ web app — that
 * app did the same JIRA walk plus its own UI; the UI moves into
 * apps/delivery-ops/ (where it can re-use this tool via the in-process
 * API), and the *calculation* lives here so any MCP client can call it.
 *
 * Uses two JIRA conventions:
 *   - customfield_10002 — Story Points (Nutanix JIRA Server, standard)
 *   - portfolioChildrenOf("issue = KEY") — Portfolio for JIRA hierarchy
 *     traversal; same primitive the release-analysis service uses
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JiraConnector } from '../connectors/jiraConnector.js';
import type { Env } from '../config/env.js';

const STORY_POINT_FIELD = 'customfield_10002';
const FIELDS = ['key', 'summary', 'issuetype', 'status', STORY_POINT_FIELD].join(',');

const inputSchema = {
  parentKey: z.string()
    .describe('JIRA key of the parent (Feature, Initiative, X-FEAT, Capability, or Epic). Story points are summed across all descendants.'),
  includeDone: z.boolean().optional().default(true)
    .describe('Include items in Done status. Default true — committed vs. delivered comparisons need both.'),
  excludeIssueTypes: z.array(z.string()).optional()
    .describe('Issue types to exclude from the sum (e.g. ["Sub-task"]). Empty by default.'),
};

export function registerCalculateStoryPoints(server: McpServer, env: Env): void {
  const jira = new JiraConnector(env);

  server.registerTool(
    'calculate_story_points',
    {
      title: 'Calculate Story Points',
      description: 'Sum story points across every descendant of a Feature / Initiative / X-FEAT / Epic. Returns committed vs. delivered (Done) totals plus per-issue-type breakdown. Use when the user asks "how many points in FEAT-X?", "what is the size of this initiative?", or wants a parent-level rollup.',
      inputSchema,
      annotations: {
        title: 'Story-Point Rollup',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ parentKey, includeDone, excludeIssueTypes }) => {
      try {
        // Use portfolioChildrenOf (same primitive the release-analysis service uses)
        // for the hierarchy walk; falls back to issuesInEpics for Epic-only parents
        // — JQL function picks the right behaviour by parent type.
        const excludeClause = excludeIssueTypes && excludeIssueTypes.length > 0
          ? ` AND issuetype not in (${excludeIssueTypes.map(t => `"${t}"`).join(',')})`
          : '';
        const doneClause = includeDone ? '' : ' AND statusCategory != Done';
        const jql = `(issuefunction in portfolioChildrenOf("issue = ${parentKey}") OR issueFunction in issuesInEpics("issue = ${parentKey}") OR parent = ${parentKey})${excludeClause}${doneClause}`;

        const issues = await jira.searchAll(jql, FIELDS);

        let totalCommitted = 0;
        let totalDelivered = 0;
        const byType: Record<string, { committed: number; delivered: number; count: number }> = {};

        for (const issue of issues) {
          const f = (issue.fields ?? {}) as Record<string, unknown>;
          const sp = typeof f[STORY_POINT_FIELD] === 'number' ? (f[STORY_POINT_FIELD] as number) : 0;
          const type = ((f['issuetype'] as { name?: string } | undefined)?.name) ?? 'Unknown';
          const isDone = ((f['status'] as { statusCategory?: { name?: string } } | undefined)?.statusCategory?.name) === 'Done';

          totalCommitted += sp;
          if (isDone) totalDelivered += sp;

          if (!byType[type]) byType[type] = { committed: 0, delivered: 0, count: 0 };
          byType[type].committed += sp;
          if (isDone) byType[type].delivered += sp;
          byType[type].count += 1;
        }

        const completionPct = totalCommitted > 0 ? Math.round((totalDelivered / totalCommitted) * 100) : 0;

        const lines: string[] = [];
        lines.push(`# Story Points — ${parentKey}`);
        lines.push('');
        lines.push(`**Committed**: ${totalCommitted}  •  **Delivered**: ${totalDelivered}  •  **Completion**: ${completionPct}%  •  **Items**: ${issues.length}`);
        lines.push('');
        lines.push('| Issue Type | Items | Committed SP | Delivered SP |');
        lines.push('|---|---:|---:|---:|');
        for (const [type, stats] of Object.entries(byType).sort((a, b) => b[1].committed - a[1].committed)) {
          lines.push(`| ${type} | ${stats.count} | ${stats.committed} | ${stats.delivered} |`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: {
            parentKey,
            totalCommitted,
            totalDelivered,
            completionPct,
            itemCount: issues.length,
            byIssueType: byType,
          },
        };
      } catch (err) {
        const wrapped = JiraConnector.wrapError(err, 'Failed to calculate story points');
        return {
          content: [{ type: 'text', text: `JIRA error (${wrapped.statusCode}): ${wrapped.message}` }],
          isError: true,
        };
      }
    }
  );
}
