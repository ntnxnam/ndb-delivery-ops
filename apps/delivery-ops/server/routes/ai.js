/**
 * AI routes — executive summary generation and JIRA field updates.
 * Mounted at /api/ai
 */
const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const {
  generateExecSummary,
  generateReleaseSummary,
  generateSosTierSummary,
  generateSosOverallSummary,
  generateSosLeaderReleaseSummary,
  generateSprintLeadershipAsks,
  generateOncallSummary,
} = require('../services/naiService');
const { generateLeaderCoaching } = require('../services/sosLeaderCoachingService');
const { answerChat, listApprovals, decideApproval } = require('../services/chatService');
const { deriveSignals } = require('../utils/execSummarySignals');
const { buildReleaseIntelligence } = require('../services/releaseAiSummaryService');
const { buildSprintAsksIntelligence } = require('../services/sprintLeadershipAsksService');
const { buildIntelligence: buildOncallIntelligence } = require('../services/oncallAiSummaryService');
const { buildOncallBlurbs } = require('../services/oncallBlurbService');
const { buildPageBriefing } = require('../services/pageAiBriefingService');
const { generateWeeklySkim } = require('../services/weeklySkimService');
const { fetchTicketNarrative } = require('../utils/jiraTicketNarrative');
const { requireAuth } = require('../middleware/authMiddleware');
const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const logger = require('../utils/logger');

const EXEC_SUMMARY_FIELD = 'customfield_38460';

function isNaiTimeout(err) {
  const msg = err?.message || '';
  const code = err?.code || '';
  return code === 'ECONNABORTED' || /timeout|timed out|ECONNABORTED/i.test(msg);
}

function naiFailureResponse(res, err, fallback) {
  if (isNaiTimeout(err)) {
    return res.status(504).json({
      error: 'AI generation timed out. The model took too long — please retry.',
    });
  }
  return res.status(502).json({ error: err.message || fallback });
}

/**
 * POST /api/ai/chat
 * Conversational AI endpoint. Perceive (snapshot) then agentRuntime loop
 * (pack + host tools; mutate is HITL-queued). Same LLM as exec/release summaries.
 *
 * Body:
 * {
 *   message: string,
 *   history?: [{ role: "user"|"assistant", content: string }],
 *   release?: string,
 *   productId?: string,
 *   audience?: string,
 *   sessionId?: string,
 *   availableReleases?: string[],
 *   knownTeams?: string[]
 * }
 */
