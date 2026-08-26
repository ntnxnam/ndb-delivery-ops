const { extractScope } = require('../utils/chatIntentRouter');
const { buildSnapshot } = require('../utils/chatSnapshotBuilder');
const { buildReleaseIntelligence } = require('./releaseAiSummaryService');
const {
  getShared,
  getStores,
  createRememberTool,
  mergeScopeIntoSession,
  maybeRememberFromMessage,
} = require('./agentRuntimeHost');

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: String(m.content || '').slice(0, 4000),
    }))
    .slice(-8);
}

function ticketKey(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.key || null;
}

function compactPerceive(snapshot) {
  const releaseContext = {};
  for (const [name, ctx] of Object.entries(snapshot.releaseContext || {})) {
    const summary = ctx.summary || {};
    releaseContext[name] = {
      gateDates: ctx.gateDates || {},
      summary: {
        total: summary.total,
        byStatus: summary.byStatus,
        byIssueType: summary.byIssueType,
        topP0P1Open: summary.topP0P1Open || [],
      },
    };
  }

  const releaseIntelligence = {};
  for (const [name, intel] of Object.entries(snapshot.releaseIntelligence || {})) {
    releaseIntelligence[name] = {
      totalFeatures: intel.totalFeatures,
      p0BugsCount: intel.p0BugsCount,
      health: intel.health,
      selfReportedRisk: intel.selfReportedRisk,
      bucketCounts: intel.bucketCounts,
      dateMetrics: intel.dateMetrics,
      mustFixTicketKeys: (intel.mustFixTickets || []).map(ticketKey).filter(Boolean).slice(0, 8),
      p0BugKeys: (intel.p0Bugs || []).map(ticketKey).filter(Boolean).slice(0, 8),
    };
  }

  return {
    generatedAt: snapshot.generatedAt,
    schema: snapshot.schema,
    scope: snapshot.scope,
    defaults: snapshot.defaults,
    releaseContext,
    releaseIntelligence,
    knownTeams: snapshot.knownTeams,
  };
}

function createHostTools(snapshot) {
  return [
    {
      name: 'get_release_snapshot',
      description:
        'Read-only slice of the current chat snapshot for one release (counts, sample tickets, intelligence).',
      toolClass: 'read',
      parameters: {
        type: 'object',
        properties: {
          release: { type: 'string', description: 'Release name; defaults to snapshot focus' },
        },
        additionalProperties: false,
      },
      execute: ({ release } = {}) => {
        const name = String(release || snapshot.defaults?.release || '');
        if (!name) return { error: 'release is required' };
        const ctx = snapshot.releaseContext?.[name];
        if (!ctx) {
          return {
            error: `unknown release in snapshot: ${name}`,
            available: Object.keys(snapshot.releaseContext || {}),
          };
        }
        return {
          release: name,
          gateDates: ctx.gateDates,
          summary: ctx.summary,
          intelligence: snapshot.releaseIntelligence?.[name] || null,
        };
      },
    },
    {
      name: 'get_release_health',
      description:
        'Read-only computed release health verdict (code, not LLM). Copy verdict; do not re-derive.',
      toolClass: 'read',
      parameters: {
        type: 'object',
        properties: { release: { type: 'string' } },
        required: ['release'],
        additionalProperties: false,
      },
      execute: ({ release } = {}) => {
        const name = String(release || snapshot.defaults?.release || '');
        const intel = snapshot.releaseIntelligence?.[name];
        if (!intel) {
          return { error: `no health for ${name || '(missing release)'}` };
        }
        return {
          release: name,
          health: intel.health || null,
          p0BugsCount: intel.p0BugsCount,
          selfReportedRisk: intel.selfReportedRisk,
        };
      },
    },
    {
      name: 'propose_jira_write',
      description:
        'Mutate (HITL): propose a JIRA write such as a gate-date move. Does not execute. D26 is open.',
      toolClass: 'mutate',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'e.g. move_gate_date' },
          issueKey: { type: 'string' },
          payload: { type: 'object' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      execute: () => ({ executed: false, error: 'mutate execute must never run' }),
    },
  ];
}

