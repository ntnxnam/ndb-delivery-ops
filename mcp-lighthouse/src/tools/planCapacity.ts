/**
 * Tool: plan_capacity
 *
 * Compute headline capacity numbers for an NDB team given a planning
 * horizon. Replaces the Streamlit ~/ndb-capacity-planner/ — that app's
 * core was a deterministic formula:
 *
 *   gross_sp_capacity = sprints * fte * velocity_per_fte_per_sprint
 *   net_sp_capacity   = gross * (1 - reservedForBugsPct) * focusFactor
 *
 * The original surfaced this through a Streamlit UI with a YAML config
 * file. We move the math to an MCP tool so it's callable from any
 * client; the UI moves into apps/delivery-ops/ (where the existing
 * KPIPage can render it).
 *
 * Pure-compute tool — no JIRA call. A future enhancement (queued)
 * would resolve a real velocity from JIRA sprint history via the
 * sprint reports already in apps/delivery-ops/server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const inputSchema = {
  teamId: z.string().describe('Team identifier (for the audit trail; not consulted by this tool).'),
  fte: z.number().positive()
    .describe('Headcount available for the plan period (full-time equivalents).'),
  sprintCount: z.number().int().positive()
    .describe('Number of sprints in the plan horizon (NDB uses 3-week sprints).'),
  velocityPerFtePerSprint: z.number().positive().default(8)
    .describe('Average story points one FTE delivers per sprint. NDB historical default: 8.'),
  reservedForBugsPct: z.number().min(0).max(0.95).default(0.2)
    .describe('Fraction of capacity reserved for bug fixing (0.0 - 0.95). NDB default: 0.20.'),
  focusFactor: z.number().min(0.1).max(1).default(0.7)
    .describe('Focus factor — fraction of nominal capacity actually spent on planned work (the rest goes to meetings, reviews, etc.). NDB default: 0.70.'),
};

export function registerPlanCapacity(server: McpServer): void {
  server.registerTool(
    'plan_capacity',
    {
      title: 'Plan NDB Team Capacity',
      description: 'Compute gross + net story-point capacity for a team over a planning horizon. Returns gross, net, and the deductions in between. Use when the user asks "how many points can we commit", "capacity for next quarter", "what is team X going to deliver".',
      inputSchema,
      annotations: {
        title: 'Plan Capacity',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ teamId, fte, sprintCount, velocityPerFtePerSprint, reservedForBugsPct, focusFactor }) => {
      const gross = fte * sprintCount * velocityPerFtePerSprint;
      const afterFocus = gross * focusFactor;
      const reservedForBugs = afterFocus * reservedForBugsPct;
      const net = afterFocus - reservedForBugs;

      const lines: string[] = [];
      lines.push(`# Capacity Plan — team ${teamId}`);
      lines.push('');
      lines.push(`Horizon: ${sprintCount} sprints @ ${fte} FTE × ${velocityPerFtePerSprint} SP/FTE/sprint`);
      lines.push('');
      lines.push('| Line item | SP |');
      lines.push('|---|---:|');
      lines.push(`| Gross nominal capacity | ${gross.toFixed(1)} |`);
      lines.push(`| After focus factor (${(focusFactor * 100).toFixed(0)}%) | ${afterFocus.toFixed(1)} |`);
      lines.push(`| Reserved for bug fixing (${(reservedForBugsPct * 100).toFixed(0)}%) | -${reservedForBugs.toFixed(1)} |`);
      lines.push(`| **Net committable** | **${net.toFixed(1)}** |`);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          teamId, fte, sprintCount, velocityPerFtePerSprint,
          reservedForBugsPct, focusFactor,
          gross: Number(gross.toFixed(2)),
          afterFocus: Number(afterFocus.toFixed(2)),
          reservedForBugs: Number(reservedForBugs.toFixed(2)),
          net: Number(net.toFixed(2)),
        },
      };
    }
  );
}
