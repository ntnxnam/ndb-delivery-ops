/**
 * Release AI Summary Service
 *
 * Builds a structured intelligence package for a full release by running
 * deriveSignals on every committed feature, then aggregating the results into
 * four buckets the LLM can reason about directly:
 *
 *   gate-lagging   — features that have NOT confirmed clearance of the most
 *                    recently elapsed release-level gate (latestPassedMarker
 *                    says the date passed but JIRA phase doesn't match)
 *   compliance     — features with open security / legal / docs gaps
 *   blocked        — features with open P0/P1 blockers or MISSED GATE risks
 *   dark           — features whose status update is ≥14 days stale
 *   clear          — features at PG Met or Shipped
 *   watching       — everything else (on-track but not yet clear)
 *
 * The service does NOT call the LLM — it returns the structured package so
 * the route can pass it to naiService.generateReleaseSummary.
 */

const axios = require('axios');
const https = require('https');
const { JIRA_API_V2 } = require('../config/api');
const { buildCommitItemsJQL } = require('../utils/jiraQueryUtils');
const { deriveSignals } = require('../utils/execSummarySignals');
const { processAllMilestones } = require('../utils/milestoneProcessor');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');
const logger = require('../utils/logger');

const FIELDS = [
  'key', 'summary', 'status', 'assignee', 'priority',
  'customfield_23560',  // Risk Indicator
  'customfield_11067',  // Code Complete Date
  'customfield_35863',  // Commit Gate Ready Estimation Date
  'customfield_35864',  // Promotion Gate Ready Estimation Date
  'customfield_23073',  // Status Update
  'customfield_45660',  // Status Update Date
  'customfield_10860',  // QA Contact
  'customfield_27764',  // TPM Owner
  'customfield_14463',  // Requirements Link
  'customfield_13861',  // FS/DS Done Date
  'customfield_11068',  // Test Plan Date
  'customfield_31460',  // TCMS Link
  'issuelinks', 'labels',
].join(',');

// Phase ordering — higher index = further along the release
const PHASE_ORDER = {
  'Inception': 0, 'Design': 1, 'Coding': 2, 'Coding (late)': 2,
  'CC Met': 3, 'CG Met': 4, 'PG Met': 5, 'Shipped': 6,
};

function createHttpsAgent() {
  return new https.Agent({ rejectUnauthorized: false });
}

/**
 * Build a ganttConfig-shaped object from the release versions email config.
 * This mirrors what the client builds when it loads gantt data.
 */
function buildGanttConfig(version) {
  try {
    const cfg = releaseVersionsEmailConfig.releaseGateDates?.[version];
    if (!cfg) return null;
    return cfg;
  } catch {
    return null;
  }
}

/**
 * Classify a single feature's signals into one of the bucket labels.
 * A feature may appear in multiple buckets (e.g. both gate-lagging AND dark).
 */
function classifyFeature(signals) {
  const buckets = new Set();
  const s = signals;

  // Shipped / PG Met → clear
  if (s.phase === 'Shipped' || s.phase === 'PG Met') {
    buckets.add('clear');
    return [...buckets];
  }

  // MISSED GATE or explicit P0/P1 blocker → blocked
  const hasMissedGate = (s.criticalRisks || []).some(r => r.startsWith('MISSED GATE'));
  if (hasMissedGate) buckets.add('gate-lagging');

  // Compliance gap → compliance bucket
  const comp = s.compliance;
  if (comp) {
    const hasGap = (!comp.security?.filed || !comp.legal?.filed);
    if (hasGap) buckets.add('compliance');
  }

  // P0/P1 open blockers mentioned in criticalRisks
  const hasBlocker = (s.criticalRisks || []).some(r =>
    /P0|P1|blocker/i.test(r) && !r.startsWith('MISSED GATE')
  );
  if (hasBlocker) buckets.add('blocked');

  // Stale status update ≥14 days
  if (s.statusUpdate?.ageDays != null && s.statusUpdate.ageDays >= 14) {
    buckets.add('dark');
  }

  // Gate overshoot without clearance
  const cgOvershoot = s.dates?.commitGate?.overshootMarker;
  const pgOvershoot = s.dates?.promotionGate?.overshootMarket;
  const cgMet = ['CG Met', 'PG Met', 'Shipped'].includes(s.phase);
  const pgMet = ['PG Met', 'Shipped'].includes(s.phase);
  if (cgOvershoot && parseInt(cgOvershoot) > 0 && !cgMet) buckets.add('gate-lagging');
  if (pgOvershoot && parseInt(pgOvershoot) > 0 && !pgMet) buckets.add('gate-lagging');

  if (buckets.size === 0) buckets.add('watching');

  return [...buckets];
}