router.post('/chat', validateJiraTokenMiddleware, async (req, res) => {
  const {
    message,
    history = [],
    release = null,
    productId = '',
    audience = 'tpm',
    sessionId = null,
    availableReleases = [],
    knownTeams = [],
    datasetId = null,
    jqlHash = null,
  } = req.body || {};

  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  // — Slice 3: digging branch — if datasetId/jqlHash present, load cached JIRA
  // tickets (shared/.cache/jira-digging/{productId}/{jqlHash}/tickets.json.gz)
  // and answer grounded via muse-spark/beam (aiConnector). Read-only D26.
  const rawHash = String(jqlHash || '').trim();
  const rawDatasetId = String(datasetId || '').trim();
  const effectiveHash = rawHash || (rawDatasetId.startsWith('dig_') ? rawDatasetId.split('_')[1] || '' : '');
  const isDigging = Boolean(rawDatasetId || rawHash);
  if (isDigging) {
    if (!effectiveHash) return res.status(400).json({ error: 'jqlHash or datasetId with hash is required for digging ask' });
    try {
      const shared = await import('@portfolio-delivery-ops/shared');
      const result = await shared.answerDiggingAsk({
        productId: productId || 'ndb',
        jqlHash: effectiveHash,
        datasetId: rawDatasetId || undefined,
        question: String(message).trim(),
        history,
        audience,
        userId: req.username || req.body?.username,
        sessionId: sessionId || undefined,
      });
      // Provenance (best-effort) — reuse agent runtime stores; fallback to UUID if unavailable
      let provenanceId = null;
      try {
        const { getShared, getStores } = require('../services/agentRuntimeHost');
        const s = await getShared();
        const stores = await getStores();
        const rec = s.provenanceFromTurn({
          session: { productId: productId || 'ndb', audience: audience || 'tpm', userId: req.username || req.body?.username, sessionId: result.manifest.datasetId || sessionId },
          trace: [{ tool: 'loadDiggingCache', toolClass: 'read', ok: true, detail: `tickets=${result.manifest.ticketCount} compacted=${result.compacted.length}` }],
          reply: result.reply,
          dataScopes: [result.manifest.jql],
          validTicketKeys: result.validKeys || [],
          pendingApprovalIds: [],
        });
        const appended = stores.provenance.append(rec);
        provenanceId = appended.id || null;
      } catch (_) { /* provenance optional */ }
      return res.json({
        reply: result.reply,
        scope: { intent: 'digging', datasetId: result.manifest.datasetId, jql: result.manifest.jql, productId: result.manifest.productId, ticketCount: result.manifest.ticketCount, jqlHash: result.manifest.jqlHash },
        snapshotMeta: { generatedAt: result.manifest.fetchedAt, ticketCount: result.manifest.ticketCount, compactedCount: result.compacted.length, validTicketKeyCount: result.validKeys.length, mode: 'digging' },
        trace: [{ tool: 'loadDiggingCache', toolClass: 'read', ok: true, detail: `tickets=${result.manifest.ticketCount} compacted=${result.compacted.length} via ${result.manifest.jqlHash}` }],
        runtime: 'digging',
        sessionId: sessionId || result.manifest.datasetId,
        provenanceId,
        pendingApprovals: [],
        memoryMeta: null,
      });
    } catch (err) {
      logger.error('[ai/chat digging] failed', err, { naiDebug: err.naiDebug, hash: effectiveHash });
      if (String(err.message || '').includes('dataset not found')) return res.status(404).json({ error: err.message });
      if (String(err.message || '').includes('invalid')) return res.status(400).json({ error: err.message });
      return naiFailureResponse(res, err, 'Digging chat failed');
    }
  }

  try {
    const jiraToken = req.headers.authorization?.replace('Bearer ', '');
    const result = await answerChat({
      message,
      history,
      defaultRelease: release,
      productId,
      audience,
      sessionId,
      userId: req.username || req.body?.username,
      jiraToken,
      availableReleases,
      knownTeams,
    });

    return res.json({
      reply: result.reply,
      scope: result.scope,
      snapshotMeta: result.snapshotMeta,
      trace: result.trace || [],
      runtime: result.runtime || 'agent',
      sessionId: result.sessionId,
      provenanceId: result.provenanceId,
      pendingApprovals: result.pendingApprovals || [],
      memoryMeta: result.memoryMeta || null,
    });
  } catch (err) {
    logger.error('[ai/chat] failed', err, { naiDebug: err.naiDebug });
    return naiFailureResponse(res, err, 'Chat request failed');
  }
});

router.get('/approvals', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const rows = await listApprovals({
      userId: req.username,
      sessionId: req.query.sessionId,
      status: req.query.status,
    });
    return res.json({ approvals: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to list approvals' });
  }
});

router.post('/approvals/:id', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const decision = req.body?.decision;
    const row = await decideApproval({
      id: req.params.id,
      decision,
      userId: req.username,
    });
    return res.json({ approval: row, executed: false });
  } catch (err) {
    const code = err.statusCode || (String(err.message || '').includes('unknown') ? 404 : 400);
    return res.status(code).json({ error: err.message || 'Failed to decide approval' });
  }
});

/**
 * POST /api/ai/exec-summary
 * Call NAI to generate a phase-aware executive summary for a single JIRA item.
 *
 * Body: {
 *   item: <full raw JIRA item, including customfield_* fields>,
 *   ganttConfig: <per-version gate marker dates from /api/config/release-versions>,
 *   breakdownData: <task breakdown for this item from taskBreakdownService>,
 *   release: "NDB-2.11"
 * }
 *
 * Returns: { summary: "[YYYY-MM-DD] GREEN: ...", phase, signals }
 */
