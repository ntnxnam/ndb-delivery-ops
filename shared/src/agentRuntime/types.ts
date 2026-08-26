import type { ToolClass } from '../agentPack/types.js';
import type { AiChatMessage, AiChatTurn, AiToolDefinition } from '../connectors/aiConnector.js';

export interface AgentSession {
  productId: string;
  audience?: string;
  userId?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  toolClass: ToolClass;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface AgentTraceStep {
  tool: string;
  toolClass: ToolClass;
  ok: boolean;
  detail?: string;
}

export interface AgentTurnInput {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  session: AgentSession;
  tools?: AgentTool[];
  /** Compact perceive payload (release summaries, health). */
  perceive?: unknown;
  validTicketKeys?: string[];
  maxSteps?: number;
  completeChat?: (
    messages: AiChatMessage[],
    options: { tools?: AiToolDefinition[]; temperature?: number; maxTokens?: number }
  ) => Promise<AiChatTurn>;
}

export interface AgentTurnResult {
  reply: string;
  trace: AgentTraceStep[];
  runtime: 'agent';
  steps: number;
}