/**
 * Build a compact feature record for LLM consumption.
 * Keeps only the fields the prompt actually uses — avoids token bloat.
 */
function buildFeatureRecord(item, signals) {
  const f = item.fields || {};
  const riskRaw = f.customfield_23560;
  const riskVal = riskRaw
    ? (typeof riskRaw === 'object' ? (riskRaw.value || riskRaw.name || '') : String(riskRaw))
    : 'not set';

  return {
    key: item.key,
    summary: (f.summary || '').slice(0, 80),
    status: f.status?.name || 'Unknown',
    jiraRisk: riskVal,
    phase: signals.phase,
    phaseRationale: signals.phaseRationale,
    latestPassedMarker: signals.latestPassedMarker,
    criticalRisks: signals.criticalRisks || [],
    nextGate: signals.nextGate,
    assignee: f.assignee?.displayName || f.assignee?.name || 'Unassigned',
    tpmOwner: f.customfield_27764?.displayName || f.customfield_27764?.name || null,
    statusUpdateAgeDays: signals.statusUpdate?.ageDays ?? null,
    compliance: signals.compliance,
    dates: {
      codeComplete: signals.dates?.codeComplete?.effectiveValue || null,
      commitGate: signals.dates?.commitGate?.value || null,
      promotionGate: signals.dates?.promotionGate?.value || null,
    },
    buckets: classifyFeature(signals),
  };
}

/**
 * Fetch all committed features for a release version and build the
 * structured release intelligence package.
 *
 * @param {string} version  e.g. "NDB-2.12"
 * @param {string} jiraToken
 * @returns {Promise<object>} releaseIntelligence
 */
