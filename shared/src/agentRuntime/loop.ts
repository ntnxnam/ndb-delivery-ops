import { completeChat as defaultCompleteChat } from '../connectors/aiConnector.js';
import type { AgentPack } from '../agentPack/types.js';
import type { AiChatMessage, AiToolDefinition } from '../connectors/aiConnector.js';
import { loadAgentPack } from '../agentPack/loadAgentPack.js';
import { buildBootstrapPrompt } from './bootstrap.js';
import { createPackTools } from './packTools.js';
import type { AgentTool, AgentTraceStep, AgentTurnInput, AgentTurnResult } from './types.js';

const DEFAULT_MAX_STEPS = 4;
const TOOL_RESULT_CAP = 16000;

async function callModel(
  complete: AgentTurnInput['completeChat'],
  messages: AiChatMessage[],
  tools: AiToolDefinition[]
) {
  const run = complete ?? defaultCompleteChat;
  try {
    return await run(messages, { tools, temperature: 0.2, maxTokens: 1400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (tools.length && /tool|400|unsupported/i.test(message)) {
      return run(messages, { temperature: 0.2, maxTokens: 1400 });
    }
    throw err;
  }
}

function toOpenAiTools(tools: AgentTool[]): AiToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: `${tool.description} [toolClass=${tool.toolClass}]`,
      parameters: tool.parameters,
    },
  }));
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseProtocol(content: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (parsed && typeof parsed.tool === 'string') {
      return { name: parsed.tool, args: parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {} };
    }
  } catch {
    return null;
  }
  return null;
}

async function executeTool(
  tool: AgentTool | undefined,
  name: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; result: unknown; detail: string }> {
  if (!tool) {
    return { ok: false, result: { error: `unknown tool: ${name}` }, detail: 'unknown' };
  }
  if (tool.toolClass !== 'read') {
    return {
      ok: false,
      result: { error: `refused: ${name} is ${tool.toolClass}; Wave 1 is read-only` },
      detail: 'refused_non_read',
    };
  }
  try {
    const result = await tool.execute(args);
    return { ok: true, result, detail: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, result: { error: message }, detail: 'threw' };
  }
}

export async function runAgentTurn(
  input: AgentTurnInput,
  pack?: AgentPack
): Promise<AgentTurnResult> {
  const loaded = pack ?? loadAgentPack();
  const hostTools = input.tools || [];
  const tools = [...createPackTools(loaded), ...hostTools];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const maxSteps = Math.min(Math.max(input.maxSteps ?? DEFAULT_MAX_STEPS, 1), 8);

  const history = (input.history || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }))
    .slice(-8);

  const messages: AiChatMessage[] = [
    {
      role: 'system',
      content: buildBootstrapPrompt(
        loaded,
        input.session,
        input.perceive,
        input.validTicketKeys || []
      ),
    },
    ...history,
    { role: 'user', content: String(input.message || '').slice(0, 4000) },
  ];

  const trace: AgentTraceStep[] = [];
  const openAiTools = toOpenAiTools(tools);

  for (let step = 1; step <= maxSteps; step += 1) {
    const turn = await callModel(input.completeChat, messages, openAiTools);

    let calls = (turn.toolCalls || []).filter((c) => c.name);
    if (calls.length === 0 && turn.content) {
      const protocol = parseProtocol(turn.content);
      if (protocol) {
        calls = [{ id: `protocol_${step}`, name: protocol.name, arguments: JSON.stringify(protocol.args) }];
      }
    }

    if (calls.length === 0) {
      const reply = String(turn.content || '').trim();
      if (!reply) {
        throw new Error('Agent produced an empty reply');
      }
      return { reply, trace, runtime: 'agent', steps: step };
    }

    const assistantToolCalls = calls.map((call) => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    }));
    messages.push({
      role: 'assistant',
      content: turn.content || '',
      tool_calls: assistantToolCalls,
    });

    for (const call of calls) {
      const tool = byName.get(call.name);
      const executed = await executeTool(tool, call.name, parseArgs(call.arguments));
      trace.push({
        tool: call.name,
        toolClass: tool?.toolClass || 'read',
        ok: executed.ok,
        detail: executed.detail,
      });
      const payload = JSON.stringify(executed.result);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: payload.length > TOOL_RESULT_CAP ? `${payload.slice(0, TOOL_RESULT_CAP)}…[truncated]` : payload,
      });
    }
  }

  throw new Error(`Agent exceeded ${maxSteps} tool steps without a final answer`);
}
