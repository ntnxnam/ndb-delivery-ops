/**
 * Product tool: generate_cfdcfi_brief
 * Lighthouse AI consume: userPrompt + validKeys → aiConnector chatCompletion with CFDCFI_CONCERN_SYSTEM_PROMPT
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../../../shared/config/env.js';

const CFDCFI_CONCERN_SYSTEM_PROMPT = `You are a senior TPM writing a fused CFD/CFI concern for a VP. Output MUST be Quantitative: then Qualitative: then Hotspot: then 2-line chase. Use ticket content. Input: TIMEFRAME/HERO/HEALTH/BREAKDOWNS + BOOMERANG rate + STACK SAMPLE. Quantitative: 40-45w counts only. Qualitative: 45-50w what counts mean. Hotspot: 50-60w thematic hotspot from content + age/test-escape/TH linkage tied to theme. Never quote full rootCause. Copy keys verbatim.`;

const inputSchema = {
  userPrompt: z.string().describe('User prompt from build_cfdcfi_prompt (Loom)'),
  validKeys: z.array(z.string()).optional().describe('Valid ticket keys for integrity check'),
};

export function registerGenerateCfdcfiBrief(server: McpServer, env: Env): void {
  server.registerTool(
    'generate_cfdcfi_brief',
    {
      title: 'Generate CFD/CFI Brief',
      description: 'Product: consume Loom-built CFD/CFI prompt and call NAI for fused quant+qual concern (hotspot + boomerang + chase). Use after build_cfdcfi_prompt.',
      inputSchema,
      annotations: { title: 'Generate CFD/CFI Brief', readOnlyHint: false, idempotentHint: false },
    },
    async ({ userPrompt, validKeys = [] }) => {
      try {
        const { chatCompletion } = await import('@portfolio-delivery-ops/shared');
        const text = await chatCompletion(
          [{ role: 'system', content: CFDCFI_CONCERN_SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
          { temperature: 0.25 }
        );
        const trimmed = String(text || '').trim();
        if (!trimmed) throw new Error('AI returned empty brief');
        return { content: [{ type: 'text', text: trimmed }], structuredContent: { summary: trimmed, validKeys } };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `CFD/CFI brief failed: ${msg}` }], isError: true };
      }
    }
  );
}
