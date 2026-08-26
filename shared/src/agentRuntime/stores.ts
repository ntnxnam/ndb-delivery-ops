/**
 * File-backed agent runtime stores (Wave 4). Override with AGENT_RUNTIME_DIR.
 */

import { mkdirSync } from 'node:fs';
import { FileHitlInbox } from './hitl.js';
import { FileMemoryStore } from './memoryStore.js';
import { FileProvenanceLog } from './provenance.js';

export interface AgentRuntimeStores {
  rootDir: string;
  memory: FileMemoryStore;
  provenance: FileProvenanceLog;
  hitl: FileHitlInbox;
}

export function resolveAgentRuntimeDir(explicit?: string): string {
  const fromEnv = (explicit || process.env.AGENT_RUNTIME_DIR || '').trim();
  if (fromEnv) return fromEnv;
  return `${process.cwd()}/.cache/agent-runtime`;
}

export function createAgentRuntimeStores(rootDir?: string): AgentRuntimeStores {
  const resolved = resolveAgentRuntimeDir(rootDir);
  mkdirSync(resolved, { recursive: true });
  return {
    rootDir: resolved,
    memory: new FileMemoryStore(resolved),
    provenance: new FileProvenanceLog(resolved),
    hitl: new FileHitlInbox(resolved),
  };
}
