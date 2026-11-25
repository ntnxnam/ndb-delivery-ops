/**
 * aiConnector — one LLM transport for every host (web, MCP, future).
 *
 * No domain prompts live here. Callers (naiService, agent runtime) assemble
 * messages; this module only talks to the configured OpenAI-compatible API.
 *
 * Per no-localhost: no default of localhost / 127.0.0.1.
 */

import axios from 'axios';
import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 *   NAI_API_KEY in server/.env  (retrieve from tokens.corp.nutanix.com)
 *
 * No fallback defaults — every required value must be explicitly configured.
 *
 * Usage matches the OpenAI-compatible client:
 *   from openai import OpenAI
 *   client = OpenAI(
 *       base_url="https://tokens.corp.nutanix.com/enterpriseai/gateway/v1",
 *       api_key=os.environ["NAI_API_KEY"],
 *   )
 *   Equivalently in Node (this connector):
 *   completeChat(messages, { model: "muse-spark-816b" })  // model defaults to aiConfig.json:defaultModel
 */
type AiConfigFallback = { baseUrl?: string; defaultModel?: string; maxTokens?: number; requestTimeoutMs?: number };

function loadAiConfigFallback(): AiConfigFallback {
  const candidates: string[] = [];
  if (process.env.AI_CONFIG_PATH?.trim()) {
    candidates.push(process.env.AI_CONFIG_PATH.trim());
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const sharedRoot = resolve(here, '..', '..');
    const monorepoRoot = resolve(sharedRoot, '..');
    candidates.push(join(monorepoRoot, 'apps', 'delivery-ops', 'server', 'config', 'aiConfig.json'));
    candidates.push(join(sharedRoot, '..', 'apps', 'delivery-ops', 'server', 'config', 'aiConfig.json'));
  } catch {}
  try {
    const cwd = process.cwd();
    candidates.push(join(cwd, 'apps', 'delivery-ops', 'server', 'config', 'aiConfig.json'));
    candidates.push(join(cwd, 'server', 'config', 'aiConfig.json'));
    candidates.push(join(cwd, 'config', 'aiConfig.json'));
    candidates.push(resolve(cwd, 'apps/delivery-ops/server/config/aiConfig.json'));
  } catch {}
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw) as AiConfigFallback;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
  }
  return {};
}

function readConfig(override?: Partial<AiConnectorConfig>): AiConnectorConfig {
  // Only NAI_* env vars are read (no AI_* fallback). aiConfig.json provides
  // defaults for non-secret vars when env is not set (matches voodooService behaviour).
  const aiConfigFallback = loadAiConfigFallback();
  // aiConfig.json provides defaults for non-secret vars when env not set; missing values throw below.

  const envBaseUrl = process.env.NAI_API_BASE_URL || '';
  const baseUrl = (override?.baseUrl || envBaseUrl || aiConfigFallback.baseUrl || '').trim();
  if (!baseUrl) {
    throw new Error(
      'NAI_API_BASE_URL is not set. Set it in server/.env or check apps/delivery-ops/server/config/aiConfig.json.'
    );
  }
  if (/localhost|127\.0\.0\.1/i.test(baseUrl) && process.env.NODE_ENV === 'production') {
    throw new Error('NAI_API_BASE_URL must not be localhost in production');
  }

  const apiKey = (override?.apiKey ?? process.env.NAI_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('NAI_API_KEY is not set. Retrieve the key from tokens.corp.nutanix.com and set it in server/.env.');
  }

  const envModel = process.env.NAI_DEFAULT_MODEL || '';
  const defaultModel = (override?.defaultModel || envModel || aiConfigFallback.defaultModel || '').trim();
  if (!defaultModel) {
    throw new Error(
      'NAI_DEFAULT_MODEL is not set. Set it in server/.env or check apps/delivery-ops/server/config/aiConfig.json.'
    );
  }

  const envMaxTokens = process.env.NAI_MAX_TOKENS || '';
  if (envMaxTokens && isNaN(parseInt(envMaxTokens, 10))) {
    throw new Error(`NAI_MAX_TOKENS is set but not a number: "${envMaxTokens}"`);
  }
  const maxTokensRaw =
    (override?.maxTokens ?? (envMaxTokens ? parseInt(envMaxTokens, 10) : undefined) ?? aiConfigFallback.maxTokens) as number | undefined;
  if (maxTokensRaw == null || typeof maxTokensRaw !== 'number' || isNaN(maxTokensRaw) || maxTokensRaw <= 0) {
    throw new Error('NAI_MAX_TOKENS is not set. Set it in server/.env or check apps/delivery-ops/server/config/aiConfig.json.');
  }

  const envTimeout = process.env.NAI_REQUEST_TIMEOUT || '';
  if (envTimeout && isNaN(parseInt(envTimeout, 10))) {
    throw new Error(`NAI_REQUEST_TIMEOUT is set but not a number: "${envTimeout}"`);
  }
  const timeoutRaw =
    (override?.timeoutMs ?? (envTimeout ? parseInt(envTimeout, 10) : undefined) ?? aiConfigFallback.requestTimeoutMs) as number | undefined;
  if (timeoutRaw == null || typeof timeoutRaw !== 'number' || isNaN(timeoutRaw) || timeoutRaw <= 0) {
    throw new Error('NAI_REQUEST_TIMEOUT is not set. Set it in server/.env or check apps/delivery-ops/server/config/aiConfig.json.');
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
