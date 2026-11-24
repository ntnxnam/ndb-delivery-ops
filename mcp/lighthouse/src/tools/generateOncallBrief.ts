/**
 * Product tool: generate_oncall_brief
 * Lighthouse AI consume: userPrompt + validKeys → aiConnector chatCompletion with ONCALL_CONCERN_SYSTEM_PROMPT
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../../../shared/config/env.js';

const ONCALL_CONCERN_SYSTEM_PROMPT = `You are a senior TPM writing a fused OnCalls concern for a VP. Fuse quantitative hero/health/workflow/gap signals with qualitative hotspot. Input gives timeframe, hero counts, health MTTR/throughput, workflow buckets, gap taxonomy percentages, and top 2 components. Output must be exactly 1 paragraph of 95-105 words: start with quant snapshot (open now, aged, closed in window, MTTR median/p90, net), then name hotspot like "last 2Q saw hotspot in Upgrade area (9) + MSSQL (7)" using provided componentMix counts verbatim, then gap% line (duds vs NDB vs other-team), then close with workflow pressure (Need Info vs Waiting). After paragraph, add 2-line chase: "Ask <owner> to <action> on <KEY> by <timeframe>." Copy ticket keys verbatim — never invent. Keep tone decisive, no jargon.`;

const inputSchema = {
  userPrompt: z.string().describe('User prompt from build_oncall_prompt (Loom)'),
  validKeys: z.array(z.string()).optional().describe('Valid ticket keys for integrity check'),
};

export function registerGenerateOncallBrief(server: McpServer, env: Env): void {
  server.registerTool(
    'generate_oncall_brief',
    {
      title: 'Generate OnCall Brief',
      description: 'Product: consume Loom-built OnCall prompt and call NAI for fused quant+qual concern (hotspot + chase). Use after build_oncall_prompt.',
      inputSchema,
      annotations: { title: 'Generate OnCall Brief', readOnlyHint: false, idempotentHint: false },
    },
    async ({ userPrompt, validKeys = [] }) => {
      try {
        const { chatCompletion } = await import('@portfolio-delivery-ops/shared');
        const text = await chatCompletion(
          [
            { role: 'system', content: ONCALL_CONCERN_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          { temperature: 0.25 }
        );
        const trimmed = String(text || '').trim();
        if (!trimmed) throw new Error('AI returned empty brief');
        return {
          content: [{ type: 'text', text: trimmed }],
          structuredContent: { summary: trimmed, validKeys },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `OnCall brief failed: ${msg}` }], isError: true };
      }
    }
  );
}
