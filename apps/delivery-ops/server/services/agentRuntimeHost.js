/**
 * Web-host wiring for Wave 4 stores (memory, provenance, HITL).
 */

let _shared;
async function getShared() {
  if (!_shared) {
    _shared =
      process.env.NODE_ENV === 'test'
        ? Promise.resolve(require('@portfolio-delivery-ops/shared'))
        : import('@portfolio-delivery-ops/shared');
  }
  return _shared;
}

let _storesPromise;

async function getStores() {
  if (!_storesPromise) {
    _storesPromise = getShared().then((shared) => shared.createAgentRuntimeStores());
  }
  return _storesPromise;
}

function createRememberTool(shared, memory, { userId, productId }) {
  return {
    name: 'remember_correction',
    description:
      'Draft: persist a human correction or preference in user memory. Does not write to JIRA.',
    toolClass: 'draft',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    execute: ({ text } = {}) => {
      const note = String(text || '').trim();
      if (!note) return { error: 'text is required' };
      const record = memory.load({ tier: 'user', userId, productId });
      const next = shared.appendCorrection(record, {
        text: note,
        source: 'human',
        createdAt: new Date().toISOString(),
      });
      memory.save(next);
      return { ok: true, stored: true, text: note };
    },
  };
}

function mergeScopeIntoSession(shared, memory, { sessionId, userId, productId, scope }) {
  const record = memory.load({ tier: 'session', sessionId, userId, productId });
  const incoming = {};
  const release = (scope?.releases || [])[0];
  const ticket = (scope?.ticketKeys || [])[0];
  if (release) incoming.release = release;
  if (ticket) incoming.ticket = ticket;
  const next = {
    ...record,
    entities: shared.mergeEntities(record.entities || {}, incoming),
  };
  memory.save(next);
  return next;
}

function maybeRememberFromMessage(shared, memory, { message, userId, productId }) {
  const match = String(message || '').match(/^\s*remember(?:\s+this)?:\s*(.+)$/i);
  if (!match) return null;
  const record = memory.load({ tier: 'user', userId, productId });
  const next = shared.appendCorrection(record, {
    text: match[1].trim(),
    source: 'human',
    createdAt: new Date().toISOString(),
  });
  memory.save(next);
  return next;
}

module.exports = {
  getShared,
  getStores,
  createRememberTool,
  mergeScopeIntoSession,
  maybeRememberFromMessage,
};
