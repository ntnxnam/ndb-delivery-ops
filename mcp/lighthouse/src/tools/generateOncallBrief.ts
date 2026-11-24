/**
 * Product tool: generate_oncall_brief
 * Lighthouse AI consume: userPrompt + validKeys → aiConnector chatCompletion with ONCALL_CONCERN_SYSTEM_PROMPT
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../../../shared/config/env.js';

const ONCALL_CONCERN_SYSTEM_PROMPT = `You are a senior TPM writing a fused OnCalls concern for a VP. Output MUST be labeled with exactly two sections. Input: TIMEFRAME, HERO, HEALTH, WORKFLOW, GAP_TAXONOMY + ndbSub, HOTSPOT top2, STACK SAMPLE (OnCall Relief/Root Cause/Workaround). Write Quantitative: 1 para 45-55w — counts only (open, aged, closed, MTTR median/p90, throughput/net, agedShare%). Then Qualitative: 1 para 60-70w — interpret: what does aged 58% + MTTR mean? hotspot verbatim or diffuse + gap duds vs NDB + where eng gaps land + Need Info vs Waiting pressure. Use STACK SAMPLE themes, no invented themes. Then 2-line chase Ask <owner> on <KEY> by timeframe. Copy keys verbatim — never invent.`;

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
