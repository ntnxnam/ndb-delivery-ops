/**
 * OnCalls V2 — timeframe-aware orchestrator.
 * Reuses shared helpers from oncallConfigResolve (baseJql, oncallSeedJql, openJql, etc.)
 * Implements TIMEFRAMES, timeframeToDays, timeframeClause, buildTimeframeHeroQueries,
 * workflow buckets, gap taxonomy, NDB sub-drill, health MTTR throughput heroes, pulse window override.
 */

const { getJira, searchPages } = require('../utils/jiraClient');
const {
  resolveRuntimeConfig,
  baseJql,
  oncallSeedJql,
  openJql,
  linkedOutJql,
  buildHeroQueries,
  cell,
  andParts,
  keysInJql,
} = require('./oncallConfigResolve');
const { SimpleCache } = require('../utils/simpleCache');
const heroCache = new SimpleCache(5 * 60 * 1000); // 5m hero cache per team:timeframe
const { fetchOpenStacks, emptyStackData, buildPathCells, mapTicketRows, topN } = require('./oncallStacksService');
const { buildPulse } = require('./kpiPulseService');
const { classifyGapBuckets, buildGapCells, classifyNdbSubGaps, buildNdbSubCells } = require('./oncallGapService');
const logger = require('../utils/logger');

const TIMEFRAMES = {
  '7d': 7,
  '15d': 15,
  '1M': 30,
  '1Q': 90,
  '2Q': 180,
  '1Y': 365,
  '18M': 540,
  'Overall': null,
};

function timeframeToDays(tf) {
  if (!tf) return TIMEFRAMES['2Q'];
  const key = String(tf).trim();
  if (Object.prototype.hasOwnProperty.call(TIMEFRAMES, key)) return TIMEFRAMES[key];
  // also accept lowercase
  const upper = key.toUpperCase();
  for (const k of Object.keys(TIMEFRAMES)) {
    if (k.toUpperCase() === upper) return TIMEFRAMES[k];
  }
  return TIMEFRAMES['2Q'];
}

/**
 * Build timeframe date clause: field >= -days. Overall = no date clause (all history) — returns null so caller omits the clause.
 */
function timeframeClause(field, tf) {
  const days = timeframeToDays(tf);
  if (days == null) return null; // Overall = no date clause (all history)
  const f = String(field || 'resolved').trim() || 'resolved';
  return `${f} >= -${days}d`;
}

function buildTimeframeHeroQueries(cfg, timeframe) {
  const base = buildHeroQueries(cfg);
  const seed = oncallSeedJql(cfg);
  const open = openJql(cfg);
  const doneJql = cfg.doneStatusJql || 'statusCategory = Done';
  const clause = timeframeClause('resolved', timeframe);
  // Use resolved field; if Overall, closedInWindow = seed AND done only (no date clause)
  const closedInWindow = clause
    ? andParts(seed, doneJql, clause)
    : andParts(seed, doneJql);
  // workflow buckets — canonical status values (JIRA status names are exact); use single value per cfg
  const needInfoStatus = cfg.needInfoStatus || 'Need Info';
  const waitingStatus = cfg.waitingForCustomerStatus || 'Waiting for Customer';
  const needInfoOpen = andParts(open, `status = "${needInfoStatus}"`);
  const waitingCustomerOpen = andParts(open, `status = "${waitingStatus}"`);
  return {
    ...base,
    closedInWindow,
    needInfoOpen,
    waitingCustomerOpen,
  };
}

