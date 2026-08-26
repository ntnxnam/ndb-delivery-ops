/**
 * Append-only provenance log (Wave 4 / D42). One JSON object per line.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentTraceStep } from './types.js';

export type ProvenanceMode = 'read' | 'draft' | 'direct';

export interface ProvenanceRecord {
  id: string;
  at: string;
  userId?: string;
  sessionId?: string;
  productId: string;
  audience?: string;
  mode: ProvenanceMode;
  tools: Array<{ tool: string; toolClass: string; ok: boolean; detail?: string }>;
  dataScopes: string[];
  validTicketKeyCount: number;
  unknownKeysInReply: string[];
  pendingApprovalIds: string[];
  replySha256: string;
}

export interface ProvenanceLog {
  append(record: Omit<ProvenanceRecord, 'id' | 'at' | 'replySha256'> & { reply: string }): ProvenanceRecord;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function collectUnknownKeys(reply: string, validTicketKeys: string[]): string[] {
  const allow = new Set(validTicketKeys);
  if (allow.size === 0) return [];
  const found = reply.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [];
  return [...new Set(found.filter((key) => !allow.has(key)))];
}

export class FileProvenanceLog implements ProvenanceLog {
  private readonly filePath: string;

  constructor(rootDir: string) {
    this.filePath = join(rootDir, 'provenance.jsonl');
  }

  append(
    input: Omit<ProvenanceRecord, 'id' | 'at' | 'replySha256'> & { reply: string }
  ): ProvenanceRecord {
    const record: ProvenanceRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      userId: input.userId,
      sessionId: input.sessionId,
      productId: input.productId,
      audience: input.audience,
      mode: input.mode,
      tools: input.tools,
      dataScopes: input.dataScopes,
      validTicketKeyCount: input.validTicketKeyCount,
      unknownKeysInReply: input.unknownKeysInReply,
      pendingApprovalIds: input.pendingApprovalIds,
      replySha256: sha256(input.reply || ''),
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }
}

export function provenanceFromTurn(opts: {
  session: { productId: string; audience?: string; userId?: string; sessionId?: string };
  trace: AgentTraceStep[];
  reply: string;
  dataScopes: string[];
  validTicketKeys: string[];
  pendingApprovalIds: string[];
}): Omit<ProvenanceRecord, 'id' | 'at' | 'replySha256'> & { reply: string } {
  const toolClasses = new Set(opts.trace.map((t) => t.toolClass));
  const mode: ProvenanceMode = toolClasses.has('mutate')
    ? 'direct'
    : toolClasses.has('draft')
      ? 'draft'
      : 'read';
  return {
    userId: opts.session.userId,
    sessionId: opts.session.sessionId,
    productId: opts.session.productId,
    audience: opts.session.audience,
    mode,
    tools: opts.trace.map((t) => ({
      tool: t.tool,
      toolClass: t.toolClass,
      ok: t.ok,
      detail: t.detail,
    })),
    dataScopes: opts.dataScopes,
    validTicketKeyCount: opts.validTicketKeys.length,
    unknownKeysInReply: collectUnknownKeys(opts.reply, opts.validTicketKeys),
    pendingApprovalIds: opts.pendingApprovalIds,
    reply: opts.reply,
  };
}

export function provenanceFileExists(rootDir: string): boolean {
  return existsSync(join(rootDir, 'provenance.jsonl'));
}
