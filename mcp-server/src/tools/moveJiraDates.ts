/**
 * Tool: move_jira_dates
 *
 * Bulk-update an NDB date field on a list of JIRA issues to a single new
 * ISO date. Replaces the standalone ~/ndb-date-mover/ utility.
 *
 * Destructive (writes to JIRA), so:
 *   - `annotations.destructiveHint = true`
 *   - `annotations.idempotentHint = true` (same input -> same JIRA state)
 *   - `dryRun: true` (default) returns the planned changes without writing
 *
 * Supports the four date fields we actually move in NDB-Ops practice:
 *   - duedate                 (Epic-level Due Date)
 *   - codeCompleteDate        (customfield_11067)
 *   - commitGateReadyDate     (customfield_35863)
 *   - promotionGateReadyDate  (customfield_35864)
 *
 * Per the nutanix-jira-date-hierarchy rule, the right field depends on
 * issue type — but we let the caller pick explicitly so this tool stays
 * a primitive. A higher-level workflow can resolve "the next gate" -> field.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JiraConnector } from '../connectors/jiraConnector.js';
import type { Env } from '../config/env.js';

const FIELD_MAP = {
  duedate: 'duedate',
  codeCompleteDate: 'customfield_11067',
  commitGateReadyDate: 'customfield_35863',
  promotionGateReadyDate: 'customfield_35864',
} as const;

type FieldAlias = keyof typeof FIELD_MAP;

const inputSchema = {
  issueKeys: z.array(z.string()).min(1).max(200)
    .describe('JIRA issue keys to update, e.g. ["FEAT-123", "ERA-456"]. Hard-capped at 200 to bound the blast radius.'),
  field: z.enum(['duedate', 'codeCompleteDate', 'commitGateReadyDate', 'promotionGateReadyDate'])
    .describe('Which NDB date field to set. Resolves to the right customfield_NNNNN per the NDB-Ops conventions.'),
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Target date in ISO YYYY-MM-DD. JIRA stores dates as date-only for these fields.'),
  dryRun: z.boolean().optional().default(true)
    .describe('When true (default), returns the planned PUTs but does NOT write to JIRA.'),
};

export function registerMoveJiraDates(server: McpServer, env: Env): void {
  const jira = new JiraConnector(env);

  server.registerTool(
    'move_jira_dates',
    {
      title: 'Move JIRA Dates (bulk)',
      description: 'Bulk-update one NDB date field on a list of JIRA issues. Defaults to dryRun=true so the LLM has to consciously flip the switch before writing. Use when the user says "move Code Complete to <date>", "slip the gate", "push out due dates", or similar.',
      inputSchema,
      annotations: {
        title: 'Move JIRA Dates',
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ issueKeys, field, newDate, dryRun }) => {
      const customField = FIELD_MAP[field as FieldAlias];
      const planned = issueKeys.map((key) => ({ key, field: customField, newValue: newDate }));

      if (dryRun) {
        return {
          content: [{
            type: 'text',
            text: `[dryRun] Would update ${planned.length} issues:\n` +
              planned.map(p => `  ${p.key}.${p.field} = ${p.newValue}`).join('\n') +
              '\n\nRe-call with `dryRun: false` to apply.',
          }],
          structuredContent: { dryRun: true, planned, applied: [], failed: [] },
        };
      }

      const applied: { key: string }[] = [];
      const failed: { key: string; reason: string }[] = [];

      // Sequential, not concurrent — we want predictable JIRA error attribution
      // and we're capped at 200 so latency is acceptable.
      for (const key of issueKeys) {
        try {
          await jira.put(`/rest/api/2/issue/${encodeURIComponent(key)}`, {
            fields: { [customField]: newDate },
          });
          applied.push({ key });
        } catch (err) {
          const wrapped = JiraConnector.wrapError(err, `Failed to update ${key}`);
          failed.push({ key, reason: `${wrapped.statusCode}: ${wrapped.message}` });
        }
      }

      const text = [
        `Applied ${applied.length}/${issueKeys.length}; failed ${failed.length}.`,
        failed.length ? `\nFailures:\n${failed.map(f => `  ${f.key}: ${f.reason}`).join('\n')}` : '',
      ].join('');

      return {
        content: [{ type: 'text', text }],
        structuredContent: { dryRun: false, planned, applied, failed },
        ...(failed.length === issueKeys.length ? { isError: true } : {}),
      };
    }
  );
}