async function answerChat({
  message,
  history = [],
  defaultRelease,
  productId = 'ndb',
  jiraToken,
  availableReleases = [],
  knownTeams = [],
  audience = 'tpm',
  sessionId: rawSessionId,
  userId,
}) {
  if (!message || !String(message).trim()) {
    throw new Error('message is required');
  }

  const shared = await getShared();
  const stores = await getStores();
  const sessionId = shared.safeMemoryId
    ? shared.safeMemoryId(rawSessionId, `s_${Date.now()}`)
    : String(rawSessionId || `s_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const actor = String(userId || '').trim() || 'anonymous';

  const scope = await extractScope({
    message,
    defaultRelease,
    availableReleases,
    knownTeams,
  });

  const snapshot = await buildSnapshot({
    scope,
    defaultRelease,
    productId,
    buildReleaseIntelligence,
    jiraToken,
  });

  maybeRememberFromMessage(shared, stores.memory, {
    message: String(message).trim(),
    userId: actor,
    productId,
  });
  const sessionMemory = mergeScopeIntoSession(shared, stores.memory, {
    sessionId,
    userId: actor,
    productId,
    scope,
  });
  const userMemory = stores.memory.load({ tier: 'user', userId: actor, productId });
  const orgMemory = stores.memory.load({ tier: 'org', productId });

  const { loadAgentPack, runAgentTurn, provenanceFromTurn } = shared;
  const pack = loadAgentPack();
  const result = await runAgentTurn(
    {
      message: String(message).trim(),
      history: sanitizeHistory(history),
      session: {
        productId,
        audience: audience || 'tpm',
        userId: actor,
        sessionId,
        memory: { session: sessionMemory, user: userMemory, org: orgMemory },
      },
      perceive: compactPerceive(snapshot),
      validTicketKeys: snapshot.validTicketKeys || [],
      tools: [
        ...createHostTools(snapshot),
        createRememberTool(shared, stores.memory, { userId: actor, productId }),
      ],
      hitl: stores.hitl,
    },
    pack
  );

  const pendingApprovals = result.pendingApprovals || [];
  const provenance = provenanceFromTurn
    ? stores.provenance.append(
        provenanceFromTurn({
          session: { productId, audience: audience || 'tpm', userId: actor, sessionId },
          trace: result.trace || [],
          reply: String(result.reply || ''),
          dataScopes: scope.releases || [],
          validTicketKeys: snapshot.validTicketKeys || [],
          pendingApprovalIds: pendingApprovals.map((p) => p.id),
        })
      )
    : { id: null };

  return {
    reply: String(result.reply || '').trim(),
    scope,
    snapshotMeta: {
      generatedAt: snapshot.generatedAt,
      releaseCount: Object.keys(snapshot.releaseContext || {}).length,
      validTicketKeyCount: (snapshot.validTicketKeys || []).length,
    },
    trace: result.trace || [],
    runtime: result.runtime || 'agent',
    sessionId,
    provenanceId: provenance.id || null,
    pendingApprovals,
    memoryMeta: {
      sessionEntities: Object.keys(sessionMemory.entities || {}).length,
      userCorrections: (userMemory.corrections || []).length,
    },
  };
}

async function listApprovals({ userId, sessionId, status } = {}) {
  if (!userId) return [];
  const stores = await getStores();
  return stores.hitl.list({
    requestedBy: userId,
    sessionId: sessionId || undefined,
    status: status || undefined,
  });
}

async function decideApproval({ id, decision, userId }) {
  if (!id) throw new Error('id is required');
  if (decision !== 'approve' && decision !== 'reject') {
    throw new Error('decision must be approve or reject');
  }
  if (!userId) {
    const err = new Error('not allowed to decide this approval');
    err.statusCode = 403;
    throw err;
  }
  const stores = await getStores();
  const existing = stores.hitl.list({}).find((row) => row.id === id);
  if (!existing) {
    const err = new Error(`unknown approval: ${id}`);
    err.statusCode = 404;
    throw err;
  }
  if (existing.requestedBy && existing.requestedBy !== userId) {
    const err = new Error('not allowed to decide this approval');
    err.statusCode = 403;
    throw err;
  }
  return stores.hitl.decide(id, decision, userId);
}

module.exports = {
  answerChat,
  listApprovals,
  decideApproval,
};
