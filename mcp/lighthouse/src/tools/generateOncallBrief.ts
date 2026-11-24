/**
 * Product tool: generate_oncall_brief
 * Lighthouse AI consume: userPrompt + validKeys → aiConnector chatCompletion with ONCALL_CONCERN_SYSTEM_PROMPT
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../../../shared/config/env.js';

const ONCALL_CONCERN_SYSTEM_PROMPT = `You are a senior TPM writing a fused OnCalls concern for a VP. Output MUST be Quantitative: then Qualitative: then 2-line chase. Use ticket content, not status. Input: TIMEFRAME/HERO/HEALTH/WORKFLOW/GAP_TAXONOMY + HOTSPOT top2 + STACK SAMPLE (summary + OnCall Relief/RootCause/Workaround/Prelim Analysis — e.g. oracle, upgrade on 2.11 family). Quantitative: 45-55w counts only. Qualitative: 60-70w thematic hotspot from STACK SAMPLE content (oracle+upgrade infra + MPLS/marker pattern) + Problem/Technical Category, gap story tied to content, not status labels. Never quote full Workaround. Copy keys verbatim.`;

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