async function runCounts(token, queries, concurrency = 6) {
  const jira = await getJira(token);
  const keys = Object.keys(queries);
  const results = {};
  const errors = {};
  let idx = 0;
  async function worker() {
    while (idx < keys.length) {
      const i = idx;
      idx += 1;
      const k = keys[i];
      const jql = queries[k];
      if (!jql) {
        results[k] = 0;
        continue;
      }
      try {
        results[k] = await jira.searchCount(jql);
      } catch (err) {
        errors[k] = err.message || String(err);
        results[k] = 0;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { results, errors };
}

function computeWorkflowBuckets(openStacks) {
  const stacks = Array.isArray(openStacks) ? openStacks : (openStacks.stacks || []);
  let needInfo = 0;
  let waiting = 0;
  for (const s of stacks) {
    const status = String(s.status || '').toLowerCase().trim();
    if (status === 'need info') needInfo += 1;
    else if (status === 'waiting for customer') waiting += 1;
  }
  return { needInfo, waiting };
}

async function fetchClosedStacks(token, cfg, timeframe) {
  const seed = oncallSeedJql(cfg);
  const doneJql = cfg.doneStatusJql || 'statusCategory = Done';
  const clause = timeframeClause('resolved', timeframe);
  const jql = clause ? andParts(seed, doneJql, clause) : andParts(seed, doneJql);
  // fetch with pagination — cap at maxPastIssuesFetch or 500 for gap taxonomy
  const maxTotal = cfg.maxPastIssuesFetch || 200;
  // include resolution field for dud detection — cap 200 for initial paint, not 500
  const issues = await searchPages(token, jql, 'key,summary,status,priority,assignee,created,updated,resolution,resolutiondate,issuelinks,labels,issuetype,components', {
    pageSize: 50,
    maxTotal: Math.min(maxTotal, 200),
    timeoutMs: 30000,
    delayMs: 100,
  });
  // reuse classifyStacksFromIssues logic manually — but we need full stack shape
  const { classifyStacksFromIssues } = require('./oncallStacksService');
  const classified = classifyStacksFromIssues(issues, cfg, { sortBy: 'resolved' });
  return { stacks: classified.stacks, jql };
}

function toIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computePulseWindow(timeframe) {
  const days = timeframeToDays(timeframe);
  if (days == null) return null; // Overall = no window override → default 2Q pulse
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
    label: timeframe === 'Overall' ? 'Overall' : `Last ${timeframe}`,
  };
}

async function getDashboard({ token, teamId, timeframe } = {}) {
  const tf = timeframe && TIMEFRAMES.hasOwnProperty(String(timeframe).trim()) ? String(timeframe).trim() : (timeframe ? String(timeframe).trim() : '7d');
  const normalizedTf = Object.keys(TIMEFRAMES).find((k) => k.toLowerCase() === tf.toLowerCase()) || '7d';
  const cfg = resolveRuntimeConfig(teamId);
  if (!cfg.baseScopeJql || !String(cfg.baseScopeJql).trim()) {
    return {
      teamId: cfg.teamId,
      timeframe: normalizedTf,
      notConfigured: true,
      message: `OnCalls not configured for team "${cfg.teamId}". Add an OnCalls KPI in Admin → KPIs or configure oncallConfig.json.`,
      baseScopeJql: '',
      hero: {}, paths: {}, past: {}, rag: { level: 'GREEN', why: 'Not configured' }, escalation: null, pulse: null, priorityMix: [], assigneeMix: [], openTickets: [], stacksPreview: [], errors: undefined,
      workflow: { needInfo: cell(0, null), waiting: cell(0, null) },
      gapTaxonomy: { duds: cell(0, null), ndbGaps: cell(0, null), otherTeamGaps: cell(0, null), ndbSub: { thLinked: cell(0, null), bugs: cell(0, null), improvements: cell(0, null), other: cell(0, null) } },
      health: { mttrMedian: null, p90: null, net: 0 },
    };
  }

  const queries = buildTimeframeHeroQueries(cfg, normalizedTf);
  const t0 = Date.now();
  // Parallelize independent JIRA fetches (was serial, now ~40% faster)
  const outJql = linkedOutJql(cfg);
  const windowOverride = computePulseWindow(normalizedTf);
  const pulseOpts = (() => {
    if (!cfg.baseScopeJql) return null;
    // OnCalls: all are P0 by project, so p0/p1 tiles are noise — hide them (learning #7)
    const opts = { token, baseJql: cfg.baseScopeJql, optionalHeroes: {}, agedOpenDays: cfg.agedOpenDays };
    if (windowOverride) opts.window = windowOverride;
    return opts;
  })();

  const [countsRes, openRes, closedRes, linkedOutRes, pulseRes] = await Promise.allSettled([
    runCounts(token, queries),
    fetchOpenStacks(token, cfg).catch((e) => { throw e; }),
    fetchClosedStacks(token, cfg, normalizedTf).catch((e) => { throw e; }),
    outJql ? getJira(token).then((jira) => jira.searchCount(outJql)) : Promise.resolve(0),
    pulseOpts ? buildPulse(pulseOpts) : Promise.resolve(null),
  ]);

  const errors = {};
  const results = countsRes.status === 'fulfilled' ? countsRes.value.results : {};
  if (countsRes.status === 'rejected') errors.counts = countsRes.reason?.message || String(countsRes.reason);
  else if (countsRes.value.errors) Object.assign(errors, countsRes.value.errors);

  let openData = countsRes.status === 'fulfilled' ? emptyStackData() : emptyStackData();
  if (openRes.status === 'fulfilled') openData = openRes.value;
  else errors.openStacks = openRes.reason?.message || String(openRes.reason);

  let closedStacks = [];
  if (closedRes.status === 'fulfilled') closedStacks = closedRes.value.stacks;
  else errors.closedStacks = closedRes.reason?.message || String(closedRes.reason);

  let linkedOutCount = 0;
  if (linkedOutRes.status === 'fulfilled') linkedOutCount = linkedOutRes.value;
  else errors.linkedOut = linkedOutRes.reason?.message || String(linkedOutRes.reason);

  let pulse = null;
  if (pulseRes.status === 'fulfilled') pulse = pulseRes.value;
  else if (pulseOpts) errors.pulse = pulseRes.reason?.message || String(pulseRes.reason);

  const hero = {
    open: cell(results.open, queries.open),
    agedOpen: cell(results.agedOpen, queries.agedOpen),
    needInfoOpen: cell(results.needInfoOpen, queries.needInfoOpen),
    waitingCustomerOpen: cell(results.waitingCustomerOpen, queries.waitingCustomerOpen),
    closedInWindow: cell(results.closedInWindow, queries.closedInWindow),
    all: cell(results.all, queries.all),
    // legacy compat
    closed7d: cell(results.closed7d, queries.closed7d),
    created7d: cell(results.created7d, queries.created7d),
    p0Open: cell(results.p0Open, queries.p0Open),
    p1Open: cell(results.p1Open, queries.p1Open),
  };

  const workflowBuckets = computeWorkflowBuckets(openData.stacks);
  const workflow = {
    needInfo: cell(workflowBuckets.needInfo, queries.needInfoOpen),
    waiting: cell(workflowBuckets.waiting, queries.waitingCustomerOpen),
  };

  // Gap taxonomy
  let gapTaxonomy = { duds: cell(0, null), ndbGaps: cell(0, null), otherTeamGaps: cell(0, null), ndbSub: { thLinked: cell(0, null), bugs: cell(0, null), improvements: cell(0, null), other: cell(0, null) } };
  let gapMeta = null;
  try {
    const buckets = classifyGapBuckets(closedStacks, cfg);
    const cells = buildGapCells(buckets, cfg);
    const ndbSubBuckets = classifyNdbSubGaps(buckets.ndbGaps, cfg);
    const ndbSubCells = buildNdbSubCells(ndbSubBuckets, cfg);
    gapTaxonomy = {
      duds: cells.duds,
      ndbGaps: cells.ndbGaps,
      otherTeamGaps: cells.otherTeamGaps,
      ndbSub: ndbSubCells,
    };
    gapMeta = {
      dudsKeys: buckets.duds.keys,
      ndbGapsKeys: buckets.ndbGaps.keys,
      otherTeamGapsKeys: buckets.otherTeamGaps.keys,
      ndbSubKeys: {
        thLinked: ndbSubBuckets.thLinked.keys,
        bugs: ndbSubBuckets.bugs.keys,
        improvements: ndbSubBuckets.improvements.keys,
        other: ndbSubBuckets.other.keys,
      },
    };
  } catch (err) {
    errors.gapTaxonomy = err.message || String(err);
  }

  // pulse already fetched in parallel above (pulseRes); gap taxonomy already computed from closedStacks

  const health = {
    mttrMedian: pulse?.mttr?.medianDays ?? null,
    p90: pulse?.mttr?.p90Days ?? null,
    net: pulse?.heroes?.netBurn?.count ?? 0,
    throughput: pulse?.heroes?.resolvedWindow?.count ?? 0,
    agedShare: (() => {
      const openN = hero.open?.count || 0;
      const agedN = hero.agedOpen?.count || 0;
      if (!openN) return 0;
      return Math.round((agedN / openN) * 100);
    })(),
    churn: pulse?.heroes?.createdWindow?.count ?? 0,
  };

  // Paths compat — reuse old openData path cells
  const openTotal = results.open || 0;
  const openFetched = openData.pathStats.openFetched || 0;
  // componentMix for hotspot (B3) — aggregate from open stacks components field
  const compMix = {};
  for (const s of openData.stacks || []) {
    const comps = s.components || s.fields?.components || [];
    const list = Array.isArray(comps) ? comps : (s.component ? [s.component] : []);
    for (const c of list) {
      const name = typeof c === 'string' ? c : (c.name || c.key || '');
      if (!name) continue;
      compMix[name] = (compMix[name] || 0) + 1;
    }
  }
  const componentMix = topN(compMix, 6);

  // fallback: if no components, derive from linked project mix for hotspot visibility
  const effectiveComponentMix = componentMix.length ? componentMix : topN(openData.priorityMix, 6);

  const paths = {
    ...buildPathCells(openData.pathStats, { linkedOutCell: cell(linkedOutCount, outJql) }),
    sample: { openTotal, openFetched, capped: openFetched < openTotal, maxOpenIssuesFetch: cfg.maxOpenIssuesFetch, universe: 'oncall_seeds' },
  };

  return {
    teamId: cfg.teamId,
    onCallProject: cfg.onCallProject,
    baseScopeJql: cfg.baseScopeJql,
    techHelpProjects: cfg.techHelpProjects,
    engFixProjects: cfg.engFixProjects,
    agedOpenDays: cfg.agedOpenDays,
    needInfoDays: cfg.needInfoDays,
    waitingForCustomerDays: cfg.waitingForCustomerDays,
    jiraBaseUrl: cfg.jiraBaseUrl,
    asOf: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    timeframe: normalizedTf,
    hero,
    workflow,
    gapTaxonomy,
    gapMeta,
    health,
    pulse,
    paths,
    priorityMix: topN(openData.priorityMix),
    assigneeMix: topN(openData.assigneeMix),
    componentMix: effectiveComponentMix,
    openTickets: mapTicketRows(openData.stacks),
    stacksPreview: openData.stacks.slice(0, 40).map((s) => ({
      key: s.key,
      summary: s.summary,
      status: s.status,
      priority: s.priority,
      assignee: s.assignee,
      ageDays: s.ageDays,
      techHelpCount: s.techHelp.length,
      engFixCount: s.engFixes.length,
      techPubsCount: (s.techPubs || []).length,
      knowledgeCount: (s.knowledge || []).length,
      techHelpKeys: s.techHelp.map((t) => t.key),
      engFixKeys: s.engFixes.map((e) => e.key),
      techPubsKeys: (s.techPubs || []).map((t) => t.key),
      knowledgeKeys: (s.knowledge || []).map((k) => k.key),
    })),
    openFetched: openData.pathStats.openFetched,
    closedStacksPreview: closedStacks.slice(0, 20).map((s) => ({ key: s.key, summary: s.summary, resolution: s.resolution, status: s.status })),
    errors: Object.keys(errors).length ? errors : undefined,
  };
}

module.exports = {
  TIMEFRAMES,
  timeframeToDays,
  timeframeClause,
  buildTimeframeHeroQueries,
  computeWorkflowBuckets,
  getDashboard,
};
