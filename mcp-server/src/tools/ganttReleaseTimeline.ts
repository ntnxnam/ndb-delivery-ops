/**
 * Tool: gantt_release_timeline
 *
 * Returns Gantt-ready timeline data for an NDB release: one row per
 * Feature/Initiative/X-FEAT with start, end, and per-row status.
 *
 * Replaces ~/Release-Timelines-Visualizer/ — that was a React + Vite
 * client-only viewer with no backend. We move the *data shaping* here
 * (so the data is callable from any MCP client + can drive multiple
 * UIs) and the rendering stays in apps/delivery-ops/ (which already
 * has a ReleaseVersionGantt component the data can drive directly).
 *
 * Date resolution follows the nutanix-jira-date-hierarchy rule:
 *
 *   - Feature / Initiative / X-FEAT / Capability:
 *       start = customfield_11069 (Start Date) if present, else null
 *       end   = first non-null of:
 *                 customfield_11067 (Code Complete Date)
 *                 customfield_35863 (Commit Gate Ready Estimation)
 *                 customfield_35864 (Promotion Gate Ready Estimation)
 *   - Epic:
 *       start = customfield_11069 if present, else null
 *       end   = duedate
 *
 * Everything-else is excluded from the top-level Gantt; a more detailed
 * sprint-level breakdown is the job of a separate tool (planned).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JiraConnector } from '../connectors/jiraConnector.js';
import type { Env } from '../config/env.js';

const START_DATE_FIELD = 'customfield_11069';
const CODE_COMPLETE_FIELD = 'customfield_11067';
const COMMIT_GATE_FIELD = 'customfield_35863';
const PROMOTION_GATE_FIELD = 'customfield_35864';

const FIELDS = [
  'key', 'summary', 'issuetype', 'status', 'priority', 'assignee',
  'duedate', 'customfield_23560',
  START_DATE_FIELD, CODE_COMPLETE_FIELD, COMMIT_GATE_FIELD, PROMOTION_GATE_FIELD,
].join(',');

const inputSchema = {
  version: z.string()
    .describe('JIRA fixVersion name, e.g. "NDB-2.11".'),
  includeEpics: z.boolean().optional().default(false)
    .describe('Also include Epic rows. Default false — top-level Gantt is Features+Initiatives only.'),
  fallbackStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Optional ISO date to use as start when an item has no Start Date set. Typically the release EC date.'),
};

type Row = {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  priority: string;
  assignee: string;
  startDate: string | null;
  endDate: string | null;
  riskBucket: 'red' | 'yellow' | 'green' | 'not_set';
  endDateSource: 'codeComplete' | 'commitGate' | 'promotionGate' | 'duedate' | 'none';
};

export function registerGanttReleaseTimeline(server: McpServer, env: Env): void {
  const jira = new JiraConnector(env);

  server.registerTool(
    'gantt_release_timeline',
    {
      title: 'Gantt Release Timeline',
      description: 'Per-item start/end dates for the Features + Initiatives in a release, following the NDB-Ops date-field hierarchy. Output drives release Gantt UIs directly. Use when the user asks "show me the timeline for NDB-2.x", "release gantt", or wants a per-item schedule view.',
      inputSchema,
      annotations: {
        title: 'Release Timeline',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ version, includeEpics, fallbackStartDate }) => {
      try {
        const types = includeEpics
          ? ['Feature', 'Initiative', 'X-FEAT', 'Capability', 'Epic']
          : ['Feature', 'Initiative', 'X-FEAT', 'Capability'];
        const typeClause = types.map(t => `"${t}"`).join(',');
        const jql = `fixVersion = "${version}" AND issuetype in (${typeClause}) AND status not in (Cancelled, Backlog)`;

        const issues = await jira.searchAll(jql, FIELDS);

        const rows: Row[] = issues.map((issue) => {
          const f = (issue.fields ?? {}) as Record<string, unknown>;
          const issueType = (f['issuetype'] as { name?: string } | undefined)?.name ?? '';
          const startRaw = (f[START_DATE_FIELD] as string | undefined) || fallbackStartDate || null;

          let endDate: string | null = null;
          let endDateSource: Row['endDateSource'] = 'none';
          if (issueType === 'Epic') {
            endDate = (f['duedate'] as string | undefined) || null;
            endDateSource = endDate ? 'duedate' : 'none';
          } else {
            const cc = f[CODE_COMPLETE_FIELD] as string | undefined;
            const cg = f[COMMIT_GATE_FIELD] as string | undefined;
            const pg = f[PROMOTION_GATE_FIELD] as string | undefined;
            if (cc) { endDate = cc; endDateSource = 'codeComplete'; }
            else if (cg) { endDate = cg; endDateSource = 'commitGate'; }
            else if (pg) { endDate = pg; endDateSource = 'promotionGate'; }
          }

          return {
            key: issue.key,
            summary: String(f['summary'] ?? ''),
            issueType,
            status: (f['status'] as { name?: string } | undefined)?.name ?? '',
            priority: (f['priority'] as { name?: string } | undefined)?.name ?? '',
            assignee: (f['assignee'] as { displayName?: string } | undefined)?.displayName ?? 'Unassigned',
            startDate: startRaw,
            endDate,
            riskBucket: classifyRisk(f['customfield_23560']),
            endDateSource,
          };
        });

        // Sort earliest-end first so the Gantt naturally reads top-to-bottom.
        rows.sort((a, b) => {
          if (a.endDate && b.endDate) return a.endDate.localeCompare(b.endDate);
          if (a.endDate) return -1;
          if (b.endDate) return 1;
          return a.key.localeCompare(b.key);
        });

        const incomplete = rows.filter(r => !r.startDate || !r.endDate);
        const lines: string[] = [];
        lines.push(`# Release Gantt — ${version}`);
        lines.push(`${rows.length} items  •  ${incomplete.length} with incomplete dates`);
        lines.push('');
        lines.push('| Key | Type | Status | Start | End | Source | Risk |');
        lines.push('|---|---|---|---|---|---|---|');
        for (const r of rows) {
          lines.push(`| ${r.key} | ${r.issueType} | ${r.status} | ${r.startDate ?? '–'} | ${r.endDate ?? '–'} | ${r.endDateSource} | ${r.riskBucket} |`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { version, rows, incompleteCount: incomplete.length },
        };
      } catch (err) {
        const wrapped = JiraConnector.wrapError(err, 'Failed to build release timeline');
        return {
          content: [{ type: 'text', text: `JIRA error (${wrapped.statusCode}): ${wrapped.message}` }],
          isError: true,
        };
      }
    }
  );
}

function classifyRisk(raw: unknown): Row['riskBucket'] {
  if (!raw) return 'not_set';
  const value = typeof raw === 'object' && raw !== null
    ? String((raw as { value?: string; name?: string }).value ?? (raw as { name?: string }).name ?? '')
    : String(raw);
  const v = value.toLowerCase();
  if (!v) return 'not_set';
  if (v.includes('red') || v.includes('critical') || v.includes('high')) return 'red';
  if (v.includes('yellow') || v.includes('moderate') || v.includes('at risk')) return 'yellow';
  if (v.includes('green') || v.includes('on track') || v.includes('low')) return 'green';
  return 'not_set';
}
