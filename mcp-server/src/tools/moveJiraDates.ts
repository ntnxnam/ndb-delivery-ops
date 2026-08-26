/**
 * Tool: move_jira_dates
 *
 * Thin MCP adapter over shared DateMoverService (D30). Express
 * (`POST /api/date-mover/move-gate-date`) and this tool are the same bus:
 * JiraConnector (Data Center Bearer PAT) + Confluence audit + mandatory reason.
 *
 * Destructive, so:
 *   - annotations.destructiveHint = true
 *   - dryRun defaults true
 *
 * Epic `duedate` is out of scope (D30 / move-gate-date skill). Gate fields
 * only, resolved via GATE_DATE_FIELD_ALIASES — do not duplicate customfield IDs here.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ConfluenceConnector,
  DateMoverService,
  GATE_DATE_FIELD_ALIASES,
  GATE_DATE_FIELDS,
  JiraConnector,
} from '@portfolio-delivery-ops/shared';
import type { Env } from '../config/env.js';

const GATE_FIELD_ALIAS = [
  'codeCompleteDate',
  'commitGateReadyDate',
  'promotionGateReadyDate',
] as const satisfies ReadonlyArray<keyof typeof GATE_DATE_FIELD_ALIASES>;

const inputSchema = {
  issueKeys: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe('JIRA issue keys to update. Capped at 20; each key is one audited DateMoverService call.'),
  field: z
    .enum(GATE_FIELD_ALIAS)
    .describe('Gate date to set. codeCompleteDate / commitGateReadyDate / promotionGateReadyDate.'),
  newDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Target date in ISO YYYY-MM-DD.'),
  reason: z
    .string()
    .min(1)
    .describe('Mandatory justification (D30). Empty / n/a is rejected by the service.'),
  audit: z
    .object({
      confluencePageId: z.string().min(1),
      tableAnchorId: z.string().min(1),
    })
    .describe('Confluence audit table (D30 / D31). Required even on dryRun so the preview names the destination.'),
  actor: z
    .object({
      displayName: z.string().min(1),
      ldap: z.string().min(1),
    })
    .optional()
    .describe('Who is moving the date. Required when dryRun is false (audit row).'),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe('When true (default), returns the planned moves without writing.'),
};

export function registerMoveJiraDates(server: McpServer, env: Env): void {
  const jira = new JiraConnector(env);

  server.registerTool(
    'move_jira_dates',
    {
      title: 'Move JIRA Gate Dates',
      description:
        'Move Code Complete / Commit Gate / Promotion Gate on FEAT-tier tickets with a mandatory reason and Confluence audit. Same DateMoverService as the web API. Defaults to dryRun=true. Data Center PAT Bearer auth only.',
      inputSchema,
      annotations: {
        title: 'Move JIRA Gate Dates',
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ issueKeys, field, newDate, reason, audit, actor, dryRun }) => {
      const fieldId = GATE_DATE_FIELD_ALIASES[field];
      const fieldLabel = GATE_DATE_FIELDS[fieldId];
      const planned = issueKeys.map((key) => ({
        key,
        field: fieldId,
        fieldLabel,
        newValue: newDate,
        auditPageId: audit.confluencePageId,
        tableAnchorId: audit.tableAnchorId,
      }));

      if (dryRun !== false) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `[dryRun] Would update ${planned.length} issue(s) via DateMoverService:\n` +
                planned.map((p) => `  ${p.key}.${p.field} (${p.fieldLabel}) = ${p.newValue}`).join('\n') +
                `\nReason: ${reason.trim()}\nAudit: page ${audit.confluencePageId} #${audit.tableAnchorId}` +
                `\nActor: ${actor ? `${actor.displayName} (${actor.ldap})` : '(required when dryRun=false)'}` +
                `\n\nRe-call with dryRun: false and actor to apply.`,
            },
          ],
          structuredContent: { dryRun: true, planned, applied: [], failed: [] },
        };
      }

      if (!actor) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'actor.displayName and actor.ldap are required when dryRun is false (Confluence audit row).',
            },
          ],
          isError: true,
          structuredContent: { dryRun: false, planned, applied: [], failed: [] },
        };
      }

      if (!env.confluenceBaseUrl) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'CONFLUENCE_BASE_URL must be set on the MCP host to apply gate-date moves (D30 audit).',
            },
          ],
          isError: true,
          structuredContent: { dryRun: false, planned, applied: [], failed: [] },
        };
      }

      const confluence = new ConfluenceConnector(env);
      const service = new DateMoverService({
        jira,
        confluence,
        jiraBaseUrl: env.jiraBaseUrl,
      });

      const applied: Array<{ key: string; auditPageId?: string }> = [];
      const failed: Array<{ key: string; reason: string; code?: string }> = [];

      for (const key of issueKeys) {
        const result = await service.moveGateDate({
          ticketKey: key,
          fieldId,
          newDate,
          reason,
          actor,
          audit: {
            confluencePageId: audit.confluencePageId,
            tableAnchorId: audit.tableAnchorId,
          },
        });
        if (result.ok) {
          applied.push({ key, auditPageId: result.audit.pageId });
        } else {
          failed.push({
            key,
            reason: result.message,
            code: result.code,
          });
        }
      }

      const text = [
        `Applied ${applied.length}/${issueKeys.length}; failed ${failed.length}.`,
        failed.length
          ? `\nFailures:\n${failed.map((f) => `  ${f.key}: ${f.code || ''} ${f.reason}`).join('\n')}`
          : '',
      ].join('');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { dryRun: false, planned, applied, failed },
        ...(failed.length === issueKeys.length ? { isError: true } : {}),
      };
    }
  );
}
