/**
 * TODO(orphan): only consumer of oncallService (V1 orchestrator); V2 uses oncallDashboardV2.
 * When LLM briefing migrates to V2 snapshot, delete this module and oncallService.js.
 * Build OnCall intelligence packet for LLM briefing.
 * Deterministic stack graphs + dwell + VALID TICKET KEYS; RAG from oncallService.
 */

const oncallService = require('./oncallService');
const {
  fetchTicketNarrativeBundle,
  buildDeterministicStackBlurb,
} = require('./ticketNarrativeService');

function collectValidKeys(stacks) {
  const keys = new Set();
  for (const s of stacks) {
    if (s.key) keys.add(s.key);
    (s.techHelp || []).forEach((t) => t.key && keys.add(t.key));
    (s.techPubs || []).forEach((t) => t.key && keys.add(t.key));
    (s.knowledge || []).forEach((t) => t.key && keys.add(t.key));
    (s.engFixes || []).forEach((e) => e.key && keys.add(e.key));
    (s.linked || []).forEach((l) => l.key && keys.add(l.key));
  }
  return [...keys];
}

function selectSeeds(dashboard, maxSeeds) {
  const preview = dashboard.stacksPreview || [];
  return preview.slice(0, maxSeeds).map((s) => s.key);
}

/**
 * Enrich top seeds with full narrative bundles (comments, dwell, links).
 * Prefer client `dashboard` snapshot when teamId matches so AI numbers = on-screen tiles.
 */
async function buildIntelligence({ token, teamId, dashboard: snapshot } = {}) {
  const cfg = oncallService.resolveRuntimeConfig(teamId);
  const snapshotOk =
    snapshot &&
    typeof snapshot === 'object' &&
    (!teamId || !snapshot.teamId || String(snapshot.teamId).toLowerCase() === String(cfg.teamId).toLowerCase());
  const dashboard = snapshotOk
    ? snapshot
    : await oncallService.getDashboard({ token, teamId });
  if (!dashboard?.asOf && !dashboard?.hero) {
    throw new Error('OnCalls dashboard snapshot missing or incomplete');
  }
  const maxSeeds = cfg.maxSeedsForNarrative || 12;
  const seedKeys = selectSeeds(dashboard, maxSeeds);

  const stacks = [];
  for (const key of seedKeys) {
    const bundle = await fetchTicketNarrativeBundle(key, token, cfg);
    if (!bundle) {
      stacks.push({
        key,
        blurb: `[${key}] narrative unavailable`,
        bundle: null,
      });
      continue;
    }
    stacks.push({
      key: bundle.key,
      summary: bundle.summary,
      status: bundle.status,
      priority: bundle.priority,
      assignee: bundle.assignee,
      ageDays: bundle.ageDays,
      dwell: bundle.dwell,
      techHelp: bundle.techHelp,
      techPubs: bundle.techPubs,
      knowledge: bundle.knowledge,
      engFixes: bundle.engFixes,
      comments: (bundle.comments || []).slice(0, 5),
      description: bundle.description,
      blurb: buildDeterministicStackBlurb(bundle),
    });
  }

  const validKeys = collectValidKeys(stacks);

  return {
    teamId: dashboard.teamId,
    onCallProject: dashboard.onCallProject,
    asOf: dashboard.asOf,
    hero: dashboard.hero,
    paths: dashboard.paths,
    rag: dashboard.rag,
    priorityMix: dashboard.priorityMix,
    assigneeMix: dashboard.assigneeMix,
    stacks,
    validKeys,
    health: {
      verdict: dashboard.rag?.level || 'YELLOW',
      reason: dashboard.rag?.why || 'Insufficient signal',
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildIntelligence,
  collectValidKeys,
  selectSeeds,
};
