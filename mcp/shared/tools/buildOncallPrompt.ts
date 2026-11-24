/**
 * Loom shared tool: build_oncall_prompt
 * JIRA pull + prompt build (no NAI) — Lighthouse AI consumes.
 * Product-agnostic: cfg via env, teamId/timeframe/view from caller.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../config/env.js';

const TIMEFRAMES = ['7d', '15d', '1M', '1Q', '2Q', '1Y', '18M', 'Overall'] as const;

const inputSchema = {
  teamId: z.string().optional().describe('Team ID (e.g. ndb)'),
  timeframe: z.enum(TIMEFRAMES).optional().default('7d').describe('Global timeframe pill'),
  view: z.string().optional().describe('Drawer view: Need Info | Waiting for Customer | duds | ndbGaps | otherTeamGaps | thLinked etc.'),
  dashboard: z.record(z.string(), z.any()).optional().describe('Dashboard payload from /api/jira/oncalls/v2 (avoid extra JIRA fetch)'),
};

function buildOncallConcernPrompt(intelligence: any): { userPrompt: string; validKeys: string[] } {
  const i = intelligence || {};
  const tf = i.timeframe || '2Q';
  const hero = i.hero || {};
  const health = i.health || {};
  const workflow = i.workflow || {};
  const gap = i.gapTaxonomy || {};
  const topComponents = i.componentMix || i.topComponents || i.priorityMix || [];
  const top2 = (topComponents || []).slice(0, 2).map((c: any) => `${c.name || c.component || c.key} (${c.count})`).join(' + ') || 'no component hotspot';
  const validKeys: string[] = Array.isArray(i.validKeys) ? i.validKeys : (Array.isArray(i.gapMeta?.dudsKeys) ? [...i.gapMeta.dudsKeys, ...i.gapMeta.ndbGapsKeys, ...i.gapMeta.otherTeamGapsKeys].slice(0, 20) : []);
  const validBlock = validKeys.length
    ? `VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):\n${validKeys.map((k, idx) => `  ${idx + 1}. ${k}`).join('\n')}`
    : 'VALID TICKET KEYS: none provided (do not fabricate ticket keys)';
  const heroLine = `HERO: open=${hero.open?.count ?? 0} aged>${i.agedOpenDays || 14}d=${hero.agedOpen?.count ?? 0} needInfo=${hero.needInfoOpen?.count ?? workflow.needInfo?.count ?? 0} waitingCustomer=${hero.waitingCustomerOpen?.count ?? workflow.waiting?.count ?? 0} closedInWindow=${hero.closedInWindow?.count ?? 0} timeframe=${tf}`;
  const healthLine = `HEALTH: mttrMedian=${health.mttrMedian ?? '—'}d p90=${health.p90 ?? '—'}d throughput=${health.throughput ?? 0} net=${health.net ?? 0} agedShare=${health.agedShare ?? '—'}%`;
  const wfLine = `WORKFLOW: needInfo=${workflow.needInfo?.count ?? 0} waitingCustomer=${workflow.waiting?.count ?? 0}`;
  const gapLine = `GAP_TAXONOMY: duds=${gap.duds?.count ?? 0} ndbGaps=${gap.ndbGaps?.count ?? 0} otherTeamGaps=${gap.otherTeamGaps?.count ?? 0} ndbSub TH=${gap.ndbSub?.thLinked?.count ?? 0} bugs=${gap.ndbSub?.bugs?.count ?? 0} improvements=${gap.ndbSub?.improvements?.count ?? 0} other=${gap.ndbSub?.other?.count ?? 0}`;
  const hotspotLine = `HOTSPOT_COMPONENTS top2: ${top2}`;
  const userPrompt = `TIMEFRAME: ${tf}\n${heroLine}\n${healthLine}\n${wfLine}\n${gapLine}\n${hotspotLine}\n\n${validBlock}\n\nWrite the 95-105 word concern paragraph + 2-line chase now. When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`;
  return { userPrompt, validKeys };
}

function buildOncallSlicePrompt(slice: any): { userPrompt: string; validKeys: string[] } {
  const view = slice.view || 'Need Info';
  const tf = slice.timeframe || '2Q';
  const keys: string[] = Array.isArray(slice.keys) ? slice.keys : [];
  const validKeys = keys;
  const validBlock = validKeys.length
    ? `VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):\n${validKeys.map((k, idx) => `  ${idx + 1}. ${k}`).join('\n')}`
    : 'VALID TICKET KEYS: none provided (do not fabricate ticket keys)';
  const userPrompt = `TIMEFRAME: ${tf}\nVIEW: ${view}\nKEYS: ${keys.join(', ') || 'none'}\nMETA: ${JSON.stringify(slice.meta || {})}\n\n${validBlock}\n\nWrite the 2-liner for this slice now. When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`;
  return { userPrompt, validKeys };
}

export function registerBuildOncallPrompt(server: McpServer, _env: Env): void {
  server.registerTool(
    'build_oncall_prompt',
    {
      title: 'Build OnCall Prompt',
      description: 'Loom: build OnCall AI prompt from dashboard payload (no NAI). Returns userPrompt + validKeys for Lighthouse generate_oncall_brief. Product-agnostic; teamId/timeframe/view determine scope.',
      inputSchema,
      annotations: { title: 'Build OnCall Prompt', readOnlyHint: true, idempotentHint: true },
    },
    async ({ teamId, timeframe = '2Q', view, dashboard }) => {
      try {
        let intelligence: any = dashboard;
        if (!intelligence) {
          return {
            content: [{ type: 'text', text: 'dashboard payload required (fetch /api/jira/oncalls/v2?teamId=&timeframe= first)' }],
            isError: true,
          };
        }
        intelligence.timeframe = timeframe;
        intelligence.teamId = teamId || intelligence.teamId;
        let result: { userPrompt: string; validKeys: string[] };
        if (view) {
          result = buildOncallSlicePrompt({ view, timeframe, keys: intelligence.validKeys || [], meta: intelligence });
        } else {
          result = buildOncallConcernPrompt(intelligence);
        }
        return {
          content: [{ type: 'text', text: result.userPrompt }],
          structuredContent: { userPrompt: result.userPrompt, validKeys: result.validKeys, timeframe, teamId: teamId || intelligence.teamId },
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to build OnCall prompt: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}

export { buildOncallConcernPrompt, buildOncallSlicePrompt };
