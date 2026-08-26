/**
 * Agent memory (Wave 4 / D42) — session / user / org JSON files.
 * Matches agent-pack/memory/schema.json. Not a vector store.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type MemoryTier = 'session' | 'user' | 'org';

export interface MemoryCorrection {
  text: string;
  source: 'human' | 'eval' | 'agent';
  createdAt: string;
}

export interface AgentMemoryRecord {
  tier: MemoryTier;
  userId?: string;
  productId?: string;
  sessionId?: string;
  updatedAt: string;
  entities: Record<string, string>;
  corrections: MemoryCorrection[];
  notes?: string;
}

export interface MemoryStore {
  load(keys: { tier: MemoryTier; userId?: string; productId?: string; sessionId?: string }): AgentMemoryRecord;
  save(record: AgentMemoryRecord): void;
}

const MAX_CORRECTIONS = 40;
const MAX_ENTITY_CHARS = 200;

export function safeMemoryId(value: string | undefined, fallback: string): string {
  const raw = String(value || '').trim() || fallback;
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

export function emptyMemory(
  tier: MemoryTier,
  keys: { userId?: string; productId?: string; sessionId?: string } = {}
): AgentMemoryRecord {
  return {
    tier,
    userId: keys.userId,
    productId: keys.productId,
    sessionId: keys.sessionId,
    updatedAt: new Date().toISOString(),
    entities: {},
    corrections: [],
  };
}

function fileFor(rootDir: string, record: Pick<AgentMemoryRecord, 'tier' | 'userId' | 'productId' | 'sessionId'>): string {
  if (record.tier === 'session') {
    return join(rootDir, 'memory', 'session', `${safeMemoryId(record.sessionId, 'anon')}.json`);
  }
  if (record.tier === 'user') {
    return join(
      rootDir,
      'memory',
      'user',
      `${safeMemoryId(record.userId, 'anon')}__${safeMemoryId(record.productId, 'default')}.json`
    );
  }
  return join(rootDir, 'memory', 'org', `${safeMemoryId(record.productId, 'default')}.json`);
}

function atomicWrite(path: string, json: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function mergeEntities(
  current: Record<string, string>,
  incoming: Record<string, string>
): Record<string, string> {
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const k = String(key || '').slice(0, 40);
    const v = String(value || '').slice(0, MAX_ENTITY_CHARS);
    if (k && v) next[k] = v;
  }
  return next;
}

export function appendCorrection(
  record: AgentMemoryRecord,
  correction: MemoryCorrection
): AgentMemoryRecord {
  const text = String(correction.text || '').trim().slice(0, 500);
  if (!text) return record;
  const corrections = [...record.corrections, { ...correction, text }].slice(-MAX_CORRECTIONS);
  return { ...record, corrections, updatedAt: new Date().toISOString() };
}

export function compactMemoryForPrompt(record: AgentMemoryRecord | null | undefined): {
  entities: Record<string, string>;
  corrections: string[];
} | null {
  if (!record) return null;
  const corrections = (record.corrections || []).slice(-8).map((c) => c.text);
  const hasEntities = Object.keys(record.entities || {}).length > 0;
  if (!hasEntities && corrections.length === 0 && !record.notes) return null;
  return { entities: record.entities || {}, corrections };
}

export class FileMemoryStore implements MemoryStore {
  constructor(private readonly rootDir: string) {}

  load(keys: { tier: MemoryTier; userId?: string; productId?: string; sessionId?: string }): AgentMemoryRecord {
    const skeleton = emptyMemory(keys.tier, keys);
    const path = fileFor(this.rootDir, skeleton);
    if (!existsSync(path)) return skeleton;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as AgentMemoryRecord;
      return {
        ...skeleton,
        ...parsed,
        tier: keys.tier,
        entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
        corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
      };
    } catch {
      return skeleton;
    }
  }

  save(record: AgentMemoryRecord): void {
    const next = { ...record, updatedAt: new Date().toISOString() };
    atomicWrite(fileFor(this.rootDir, next), next);
  }
}
