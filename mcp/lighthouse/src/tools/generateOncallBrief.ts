/**
 * Product tool: generate_oncall_brief
 * Lighthouse AI consume: userPrompt + validKeys → aiConnector chatCompletion with ONCALL_CONCERN_SYSTEM_PROMPT
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../../../shared/config/env.js';

const ONCALL_CONCERN_SYSTEM_PROMPT = `You are a senior TPM writing a fused OnCalls concern for a VP. Don't parrot numbers in a table — interpret them. Input: TIMEFRAME, HERO, HEALTH (mttrMedian/p90, throughput, net, agedShare%), WORKFLOW, GAP_TAXONOMY + ndbSub, HOTSPOT_COMPONENTS top2. Write 1 paragraph 95-115 words + 2-line chase. Paragraph must headline real concern (what does agedShare 58% + MTTR 15d/19d + throughput/net mean?), name hotspot verbatim like "last 7d hotspot in <A> (9) + <B> (7)" or "no component hotspot — diffuse", give gap story duds vs NDB vs other-team + where eng gaps land, and workflow Need Info vs Waiting pressure. Add 2-line chase: "Ask <owner> to <action> on <KEY> by <timeframe>." Copy keys verbatim — never invent. Decisive, no table dump.`;

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
