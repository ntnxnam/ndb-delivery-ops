/**
 * AI routes — executive summary generation and JIRA field updates.
 * Mounted at /api/ai
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { generateExecSummary, generateReleaseSummary } = require('../services/naiService');
const { answerChat } = require('../services/chatService');
const { deriveSignals } = require('../utils/execSummarySignals');
const { buildReleaseIntelligence } = require('../services/releaseAiSummaryService');
const { fetchTicketNarrative } = require('../utils/jiraTicketNarrative');
const { JIRA_API_V2 } = require('../config/api');
const logger = require('../utils/logger');

const EXEC_SUMMARY_FIELD = 'customfield_38460';

/**
 * POST /api/ai/chat
 * Conversational AI endpoint backed by the same NAI connection as the existing
 * summary endpoints.
 *
 * Body:
 * {
 *   message: string,
 *   history?: [{ role: "user"|"assistant", content: string }],
 *   release?: string,
 *   productId?: string,
 *   availableReleases?: string[],
 *   knownTeams?: string[]
 * }
 */
router.post('/chat', validateJiraTokenMiddleware, async (req, res) => {
  const {
    message,
    history = [],
    release = null,
    productId = 'ndb',
    availableReleases = [],
    knownTeams = [],
  } = req.body || {};

  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const jiraToken = req.headers.authorization?.replace('Bearer ', '');
    const result = await answerChat({
      message,
      history,
      defaultRelease: release,
      productId,
      jiraToken,
      availableReleases,
      knownTeams,
    });

    return res.json({
      reply: result.reply,
      scope: result.scope,
      snapshotMeta: result.snapshotMeta,
    });
  } catch (err) {
    logger.error('[ai/chat] failed', err, { naiDebug: err.naiDebug });
    return res.status(502).json({ error: err.message || 'Chat request failed' });
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
    return res.status(502).json({ error: err.message || 'NAI request failed' });
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

  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  try {
    await axios.put(
      JIRA_API_V2.ISSUE(encodeURIComponent(key)),
      { fields: { [EXEC_SUMMARY_FIELD]: summary } },
      {
        headers: {
          Authorization: `Bearer ${jiraToken}`,
          'Content-Type': 'application/json',
        },
        httpsAgent,
        timeout: 15000,
      }
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
 * server/utils/execSummarySignals.js and the CLOSEST-DATE-THAT-PASSED RULE
 * in naiService.js for the full logic.
 */
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
      return res.status(400).json({ error: 'AI_API_KEY not configured on the server' });
    }
    return res.status(502).json({ error: err.message || 'Release summary generation failed' });
  }
});

module.exports = router;
