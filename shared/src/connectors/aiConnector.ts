/**
 * aiConnector — one LLM transport for every host (web, MCP, future).
 *
 * No domain prompts live here. Callers (naiService, agent runtime) assemble
 * messages; this module only talks to the configured OpenAI-compatible API.
 *
 * Per no-localhost: no default of localhost / 127.0.0.1.
 */

import axios from 'axios';
import https from 'node:https';

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface AiChatTurn {
  content: string;
  toolCalls: AiToolCall[];
  finishReason: string;
  usage?: unknown;
}

export interface AiChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  tools?: AiToolDefinition[];
}

export interface AiConnectorConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  maxTokens: number;
  timeoutMs: number;
  /** Corp NAI uses a private CA; default false matches current naiService. */
  rejectUnauthorized?: boolean;
}

export class AiConnectorError extends Error {
  naiDebug?: Record<string, unknown>;
}

/**
 * Non-secret config (endpoint, model, limits) lives in:
 *   apps/delivery-ops/server/config/aiConfig.json
 *
 * The API key is secret and must be set via environment variable:
 *   AI_API_KEY in server/.env  (retrieve from LastPass)
 *
 * Override env vars take precedence over aiConfig.json values:
 *   AI_API_BASE_URL, AI_DEFAULT_MODEL, AI_MAX_TOKENS, AI_REQUEST_TIMEOUT
 *
 * No fallback defaults — every required value must be explicitly configured.
 */
function readConfig(override?: Partial<AiConnectorConfig>): AiConnectorConfig {
  const baseUrl = (override?.baseUrl ?? process.env.AI_API_BASE_URL ?? '').trim();
  if (!baseUrl) {
    throw new Error(
      'AI_API_BASE_URL is not set. Set it in server/.env or check apps/delivery-ops/server/config/aiConfig.json.'
    );
  }
  if (/localhost|127\.0\.0\.1/i.test(baseUrl) && process.env.NODE_ENV === 'production') {
    throw new Error('AI_API_BASE_URL must not be localhost in production');
  }

  const apiKey = (override?.apiKey ?? process.env.AI_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('AI_API_KEY is not set. Retrieve the key from LastPass and set it in server/.env.');
  }

  const defaultModel = (override?.defaultModel ?? process.env.AI_DEFAULT_MODEL ?? '').trim();
  if (!defaultModel) {
    throw new Error(
      'AI_DEFAULT_MODEL is not set. Set it in server/.env or check apps/delivery-ops/server/config/aiConfig.json.'
    );
  }

  const maxTokensRaw = override?.maxTokens ?? (process.env.AI_MAX_TOKENS ? parseInt(process.env.AI_MAX_TOKENS, 10) : NaN);
  if (!maxTokensRaw || isNaN(maxTokensRaw)) {
    throw new Error('AI_MAX_TOKENS is not set. Set it in server/.env.');
  }

  const timeoutRaw = override?.timeoutMs ?? (process.env.AI_REQUEST_TIMEOUT ? parseInt(process.env.AI_REQUEST_TIMEOUT, 10) : NaN);
  if (!timeoutRaw || isNaN(timeoutRaw)) {
    throw new Error('AI_REQUEST_TIMEOUT is not set. Set it in server/.env.');
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    defaultModel,
    maxTokens: maxTokensRaw,
    timeoutMs: timeoutRaw,
    rejectUnauthorized: override?.rejectUnauthorized ?? false,
  };
}

export async function completeChat(
  messages: AiChatMessage[],
  options: AiChatOptions = {},
  override?: Partial<AiConnectorConfig>
): Promise<AiChatTurn> {
  const cfg = readConfig(override);
  const httpsAgent = new https.Agent({
    rejectUnauthorized: cfg.rejectUnauthorized !== false,
  });

  const body: Record<string, unknown> = {
    model: options.model ?? cfg.defaultModel,
    messages,
    max_tokens: options.maxTokens ?? cfg.maxTokens,
    stream: false,
    temperature: options.temperature ?? 0.3,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }

  const response = await axios.post(`${cfg.baseUrl}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    httpsAgent,
    timeout: options.timeoutMs ?? cfg.timeoutMs,
  });

  const choice = response.data?.choices?.[0];
  if (!choice) {
    const err = new AiConnectorError('LLM returned no choices in response');
    err.naiDebug = { rawBody: response.data };
    throw err;
  }

  const rawCalls = Array.isArray(choice.message?.tool_calls) ? choice.message.tool_calls : [];
  const toolCalls: AiToolCall[] = rawCalls
    .map((call: { id?: string; function?: { name?: string; arguments?: string } }, index: number) => ({
      id: String(call.id || `call_${index}`),
      name: String(call.function?.name || ''),
      arguments: String(call.function?.arguments || '{}'),
    }))
    .filter((call: AiToolCall) => call.name);

  const content = typeof choice.message?.content === 'string' ? choice.message.content : '';
  return {
    content,
    toolCalls,
    finishReason: String(choice.finish_reason || 'stop'),
    usage: response.data?.usage,
  };
}

export async function chatCompletion(
  messages: AiChatMessage[],
  options: AiChatOptions = {},
  override?: Partial<AiConnectorConfig>
): Promise<string> {
  const turn = await completeChat(messages, options, override);
  if (turn.toolCalls.length > 0 && !turn.content.trim()) {
    const err = new AiConnectorError(
      'LLM returned tool calls; use completeChat() for the agent loop.'
    );
    err.naiDebug = { finishReason: turn.finishReason, toolCalls: turn.toolCalls };
    throw err;
  }
  if (!turn.content.trim()) {
    const err = new AiConnectorError(
      `LLM returned empty content (finish_reason=${turn.finishReason}).`
    );
    err.naiDebug = {
      finishReason: turn.finishReason,
      usage: turn.usage,
      contentLength: turn.content.length,
    };
    throw err;
  }
  return turn.content;
}
