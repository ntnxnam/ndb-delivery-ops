/**
 * AI routes — executive summary generation and JIRA field updates.
 * Mounted at /api/ai
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { generateExecSummary } = require('../services/naiService');
const { deriveSignals } = require('../utils/execSummarySignals');
const { fetchTicketNarrative } = require('../utils/jiraTicketNarrative');
const { JIRA_API_V2 } = require('../config/api');
const logger = require('../utils/logger');

const EXEC_SUMMARY_FIELD = 'customfield_38460';

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
  const { item, ganttConfig = null, breakdownData = null, release = null } = req.body || {};

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
    const signals = deriveSignals({ item, ganttConfig, breakdownData, narrative, release, today: new Date() });

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

module.exports = router;
