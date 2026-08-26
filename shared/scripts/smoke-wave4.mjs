#!/usr/bin/env node
/**
 * Wave 4: memory, provenance, HITL pause; mutate never executes (D26 open).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileHitlInbox,
  FileMemoryStore,
  FileProvenanceLog,
  appendCorrection,
  collectUnknownKeys,
  mergeEntities,
  provenanceFromTurn,
} from '../dist/agentRuntime/index.js';

function assert(cond, msg) {
  if (!cond) {
    console.error(`smoke-wave4 failed: ${msg}`);
    process.exit(1);
  }
}

const root = mkdtempSync(join(tmpdir(), 'agent-runtime-'));
try {
  const memory = new FileMemoryStore(root);
  let rec = memory.load({ tier: 'session', sessionId: 's1', userId: 'u1', productId: 'p1' });
  rec = { ...rec, entities: mergeEntities(rec.entities, { release: 'REL-1.0' }) };
  rec = appendCorrection(rec, { text: 'never bury must-fix', source: 'human', createdAt: new Date().toISOString() });
  memory.save(rec);
  const loaded = memory.load({ tier: 'session', sessionId: 's1', userId: 'u1', productId: 'p1' });
  assert(loaded.entities.release === 'REL-1.0', 'session entity persisted');
  assert(loaded.corrections.length === 1, 'correction persisted');

  const hitl = new FileHitlInbox(root);
  const queued = hitl.enqueue({
    tool: 'propose_jira_write',
    args: { action: 'move_gate_date' },
    requestedBy: 'u1',
    sessionId: 's1',
    productId: 'p1',
  });
  const approved = hitl.decide(queued.id, 'approve', 'u1');
  assert(approved.status === 'blocked_d26', 'approve does not execute (D26 open)');

  const keys = collectUnknownKeys('See ERA-1 and ERA-999', ['ERA-1']);
  assert(keys.includes('ERA-999') && !keys.includes('ERA-1'), 'unknown key detector');

  const provenance = new FileProvenanceLog(root);
  const row = provenance.append(
    provenanceFromTurn({
      session: { productId: 'p1', userId: 'u1', sessionId: 's1' },
      trace: [{ tool: 'get_release_health', toolClass: 'read', ok: true, detail: 'ok' }],
      reply: 'Health is GREEN [source: get_release_health]',
      dataScopes: ['REL-1.0'],
      validTicketKeys: ['ERA-1'],
      pendingApprovalIds: [],
    })
  );
  assert(row.id && row.replySha256 && row.mode === 'read', 'provenance row written');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('wave4 ok: memory + provenance + HITL blocked_d26 (no JIRA write)');
