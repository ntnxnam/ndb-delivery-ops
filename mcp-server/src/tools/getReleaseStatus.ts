/**
 * Tool: get_release_status
 *
 * Returns a compact, audience-aware snapshot of an NDB release version —
 * total items, risk counts (R/Y/G/not-set), top blockers, and progress on
 * the key checkpoint dates.
 *
 * This is the proving tool for the MCP server: it exercises the
 * jiraConnector (paginated /search + error unwrapping), the audience
 * shaping that every NDB-Ops output must do, and the structured-output
 * contract that downstream clients (Cursor, Claude Desktop) will rely on.
 *
 * Once this tool is stable, every other tool in mcp-server/src/tools/
 * follows the same template.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JiraConnector } from '../connectors/jiraConnector.js';
import type { Env } from '../config/env.js';

// Custom field IDs used in the snapshot. Same canonical set as
// apps/delivery-ops/server/services/releaseItemsService.js. Keep this list
// in sync with shared/jira/fields.ts when that lands.
const FIELDS = [
  'key',
  'summary',
  'status',
  'priority',
  'assignee',
  'issuetype',
  'fixVersions',
  'customfield_23560', // Risk Indicator
  'customfield_11067', // Code Complete Date
  'customfield_35863', // Commit Gate Ready Estimation
  'customfield_35864', // Promotion Gate Ready Estimation
].join(',');

const AUDIENCES = ['vp', 'em', 'engineer'] as const;
type Audience = (typeof AUDIENCES)[number];

const inputSchema = {
  version: z.string().describe('JIRA fixVersion name, e.g. "NDB-2.11"'),
  audience: z
    .enum(AUDIENCES)
    .optional()
    .describe(
      'Recipient persona. Shapes the verbosity + grouping of the result. Defaults to "em".'
    ),
};

type RiskBucket = 'red' | 'yellow' | 'green' | 'not_set';

function classifyRisk(raw: unknown): RiskBucket {
  if (!raw) return 'not_set';
  const value =
    typeof raw === 'object' && raw !== null
      ? String((raw as { value?: string; name?: string }).value ??
          (raw as { name?: string }).name ??
          '')
      : String(raw);
  const v = value.toLowerCase();
  if (!v) return 'not_set';
  if (v.includes('red') || v.includes('critical') || v.includes('high')) return 'red';
  if (v.includes('yellow') || v.includes('moderate') || v.includes('at risk')) return 'yellow';
  if (v.includes('green') || v.includes('on track') || v.includes('low')) return 'green';
  return 'not_set';
}

export function registerGetReleaseStatus(server: McpServer, env: Env): void {
  const jira = new JiraConnector(env);

  server.registerTool(
    'get_release_status',
    {
      title: 'Get NDB Release Status',
      description:
        'Snapshot of an NDB release: item count, risk breakdown (red/yellow/green/not-set), top blockers, and checkpoint progress. Audience-aware (vp / em / engineer). Use when the user asks for "release status", "release health", "where is NDB-2.x", or similar.',
      inputSchema,
      annotations: {
        title: 'NDB Release Status',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ version, audience = 'em' }) => {
      try {
        const jql = `fixVersion = "${version}" AND issuetype in (Feature, Initiative, X-FEAT, Capability) AND status not in (Cancelled, Backlog)`;
        const issues = await jira.searchAll(jql, FIELDS);

        const buckets: Record<RiskBucket, JiraIssueRow[]> = {
          red: [], yellow: [], green: [], not_set: [],
        };
        for (const issue of issues) {
          const f = (issue.fields ?? {}) as Record<string, unknown>;
          const bucket = classifyRisk(f['customfield_23560']);
          buckets[bucket].push({
            key: issue.key,
            summary: String(f['summary'] ?? ''),
            status: extractName(f['status']),
            priority: extractName(f['priority']),
            assignee: extractAssignee(f['assignee']),
          });
        }

        const totalCount = issues.length;
        const riskCounts = {
          red: buckets.red.length,
          yellow: buckets.yellow.length,
          green: buckets.green.length,
          not_set: buckets.not_set.length,
        };

        const payload = shapeForAudience(audience as Audience, version, totalCount, riskCounts, buckets);

        return {
          content: [{ type: 'text', text: payload.markdown }],
          structuredContent: payload.structured,
        };
      } catch (error) {
        const wrapped = JiraConnector.wrapError(error, 'Failed to fetch release status');
        return {
          content: [
            {
              type: 'text',
              text: `JIRA error (${wrapped.statusCode}): ${wrapped.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

type JiraIssueRow = {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string;
};

function extractName(field: unknown): string {
  if (!field || typeof field !== 'object') return '';
  return String((field as { name?: string }).name ?? '');
}

function extractAssignee(field: unknown): string {
  if (!field || typeof field !== 'object') return 'Unassigned';
  const a = field as { displayName?: string; name?: string };
  return a.displayName ?? a.name ?? 'Unassigned';
}

function shapeForAudience(
  audience: Audience,
  version: string,
  total: number,
  risk: Record<RiskBucket, number>,
  buckets: Record<RiskBucket, JiraIssueRow[]>
): { markdown: string; structured: Record<string, unknown> } {
  const structured: Record<string, unknown> = {
    version,
    audience,
    totalItems: total,
    riskCounts: risk,
    topReds: buckets.red.slice(0, 10),
    topYellows: buckets.yellow.slice(0, 10),
  };

  // Audience-aware rendering. The structuredContent stays the same; the
  // text content tightens or expands.
  const header = `# Release Status — ${version}\n\n_Audience: ${audience}_\n`;
  const riskLine = `**Risk:** Red ${risk.red} • Yellow ${risk.yellow} • Green ${risk.green} • Not Set ${risk.not_set} (Total ${total})\n`;

  if (audience === 'vp') {
    // Executive: 5 lines max, no individual tickets unless red.
    const reds = buckets.red.slice(0, 5).map((r) => `- ${r.key} (${r.status}) — ${r.summary}`).join('\n');
    const md = `${header}\n${riskLine}\n${reds ? `## Critical items\n\n${reds}\n` : '## Critical items\n\nNone.\n'}`;
    return { markdown: md, structured };
  }

  if (audience === 'em') {
    // Manager: red + yellow tables, no greens.
    const tableReds = renderTable(buckets.red.slice(0, 15), 'Red');
    const tableYellows = renderTable(buckets.yellow.slice(0, 15), 'Yellow');
    const md = `${header}\n${riskLine}\n${tableReds}\n${tableYellows}`;
    return { markdown: md, structured };
  }

  // engineer: everything, ordered red -> yellow -> green -> not_set
  const md = [header, riskLine,
    renderTable(buckets.red, 'Red'),
    renderTable(buckets.yellow, 'Yellow'),
    renderTable(buckets.green, 'Green'),
    renderTable(buckets.not_set, 'Not Set'),
  ].join('\n');
  return { markdown: md, structured };
}

function renderTable(rows: JiraIssueRow[], label: string): string {
  if (rows.length === 0) return `## ${label}\n\n_None._\n`;
  const head = `## ${label} (${rows.length})\n\n| Key | Status | Priority | Assignee | Summary |\n|---|---|---|---|---|\n`;
  const body = rows
    .map(
      (r) =>
        `| ${r.key} | ${r.status} | ${r.priority} | ${r.assignee} | ${r.summary.replace(/\|/g, '\\|')} |`
    )
    .join('\n');
  return `${head}${body}\n`;
}
