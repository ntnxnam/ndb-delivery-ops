jest.mock('../../services/agentRuntimeHost', () => {
  const rows = [];
  return {
    getShared: async () => ({}),
    getStores: async () => ({
      hitl: {
        list: (filter = {}) =>
          rows.filter((row) => {
            if (filter.requestedBy && row.requestedBy !== filter.requestedBy) return false;
            if (filter.sessionId && row.sessionId !== filter.sessionId) return false;
            if (filter.status && row.status !== filter.status) return false;
            return true;
          }),
        decide: (id, decision, actor) => {
          const row = rows.find((r) => r.id === id);
          if (!row) throw new Error(`unknown approval: ${id}`);
          row.status = decision === 'reject' ? 'rejected' : 'blocked_d26';
          row.decidedBy = actor;
          row.executed = false;
          return row;
        },
      },
    }),
    createRememberTool: jest.fn(),
    mergeScopeIntoSession: jest.fn(),
    maybeRememberFromMessage: jest.fn(),
    __rows: rows,
  };
});

const host = require('../../services/agentRuntimeHost');
const { listApprovals, decideApproval } = require('../../services/chatService');

describe('chatService HITL (D42)', () => {
  beforeEach(() => {
    host.__rows.splice(0, host.__rows.length);
    host.__rows.push({
      id: 'appr-1',
      status: 'pending',
      tool: 'propose_jira_write',
      requestedBy: 'alice',
      sessionId: 's1',
    });
  });

  test('lists only the caller’s pending rows', async () => {
    host.__rows.push({
      id: 'appr-2',
      status: 'pending',
      tool: 'propose_jira_write',
      requestedBy: 'bob',
      sessionId: 's2',
    });
    const mine = await listApprovals({ userId: 'alice', status: 'pending' });
    expect(mine.map((r) => r.id)).toEqual(['appr-1']);
  });

  test('approve records blocked_d26 and does not execute', async () => {
    const row = await decideApproval({ id: 'appr-1', decision: 'approve', userId: 'alice' });
    expect(row.status).toBe('blocked_d26');
    expect(row.executed).toBe(false);
  });

  test('reject records rejected', async () => {
    const row = await decideApproval({ id: 'appr-1', decision: 'reject', userId: 'alice' });
    expect(row.status).toBe('rejected');
  });

  test('other user cannot decide', async () => {
    await expect(
      decideApproval({ id: 'appr-1', decision: 'approve', userId: 'bob' })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(host.__rows[0].status).toBe('pending');
  });

  test('missing actor is forbidden', async () => {
    await expect(
      decideApproval({ id: 'appr-1', decision: 'approve' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('unknown id is 404', async () => {
    await expect(
      decideApproval({ id: 'missing', decision: 'approve', userId: 'alice' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
