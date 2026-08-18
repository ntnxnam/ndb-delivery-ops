const { chatCompletion } = require('./naiService');
const { extractScope } = require('../utils/chatIntentRouter');
const { buildSnapshot } = require('../utils/chatSnapshotBuilder');
const { buildReleaseIntelligence } = require('./releaseAiSummaryService');

function buildSystemPrompt(snapshot) {
  return `You are a release operations assistant.

You must answer only from the SNAPSHOT data provided in this conversation.
If data is missing in the snapshot, explicitly say it is unavailable.

Citation rule:
- Every numeric claim must include [source: <path>] from snapshot fields.
- Every ticket key you cite must appear in validTicketKeys.
- Never invent ticket keys.

Output style:
- Be concise.
- Prefer bullet points for comparisons.
- If asked for risks, prioritize P0/P1 and must-fix tickets.

SNAPSHOT:
${JSON.stringify(snapshot)}`;
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

async function answerChat({
  message,
  history = [],
  defaultRelease,
  productId = 'ndb',
  jiraToken,
  availableReleases = [],
  knownTeams = [],
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

  const systemPrompt = buildSystemPrompt(snapshot);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...sanitizeHistory(history),
    { role: 'user', content: String(message).slice(0, 4000) },
  ];

  const reply = await chatCompletion(messages, {
    temperature: 0.2,
    maxTokens: 1400,
  });

  return {
    reply: String(reply || '').trim(),
    scope,
    snapshotMeta: {
      generatedAt: snapshot.generatedAt,
      releaseCount: Object.keys(snapshot.releaseContext || {}).length,
      validTicketKeyCount: (snapshot.validTicketKeys || []).length,
    },
  };
}

module.exports = {
  answerChat,
};

