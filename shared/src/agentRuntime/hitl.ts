/**
 * HITL inbox for mutate tools (Wave 4 / D42).
 *
 * Mutate never executes here. D26 (who may approve which action) is still
 * open — approve records intent only (`blocked_d26`).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type HitlStatus = 'pending' | 'rejected' | 'blocked_d26';

export interface HitlApproval {
  id: string;
  status: HitlStatus;
  tool: string;
  args: Record<string, unknown>;
  requestedBy?: string;
  sessionId?: string;
  productId?: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export interface HitlInbox {
  enqueue(input: {
    tool: string;
    args: Record<string, unknown>;
    requestedBy?: string;
    sessionId?: string;
    productId?: string;
  }): HitlApproval;
  list(filter?: { sessionId?: string; requestedBy?: string; status?: HitlStatus }): HitlApproval[];
  decide(id: string, decision: 'approve' | 'reject', actor: string): HitlApproval;
}

function atomicWrite(path: string, json: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export class FileHitlInbox implements HitlInbox {
  private readonly filePath: string;

  constructor(rootDir: string) {
    this.filePath = join(rootDir, 'hitl', 'approvals.json');
  }

  private readAll(): HitlApproval[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(rows: HitlApproval[]): void {
    atomicWrite(this.filePath, rows);
  }

  enqueue(input: {
    tool: string;
    args: Record<string, unknown>;
    requestedBy?: string;
    sessionId?: string;
    productId?: string;
  }): HitlApproval {
    const row: HitlApproval = {
      id: randomUUID(),
      status: 'pending',
      tool: String(input.tool || ''),
      args: input.args && typeof input.args === 'object' ? input.args : {},
      requestedBy: input.requestedBy,
      sessionId: input.sessionId,
      productId: input.productId,
      createdAt: new Date().toISOString(),
      note: 'Queued for HITL. D26 is open — approve will not execute a JIRA write.',
    };
    const rows = this.readAll();
    rows.push(row);
    this.writeAll(rows.slice(-200));
    return row;
  }

  list(filter: { sessionId?: string; requestedBy?: string; status?: HitlStatus } = {}): HitlApproval[] {
    return this.readAll().filter((row) => {
      if (filter.sessionId && row.sessionId !== filter.sessionId) return false;
      if (filter.requestedBy && row.requestedBy !== filter.requestedBy) return false;
      if (filter.status && row.status !== filter.status) return false;
      return true;
    });
  }

  decide(id: string, decision: 'approve' | 'reject', actor: string): HitlApproval {
    const rows = this.readAll();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) {
      throw new Error(`unknown approval: ${id}`);
    }
    const current = rows[idx];
    if (current.status !== 'pending') {
      throw new Error(`approval ${id} is already ${current.status}`);
    }
    const next: HitlApproval = {
      ...current,
      status: decision === 'reject' ? 'rejected' : 'blocked_d26',
      decidedAt: new Date().toISOString(),
      decidedBy: actor,
      note:
        decision === 'reject'
          ? 'Rejected; no JIRA write.'
          : 'Approved in inbox, not executed. D26 (action-level auth) is still open.',
    };
    rows[idx] = next;
    this.writeAll(rows);
    return next;
  }
}
