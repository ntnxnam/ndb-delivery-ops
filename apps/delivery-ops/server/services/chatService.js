const { extractScope } = require('../utils/chatIntentRouter');
const { buildSnapshot } = require('../utils/chatSnapshotBuilder');
const { buildReleaseIntelligence } = require('./releaseAiSummaryService');

let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise =
      process.env.NODE_ENV === 'test'
        ? Promise.resolve(require('@portfolio-delivery-ops/shared'))
        : import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

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
}) {
  if (!message || !String(message).trim()) {
    throw new Error('message is required');
  }

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

  const { loadAgentPack, runAgentTurn } = await getShared();
  const pack = loadAgentPack();
  const result = await runAgentTurn(
    {
      message: String(message).trim(),
      history: sanitizeHistory(history),
      session: { productId, audience: audience || 'tpm' },
      perceive: compactPerceive(snapshot),
      validTicketKeys: snapshot.validTicketKeys || [],
      tools: createHostTools(snapshot),
    },
    pack
  );

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
  };
}

module.exports = {
  answerChat,
};