router.post('/exec-summary', validateJiraTokenMiddleware, async (req, res) => {
  const { item, ganttConfig = null, breakdownData = null, release = null, releaseContext = null } = req.body || {};

  if (!item || !item.key) {
    return res.status(400).json({ error: 'item with a key field is required' });
  }

  try {
    const rawStatusText = typeof item.customfield_23073 === 'string'
      ? item.customfield_23073
      : (item.customfield_23073?.value || null);

    const jiraToken = req.headers.authorization?.replace('Bearer ', '');

    // Fetch narrative first — it supplies the SDL/LEG/TECHPUBS compliance
    // ticket statuses that deriveSignals folds into the criticalRisks list.
    // Signal derivation is sync/CPU-light, so doing it after the network
    // round-trip costs nothing and lets compliance state stay authoritative.
    // The narrative fetcher swallows its own errors and returns null on
    // failure, so signal derivation always gets a value (possibly null) and
    // falls back to item.issuelinks / labels.
    const narrative = await fetchTicketNarrative(item.key, jiraToken);
    const signals = deriveSignals({ item, ganttConfig, breakdownData, narrative, release, today: new Date(), releaseContext });

    const text = await generateExecSummary(signals, narrative, rawStatusText);

    // Defensive: generateExecSummary already throws on empty, but double-check
    // before stamping so a future regression can't push "[YYYY-MM-DD] " to the UI.
    if (!text || !text.trim()) {
      logger.error(`AI exec summary empty after NAI call for ${item.key}`, new Error('Empty NAI response'));
      return res.status(502).json({ error: 'NAI returned an empty response. Please retry.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const stamped = `[${today}] ${text.trim()}`;

    logger.info(`AI exec summary generated for ${item.key} (phase=${signals.phase}, ${text.length} chars, narrative=${narrative ? 'yes' : 'no'})`);
    return res.json({ summary: stamped, phase: signals.phase, signals });
  } catch (err) {
    // logger.error expects (message, errorObj, metadata) — passing the err object
    // and the naiDebug shape lets us see finish_reason / usage in error logs.
    logger.error(`AI exec summary failed for ${item.key}`, err, { naiDebug: err.naiDebug });
    return naiFailureResponse(res, err, 'NAI request failed');
  }
});

/**
 * PUT /api/ai/exec-summary/:key
 * Write the generated executive summary to customfield_38460 in JIRA.
 *
 * Body: { summary: "[YYYY-MM-DD] <text>" }
 */
router.put('/exec-summary/:key', validateJiraTokenMiddleware, async (req, res) => {
  const { key } = req.params;
  const { summary } = req.body;

  if (!key || !summary) {
    return res.status(400).json({ error: 'key and summary are required' });
  }

  const jiraToken = req.headers['authorization']?.replace('Bearer ', '');
  if (!jiraToken) {
    return res.status(401).json({ error: 'JIRA token required' });
  }

  try {
    const jira = await getJira(jiraToken);
    await jira.put(
      JIRA_API_V2.ISSUE(encodeURIComponent(key)),
      { fields: { [EXEC_SUMMARY_FIELD]: summary } },
      { timeout: 15000 }
    );

    logger.info(`Exec summary pushed to JIRA for ${key}`);
    return res.json({ success: true, key, field: EXEC_SUMMARY_FIELD });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.message || 'JIRA update failed';
    logger.error(`JIRA update failed for ${key}`, err, { jiraStatus: status, jiraMessage: message });
    return res.status(status).json({ error: message });
  }
});

/**
 * POST /api/ai/release-summary
 * Generate a release-level AI briefing (health, top blockers, 7-day action list)
 * by running deriveSignals across all committed features and calling NAI.
 *
 * Body: { version: "NDB-2.12" }
 * Auth: JIRA token in Authorization header (passed to JIRA search calls)
 *
 * Returns: {
 *   summary: "<markdown three-section briefing>",
 *   intelligence: { version, totalFeatures, p0BugsCount, phaseDist, buckets, ... },
 *   generatedAt: "<ISO string>"
 * }
 *
 * Gate-lagging detection uses deriveSignals.latestPassedMarker — see
 * shared/src/domain/execSummarySignals.cjs and the CLOSEST-DATE-THAT-PASSED RULE
 * in naiService.js for the full logic.
 */
/**
 * POST /api/ai/oncall-blurbs
 * Lightweight per-OnCall about lines for path/escalation drills.
 * Body: { teamId?: string, keys: string[] }
 */
router.post('/oncall-blurbs', validateJiraTokenMiddleware, async (req, res) => {
  const teamId = (req.body?.teamId || '').trim() || undefined;
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const jiraToken = req.headers.authorization?.replace('Bearer ', '') || req.jiraToken;

  if (!keys.length) {
    return res.status(400).json({ error: 'keys array is required' });
  }

  try {
    logger.info(`[oncall-blurbs] team=${teamId || 'default'} keys=${keys.length}`);
    const result = await buildOncallBlurbs({ token: jiraToken, teamId, keys });
    return res.json(result);
  } catch (err) {
    logger.error(`[oncall-blurbs] Failed for team=${teamId}`, err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured')) {
      // Narrative-only path should still work inside the service; this is unexpected.
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'OnCall blurb generation failed');
  }
});

/**
 * POST /api/ai/oncall-summary
 * OnCall portfolio briefing from stack graphs (OnCall → TechHelp → eng fix).
 * Body: { teamId?: string, dashboard?: object } — pass dashboard to skip a second JIRA metrics fetch
 */
router.post('/oncall-summary', validateJiraTokenMiddleware, async (req, res) => {
  const teamId = (req.body?.teamId || '').trim() || undefined;
  const dashboard = req.body?.dashboard && typeof req.body.dashboard === 'object' ? req.body.dashboard : undefined;
  const jiraToken = req.headers.authorization?.replace('Bearer ', '') || req.jiraToken;

  try {
    logger.info(
      `[oncall-summary] Building intelligence for team=${teamId || 'default'}` +
        (dashboard?.asOf ? ` snapshot=${dashboard.asOf}` : ' (live fetch)')
    );
    const intelligence = await buildOncallIntelligence({ token: jiraToken, teamId, dashboard });
    const summary = await generateOncallSummary(intelligence);

    const responseIntelligence = {
      teamId: intelligence.teamId,
      onCallProject: intelligence.onCallProject,
      hero: intelligence.hero,
      paths: intelligence.paths,
      rag: intelligence.rag,
      health: intelligence.health,
      priorityMix: intelligence.priorityMix,
      assigneeMix: intelligence.assigneeMix,
      stacks: (intelligence.stacks || []).map((s) => ({
        key: s.key,
        summary: s.summary,
        status: s.status,
        priority: s.priority,
        assignee: s.assignee,
        ageDays: s.ageDays,
        dwell: s.dwell
          ? {
              currentStatus: s.dwell.currentStatus,
              currentDwellDays: s.dwell.currentDwellDays,
              dwellByStatus: s.dwell.dwellByStatus,
            }
          : null,
        techHelp: s.techHelp,
        engFixes: s.engFixes,
        blurb: s.blurb,
      })),
      validKeys: intelligence.validKeys,
      generatedAt: intelligence.generatedAt,
    };

    return res.json({
      summary,
      intelligence: responseIntelligence,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[oncall-summary] Failed for team=${teamId}`, err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'OnCall summary generation failed');
  }
});

router.post('/release-summary', validateJiraTokenMiddleware, async (req, res) => {
  const { version } = req.body || {};

  if (!version || !version.trim()) {
    return res.status(400).json({ error: 'version is required' });
  }

  const jiraToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    logger.info(`[release-summary] Building intelligence package for ${version}`);
    const intelligence = await buildReleaseIntelligence(version, jiraToken);

    logger.info(
      `[release-summary] Intelligence ready for ${version}: ` +
      `${intelligence.totalFeatures} features, ` +
      `gate-lagging=${intelligence.buckets['gate-lagging'].length}, ` +
      `p0=${intelligence.p0BugsCount}`
    );

    const summary = await generateReleaseSummary(intelligence);

    // Strip large bucket arrays — client only needs counts, P0 list, and must-fix list.
    const responseIntelligence = {
      version: intelligence.version,
      totalFeatures: intelligence.totalFeatures,
      p0BugsCount: intelligence.p0BugsCount,
      p0Bugs: intelligence.p0Bugs,
      mustFixTickets: intelligence.mustFixTickets,
      phaseDist: intelligence.phaseDist,
      selfReportedRisk: intelligence.selfReportedRisk,
      dateMetrics: intelligence.dateMetrics,
      health: intelligence.health,
      bucketCounts: Object.fromEntries(
        Object.entries(intelligence.buckets).map(([k, v]) => [k, v.length])
      ),
      generatedAt: intelligence.generatedAt,
    };

    return res.json({
      summary,
      intelligence: responseIntelligence,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[release-summary] Failed for ${version}`, err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'Release summary generation failed');
  }
});

/**
 * POST /api/ai/sos-tier-summary
 * Team-exec SoS work-tier briefing from a tiny client-assembled packet.
 * No JIRA — auth only.
 */
router.post('/sos-tier-summary', validateJiraTokenMiddleware, async (req, res) => {
  const payload = req.body || {};
  const { release, tier } = payload;
  if (!release) {
    return res.status(400).json({ error: 'release is required' });
  }
  if (!['feat', 'standalone', 'direct'].includes(tier)) {
    return res.status(400).json({ error: "tier must be one of: 'feat', 'standalone', 'direct'" });
  }
  try {
    logger.info(`[sos-tier-summary] Generating ${tier} briefing for ${release}`);
    const summary = await generateSosTierSummary(payload);
    return res.json({
      summary,
      release,
      tier,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[sos-tier-summary] Failed for ${release}/${tier}`, err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured') || err.message?.includes('NAI_API_KEY')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'SoS tier summary generation failed');
  }
});

/**
 * POST /api/ai/sos-overall-summary
 * Cross-release SoS overall brief from a client-assembled rollup packet. No JIRA.
 */
router.post('/sos-overall-summary', validateJiraTokenMiddleware, async (req, res) => {
  const payload = req.body || {};
  try {
    logger.info(`[sos-overall-summary] Generating overall brief (${(payload.releases || []).length} releases)`);
    const summary = await generateSosOverallSummary(payload);
    return res.json({
      summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[sos-overall-summary] Failed', err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured') || err.message?.includes('NAI_API_KEY')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'SoS overall summary generation failed');
  }
});

/**
 * POST /api/ai/sos-leader-release-summary
 * Leader-scoped SoS brief for one eng leader × one release. Client-assembled packet. No JIRA.
 */
router.post('/sos-leader-release-summary', validateJiraTokenMiddleware, async (req, res) => {
  const payload = req.body || {};
  const { release, leaderName } = payload;
  if (!release) {
    return res.status(400).json({ error: 'release is required' });
  }
  try {
    logger.info(`[sos-leader-release-summary] Generating ${leaderName || 'leader'} / ${release}`);
    const summary = await generateSosLeaderReleaseSummary(payload);
    return res.json({
      summary,
      release,
      leaderId: payload.leaderId || null,
      leaderName: leaderName || null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[sos-leader-release-summary] Failed for ${release}`, err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured') || err.message?.includes('NAI_API_KEY')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'SoS leader-release summary generation failed');
  }
});

/**
 * POST /api/ai/sprint-leadership-asks
 * Org-wide Sprint Performance "Asks of leadership" via a sprint-specific
 * prompt (not the release briefing prompt). Body is the compact intelligence
 * packet from buildSprintAsksIntelligence, or a full model object.
 */
router.post('/sprint-leadership-asks', validateJiraTokenMiddleware, async (req, res) => {
  const body = req.body || {};
  try {
    const intelligence = body.overall || body.highlights || body.lowlights || body.seedAsks
      ? body
      : (body.model ? buildSprintAsksIntelligence(body.model) : null);
    if (!intelligence || (!intelligence.lowlights && !intelligence.seedAsks && !intelligence.overall)) {
      return res.status(400).json({
        error: 'intelligence packet required (overall / highlights / lowlights / seedAsks), or { model } from Sprint Performance',
      });
    }
    logger.info(`[sprint-leadership-asks] Generating asks for ${intelligence.teamName || intelligence.teamId || 'unknown'}`);
    const asks = await generateSprintLeadershipAsks(intelligence);
    return res.json({
      asks,
      asksSource: 'ai',
      teamId: intelligence.teamId,
      teamName: intelligence.teamName,
      window: intelligence.window,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[sprint-leadership-asks] Failed', err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured') || err.message?.includes('NAI_API_KEY')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'Sprint leadership asks generation failed');
  }
});

/**
 * POST /api/ai/sos-leader-coaching
 * Per-leader coaching asks from client-supplied SoS items + gates/history/breakdowns.
 * No new JIRA search — auth only. Packet built server-side (release + sprint).
 */
router.post('/sos-leader-coaching', validateJiraTokenMiddleware, async (req, res) => {
  const body = req.body || {};
  const { leaderId, leaderName, items } = body;
  if (!leaderName && !leaderId) {
    return res.status(400).json({ error: 'leaderId or leaderName is required' });
  }
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items array is required' });
  }
  try {
    logger.info(`[sos-leader-coaching] Generating for ${leaderName || leaderId} (${items.length} items)`);
    const result = await generateLeaderCoaching({
      leaderId: body.leaderId || null,
      leaderName: body.leaderName || body.leaderId,
      role: body.role || null,
      items,
      gateDataByRelease: body.gateDataByRelease || {},
      breakdownDataMap: body.breakdownDataMap || {},
      checkpointHistory: body.checkpointHistory || {},
      expectedManagerNames: body.expectedManagerNames || [],
    });
    return res.json({
      asks: result.asks,
      text: result.text,
      packet: result.packet,
      validKeys: result.validKeys,
      source: result.source,
      generatedAt: result.generatedAt,
      error: result.error || null,
    });
  } catch (err) {
    logger.error(`[sos-leader-coaching] Failed for ${leaderName || leaderId}`, err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured') || err.message?.includes('NAI_API_KEY')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'SoS leader coaching generation failed');
  }
});

/**
 * POST /api/ai/weekly-skim
 * Multi-release ADHD email skim: outstanding tiles + serial NAI release summaries.
 * Body: { productId?: string, releases: string[] }
 */
router.post('/weekly-skim', validateJiraTokenMiddleware, async (req, res) => {
  const releases = Array.isArray(req.body?.releases) ? req.body.releases : [];
  const productId = (req.body?.productId || 'ndb').toString().trim() || 'ndb';
  const jiraToken = req.headers.authorization?.replace('Bearer ', '') || req.jiraToken;

  if (!releases.length) {
    return res.status(400).json({ error: 'releases array is required' });
  }

  try {
    logger.info(
      `[weekly-skim] product=${productId} releases=${releases.length}: ${releases.join(', ')}`
    );
    const payload = await generateWeeklySkim({ productId, releases, jiraToken });
    return res.json(payload);
  } catch (err) {
    logger.error('[weekly-skim] Failed', err, { naiDebug: err.naiDebug });
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message?.includes('NAI API key not configured') || err.message?.includes('NAI_API_KEY')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    return naiFailureResponse(res, err, 'Weekly skim generation failed');
  }
});

/**
 * POST /api/ai/page-briefing
 * "What ails the team" — multi-facet NAI (parallel) → stitch → optional compress.
 * Surfaces: release | oncall | kpi | feature
 *
 * Body: {
 *   surface: string,
 *   version?: string,      // release
 *   teamId?: string,       // oncall | kpi
 *   featureKey?: string,   // feature
 *   snapshot?: object      // kpi | feature (client-built metrics)
 * }
 */
router.post(
  '/page-briefing',
  validateJiraTokenMiddleware,
  requireAuth('execAudience'),
  async (req, res) => {
  const surface = (req.body?.surface || '').trim();
  const jiraToken = req.headers.authorization?.replace('Bearer ', '') || req.jiraToken;

  if (!surface) {
    return res.status(400).json({ error: 'surface is required (release|oncall|kpi|feature)' });
  }

  try {
    logger.info(
      `[page-briefing] surface=${surface} version=${req.body?.version || '-'} team=${req.body?.teamId || '-'} user=${req.username || '-'}`
    );
    const result = await buildPageBriefing({
      surface,
      token: jiraToken,
      version: req.body?.version,
      teamId: req.body?.teamId,
      featureKey: req.body?.featureKey,
      snapshot: req.body?.snapshot,
    });
    return res.json(result);
  } catch (err) {
    const status = err.statusCode || 502;
    logger.error(`[page-briefing] Failed surface=${surface}`, err, { naiDebug: err.naiDebug });
    if (err.message?.includes('NAI API key not configured') || err.message?.includes('NAI_API_KEY')) {
      return res.status(400).json({ error: 'NAI_API_KEY not configured on the server' });
    }
    if (status === 400) {
      return res.status(400).json({ error: err.message });
    }
    return naiFailureResponse(res, err, 'Page briefing generation failed');
  }
});

module.exports = router;