async function buildReleaseIntelligence(version, jiraToken) {
  const ganttConfig = buildGanttConfig(version);
  const versionLabel = version.toLowerCase();

  // Committed features — same scope as the UI commit section:
  // fixVersion = version, Feature/Initiative, not cancelled, not long-term-funded.
  const commitJql = `${buildCommitItemsJQL(version)} AND labels != "${versionLabel}-long-term-funded"`;
  const response = await axios.get(JIRA_API_V2.SEARCH, {
    headers: { Authorization: `Bearer ${jiraToken}`, 'Content-Type': 'application/json' },
    params: { jql: commitJql, fields: FIELDS, maxResults: 500 },
    httpsAgent: createHttpsAgent(),
    timeout: 45000,
  });

  const rawItems = response.data?.issues || [];

  // Date metrics for the prompt header (gate dates, daysFromCutoff)
  let dateMetrics = null;
  try {
    const cfg = releaseVersionsEmailConfig.releaseGateDates?.[version];
    if (cfg) dateMetrics = processAllMilestones(cfg);
  } catch (e) {
    logger.warn(`[releaseAiSummaryService] Could not load date metrics for ${version}: ${e.message}`);
  }

  // Fetch open P0 blockers with keys + summaries so the LLM can name them
  let p0Bugs = [];
  try {
    const filterName = `${versionLabel}-all`;
    const p0Resp = await axios.get(JIRA_API_V2.SEARCH, {
      headers: { Authorization: `Bearer ${jiraToken}`, 'Content-Type': 'application/json' },
      params: {
        jql: `filter = "${filterName}" AND statusCategory != Done AND priority = "P0 - Blocker"`,
        fields: 'key,summary,assignee,status',
        maxResults: 50,
      },
      httpsAgent: createHttpsAgent(),
      timeout: 15000,
    });
    p0Bugs = (p0Resp.data?.issues || []).map(i => ({
      key: i.key,
      summary: (i.fields?.summary || '').slice(0, 100),
      assignee: i.fields?.assignee?.displayName || i.fields?.assignee?.name || 'Unassigned',
      status: i.fields?.status?.name || 'Unknown',
    }));
  } catch (e) {
    logger.warn(`[releaseAiSummaryService] P0 fetch failed for ${version}: ${e.message}`);
  }

  // Fetch open must-fix tickets (label = "<version>-mustfix"), any issue type
  let mustFixTickets = [];
  try {
    const mustFixResp = await axios.get(JIRA_API_V2.SEARCH, {
      headers: { Authorization: `Bearer ${jiraToken}`, 'Content-Type': 'application/json' },
      params: {
        jql: `labels = "${versionLabel}-mustfix" AND statusCategory != Done`,
        fields: 'key,summary,assignee,status,priority,issuetype',
        maxResults: 100,
      },
      httpsAgent: createHttpsAgent(),
      timeout: 15000,
    });
    mustFixTickets = (mustFixResp.data?.issues || []).map(i => ({
      key: i.key,
      summary: (i.fields?.summary || '').slice(0, 100),
      assignee: i.fields?.assignee?.displayName || i.fields?.assignee?.name || 'Unassigned',
      status: i.fields?.status?.name || 'Unknown',
      priority: i.fields?.priority?.name || 'Unknown',
      issueType: i.fields?.issuetype?.name || 'Unknown',
    }));
  } catch (e) {
    logger.warn(`[releaseAiSummaryService] Must-fix fetch failed for ${version}: ${e.message}`);
  }

  // Run deriveSignals on each feature (sync, CPU-only — no extra JIRA calls)
  const today = new Date();
  const featureRecords = rawItems.map(item => {
    try {
      const signals = deriveSignals({ item: { ...item.fields, key: item.key }, ganttConfig, release: version, today });
      return buildFeatureRecord(item, signals);
    } catch (e) {
      logger.warn(`[releaseAiSummaryService] deriveSignals failed for ${item.key}: ${e.message}`);
      return {
        key: item.key,
        summary: (item.fields?.summary || '').slice(0, 80),
        phase: 'Unknown',
        criticalRisks: [],
        buckets: ['watching'],
        error: e.message,
      };
    }
  });

  // Aggregate into buckets
  const buckets = {
    'gate-lagging': [],
    'compliance': [],
    'blocked': [],
    'dark': [],
    'watching': [],
    'clear': [],
  };
  for (const rec of featureRecords) {
    for (const b of rec.buckets) {
      buckets[b].push(rec);
    }
  }

  // Phase distribution (for the RAG headline)
  const phaseDist = {};
  for (const rec of featureRecords) {
    phaseDist[rec.phase] = (phaseDist[rec.phase] || 0) + 1;
  }

  // jiraRisk counts (self-reported by teams — kept for context)
  const selfReportedRisk = { red: 0, yellow: 0, green: 0, notSet: 0 };
  for (const rec of featureRecords) {
    const v = (rec.jiraRisk || '').toLowerCase();
    if (v.includes('red') || v.includes('high') || v.includes('critical')) selfReportedRisk.red++;
    else if (v.includes('yellow') || v.includes('medium') || v.includes('at risk')) selfReportedRisk.yellow++;
    else if (v.includes('green') || v.includes('on track') || v.includes('low')) selfReportedRisk.green++;
    else selfReportedRisk.notSet++;
  }

  return {
    version,
    totalFeatures: featureRecords.length,
    p0BugsCount: p0Bugs.length,
    p0Bugs,
    mustFixTickets,
    phaseDist,
    selfReportedRisk,
    dateMetrics,
    buckets,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildReleaseIntelligence };
