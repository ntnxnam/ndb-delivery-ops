/**
 * Loom shared tool: build_cfdcfi_prompt
 * JIRA pull + prompt build (no NAI) — Lighthouse AI consumes.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../config/env.js';

const TIMEFRAMES = ['7d', '15d', '1M', '1Q', '2Q', '1Y', '18M', 'Overall'] as const;

const inputSchema = {
  teamId: z.string().optional().describe('Team ID (e.g. ndb)'),
  timeframe: z.enum(TIMEFRAMES).optional().default('7d').describe('Global timeframe pill'),
  view: z.string().optional().describe('Drawer view filter'),
  dashboard: z.record(z.string(), z.any()).optional().describe('Dashboard payload from /api/jira/cfdcfi/v2'),
};

function buildCfdcfiConcernPrompt(intelligence: any): { userPrompt: string; validKeys: string[] } {
  const i = intelligence || {};
  const tf = i.timeframe || '7d';
  const hero = i.hero || {};
  const health = i.health || {};
  const breakdowns = i.breakdowns || {};
  const boomerang = i.boomerang || {};
  const topComponents = i.componentMix || [];
  const top2 = (topComponents || []).slice(0, 2).map((c: any) => `${c.name} (${c.count})`).join(' + ') || 'no component hotspot';
  const validKeys: string[] = Array.isArray(i.validKeys) ? i.validKeys : (Array.isArray(i.gapMeta?.boomerangKeys) ? i.gapMeta.boomerangKeys.slice(0, 20) : []);
  const validBlock = validKeys.length ? `VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):\n${validKeys.map((k, idx) => `  ${idx + 1}. ${k}`).join('\n')}` : 'VALID TICKET KEYS: none provided (do not fabricate ticket keys)';
  const heroLine = `HERO: open=${hero.open?.count ?? 0} aged>${i.agedOpenDays || 14}d=${hero.agedOpen?.count ?? 0} p0Open=${hero.p0Open?.count ?? 0} p1Open=${hero.p1Open?.count ?? 0} closedInWindow=${hero.closedInWindow?.count ?? 0} timeframe=${tf}`;
  const healthLine = `HEALTH: mttrMedian=${health.mttrMedian ?? '—'}d p90=${health.p90 ?? '—'}d throughput=${health.throughput ?? 0} net=${health.net ?? 0} agedShare=${health.agedShare ?? '—'}%`;
  const bdLine = `BREAKDOWNS: byComponent top2=${top2} ageBuckets=${JSON.stringify(breakdowns.ageBuckets || {})} linkage TH=${breakdowns.linkage?.thLinked ?? 0}`;
  const boomLine = `BOOMERANG: rate=${boomerang.rate ?? 0}% deferredTotal=${boomerang.deferredTotal ?? 0}`;
  const stacks = Array.isArray((intelligence as any).stacksPreview) ? (intelligence as any).stacksPreview : [];
  const blurbLines = stacks.slice(0, 5).map((s: any) => {
    const cf = s.cfdcfiFields || {};
    const bits = [`${s.key}: ${String(s.summary || '').slice(0, 120)} [${s.status || '?'} ${s.ageDays ?? '?'}d]`];
    if (cf.testEscape) bits.push(`TestEscape:${cf.testEscape}`);
    if (cf.rootCause) bits.push(`RootCause:${String(cf.rootCause).slice(0, 180).replace(/\n/g, ' ')}`);
    return `- ${bits.join(' | ')}`;
  }).join('\n');
  const stackBlock = blurbLines ? `STACK SAMPLE (top 5 — use for hotspot themes):\n${blurbLines}` : '';
  const userPrompt = `TIMEFRAME: ${tf}\n${heroLine}\n${healthLine}\n${bdLine}\n${boomLine}\n\n${stackBlock ? stackBlock + '\n\n' : ''}${validBlock}\n\nWrite the 95-105 word concern paragraph + 2-line chase now. When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`;
  return { userPrompt, validKeys };
}

function buildCfdcfiSlicePrompt(slice: any): { userPrompt: string; validKeys: string[] } {
  const view = slice.view || 'component';
  const tf = slice.timeframe || '7d';
  const keys: string[] = Array.isArray(slice.keys) ? slice.keys : [];
  const validBlock = keys.length ? `VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):\n${keys.map((k, idx) => `  ${idx + 1}. ${k}`).join('\n')}` : 'VALID TICKET KEYS: none provided (do not fabricate ticket keys)';
  const userPrompt = `TIMEFRAME: ${tf}\nVIEW: ${view}\nKEYS: ${keys.join(', ') || 'none'}\nMETA: ${JSON.stringify(slice.meta || {})}\n\n${validBlock}\n\nWrite the 2-liner for this slice now. When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`;
  return { userPrompt, validKeys: keys };
}

export function registerBuildCfdcfiPrompt(server: McpServer, _env: Env): void {
  server.registerTool(
    'build_cfdcfi_prompt',
    {
      title: 'Build CFD/CFI Prompt',
      description: 'Loom: build CFD/CFI AI prompt from dashboard payload (no NAI). Returns userPrompt + validKeys for Lighthouse generate_cfdcfi_brief.',
      inputSchema,
      annotations: { title: 'Build CFD/CFI Prompt', readOnlyHint: true, idempotentHint: true },
    },
    async ({ teamId, timeframe = '7d', view, dashboard }) => {
      try {
        let intelligence: any = dashboard;
        if (!intelligence) return { content: [{ type: 'text', text: 'dashboard payload required (fetch /api/jira/cfdcfi/v2?teamId=&timeframe= first)' }], isError: true };
        intelligence.timeframe = timeframe;
        intelligence.teamId = teamId || intelligence.teamId;
        let result: { userPrompt: string; validKeys: string[] };
        if (view) result = buildCfdcfiSlicePrompt({ view, timeframe, keys: intelligence.validKeys || [], meta: intelligence });
        else result = buildCfdcfiConcernPrompt(intelligence);
        return { content: [{ type: 'text', text: result.userPrompt }], structuredContent: { userPrompt: result.userPrompt, validKeys: result.validKeys, timeframe, teamId: teamId || intelligence.teamId } };
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to build CFD/CFI prompt: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}

export { buildCfdcfiConcernPrompt, buildCfdcfiSlicePrompt };
