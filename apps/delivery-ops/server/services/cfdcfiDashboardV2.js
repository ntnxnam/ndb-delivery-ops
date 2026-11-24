/**
 * CFD/CFI V2 — timeframe-aware orchestrator.
 * Mirrors oncallDashboardV2: hero counts + stacks + linkedOut + pulse + boomerang in parallel.
 */

const { getJira, searchPages } = require('../utils/jiraClient');
const {
  resolveRuntimeConfig,
  baseJql,
  cfdcfiSeedJql,
  openJql,
  linkedOutJql,
  buildHeroQueries,
  cell,
  andParts,
  keysInJql,
} = require('./cfdcfiConfigResolve');
const { SimpleCache } = require('../utils/simpleCache');
const heroCache = new SimpleCache(5 * 60 * 1000);
const { fetchOpenStacks, emptyStackData, buildPathCells, mapTicketRows, topN, classifyStacksFromIssues } = require('./cfdcfiStacksService');
const { buildPulse } = require('./kpiPulseService');
const logger = require('../utils/logger');

const TIMEFRAMES = { '7d': 7, '15d': 15, '1M': 30, '1Q': 90, '2Q': 180, '1Y': 365, '18M': 540, Overall: null };

function timeframeToDays(tf) {
  if (!tf) return TIMEFRAMES['7d'];
  const key = String(tf).trim();
  if (Object.prototype.hasOwnProperty.call(TIMEFRAMES, key)) return TIMEFRAMES[key];
  const upper = key.toUpperCase();
  for (const k of Object.keys(TIMEFRAMES)) if (k.toUpperCase() === upper) return TIMEFRAMES[k];
  return TIMEFRAMES['7d'];
}

function timeframeClause(field, tf) {
  const days = timeframeToDays(tf);
  if (days == null) return null;
  const f = String(field || 'resolved').trim() || 'resolved';
  return `${f} >= -${days}d`;
}

function computePulseWindow(timeframe) {
  const days = timeframeToDays(timeframe);
  if (days == null) return null;
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const toIso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { start: toIso(start), end: toIso(end), label: timeframe === 'Overall' ? 'Overall' : `Last ${timeframe}` };
}

function buildTimeframeHeroQueries(cfg, timeframe) {
  const base = buildHeroQueries(cfg);
  const seed = cfdcfiSeedJql(cfg);
  const doneJql = cfg.doneStatusJql || 'statusCategory = Done';
  const clause = timeframeClause('resolved', timeframe);
  const closedInWindow = clause ? andParts(seed, doneJql, clause) : andParts(seed, doneJql);
  return { ...base, closedInWindow };
}

// Top qualifier sub-clauses per D1 company-wide locked definition — literals from kpiConfig.json TOP qualifier
// (priority in ("Blocker - P0","Critical - P1") AND (...)) OR labels in (NPS_Impacting). Not product-specific filters (D1 clean).
const TOP_QUALIFIER_SUBCLAUSES = [
  { key: 'oncallLinked', label: 'ONCALL-linked', jql: 'issueFunction in linkedIssuesOf("Project = ONCALL")' },
  { key: 'sfCases5', label: 'SF cases ≥5', jql: '"Number of Salesforce Cases" >= 5' },
  { key: 'eelLabels', label: 'EELIST/DevEx/Serviceability', jql: 'labels in (EELIST, DevEx-Top-Issue, Serviceability-Promoted)' },
  { key: 'impact', label: 'Impact (Unavailability/Data Loss/Corruption)', jql: '"Number of Salesforce Cases" >= 1 AND Impact in ("Unavailability - Permanent", "Data Loss", Corruption)' },
  { key: 'nps', label: 'NPS_Impacting', jql: 'labels in (NPS_Impacting)' },
];

function buildCustomerFoundQueries(cfg, baseScope) {
  const base = String(baseScope || (cfg && cfg.baseScopeJql) || '').trim();
  const openStatus = String((cfg && cfg.openStatusJql) || 'statusCategory != Done').trim();
  if (!base) return {};
  const out = {};
  for (const s of TOP_QUALIFIER_SUBCLAUSES) {
    // Each JQL = (baseScope) AND (subClause) AND (openStatusJql) — use andParts(baseScope, subClause, openJql)
    out[s.key] = andParts(`(${base})`, `(${s.jql})`, `(${openStatus})`);
  }
  return out;
}

async function fetchCustomerFoundBreakdown(token, cfg, baseScope) {
  const base = String(baseScope || (cfg && cfg.baseScopeJql) || '').trim();
  if (!base) return [];
  const queries = buildCustomerFoundQueries(cfg, base);
  const keys = Object.keys(queries);
  if (!keys.length) return [];
  const { results } = await runCounts(token, queries);
  return TOP_QUALIFIER_SUBCLAUSES.map((s) => ({ key: s.key, label: s.label, count: results[s.key] ?? 0, jql: queries[s.key] }));
}

// Backwards-compat alias — existing code calls fetchCustomerFound(token,cfg)
async function fetchCustomerFound(token, cfg, baseScope) {
  return fetchCustomerFoundBreakdown(token, cfg, baseScope || (cfg && cfg.baseScopeJql));
}

async function runCounts(token, queries, concurrency = 6) {
  const jira = await getJira(token);
  const keys = Object.keys(queries);
  const results = {};
  const errors = {};
  let idx = 0;
  async function worker() {
    while (idx < keys.length) {
      const i = idx; idx += 1;
      const k = keys[i]; const jql = queries[k];
      if (!jql) { results[k] = 0; continue; }
      try { results[k] = await jira.searchCount(jql); } catch (err) { errors[k] = err.message || String(err); results[k] = 0; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { results, errors };
}

async function fetchClosedCfdcfiStacks(token, cfg, timeframe) {
  const seed = cfdcfiSeedJql(cfg);
  const doneJql = cfg.doneStatusJql || 'statusCategory = Done';
  const clause = timeframeClause('resolved', timeframe);
  const jql = clause ? andParts(seed, doneJql, clause) : andParts(seed, doneJql);
  const maxTotal = cfg.maxPastIssuesFetch || 200;
  const issues = await searchPages(token, jql, 'key,summary,status,priority,assignee,created,updated,resolution,resolutiondate,issuelinks,labels,issuetype,components,fixVersions', { pageSize: 50, maxTotal: Math.min(maxTotal, 200), timeoutMs: 30000, delayMs: 100 });
  const classified = classifyStacksFromIssues(issues, cfg, { sortBy: 'resolved' });
  return { stacks: classified.stacks, jql };
}

async function fetchLinkedOut(token, cfg) {
  const outJql = linkedOutJql(cfg);
  if (!outJql) return 0;
  const jira = await getJira(token);
  return jira.searchCount(outJql);
}

// Deferred boomerang: labels in (ndb-*-deferred) ∩ CFD/CFI baseScope membership by key
async function fetchDeferredBoomerangs(token, cfg) {
  // Enumerate deferred labels by scanning team releases or use known ndb-*-deferred pattern
  let releaseNames = [];
  try {
    const emailConfigPath = require('path').join(__dirname, '../config/releaseVersionsEmailConfig.json');
    const raw = require('fs').readFileSync(emailConfigPath, 'utf8');
    const emailCfg = raw && raw.trim() ? JSON.parse(raw) : {};
    releaseNames = Object.keys(emailCfg.releaseGateDates || {});
  } catch (_) {}
  const labels = releaseNames.length
    ? releaseNames.map((v) => `${String(v).toLowerCase()}-deferred`)
    : [];
  // Fallback: wildcard scan via JQL — but we need concrete labels, so try config-derived first
  if (!labels.length) {
    // No releases — try ndb-deferred pattern guess from label taxonomy fallback
    try {
      const { getLabelPattern } = require('../utils/jiraFieldsConfig');
      // lifecycle.deferred pattern is {prefix}-{version}-deferred; without versions we can't enumerate
      void getLabelPattern;
    } catch (_) {}
    return { boomerangs: [], boomerangRate: 0, gapMeta: {}, boomerangCells: {} };
  }
  const deferredJql = `labels in (${labels.map((l) => `"${l.replace(/"/g, '\\"')}"`).join(', ')})`;
  // Fetch deferred issues keys (cap 200)
  let deferredKeys = [];
  try {
    const deferredIssues = await searchPages(token, deferredJql, 'key,labels,fixVersions,components', { pageSize: 50, maxTotal: 200, timeoutMs: 30000, delayMs: 100 });
    deferredKeys = (deferredIssues || []).map((iss) => iss.key).filter(Boolean);
  } catch (_) { return { boomerangs: [], boomerangRate: 0, gapMeta: {}, boomerangCells: {} }; }
  if (!deferredKeys.length) return { boomerangs: [], boomerangRate: 0, deferredTotal: 0, gapMeta: { boomerangKeys: [] }, boomerangCells: {} };

  // Membership check: which deferred keys also match CFD/CFI baseScopeJql
  const baseScope = String(cfg.baseScopeJql || '').trim();
  if (!baseScope) return { boomerangs: [], boomerangRate: 0, deferredTotal: deferredKeys.length, gapMeta: { boomerangKeys: [] }, boomerangCells: {} };

  let boomerangKeys = [];
  try {
    const chunkSize = 80;
    for (let i = 0; i < deferredKeys.length; i += chunkSize) {
      const chunk = deferredKeys.slice(i, i + chunkSize);
      const jql = `key in (${chunk.join(',')}) AND (${baseScope})`;
      const jira = await getJira(token);
      const res = await jira.get('/rest/api/2/search', { params: { jql, fields: 'key', maxResults: chunk.length, startAt: 0 } });
      for (const iss of res?.data?.issues || []) if (iss?.key) boomerangKeys.push(iss.key);
    }
  } catch (_) { boomerangKeys = []; }

  const rate = deferredKeys.length ? Math.round((boomerangKeys.length / deferredKeys.length) * 100) : 0;
  // By-component / by-release breakdowns for boomerang keys — lightweight from already-fetched issues if possible
  return {
    boomerangs: boomerangKeys,
    boomerangRate: rate,
    deferredTotal: deferredKeys.length,
    gapMeta: { boomerangKeys },
    boomerangCells: {
      total: cell(boomerangKeys.length, boomerangKeys.length ? keysInJql(boomerangKeys) : null),
      rate,
    },
  };
}

function computeBoomerangBreakdowns(boomerangStacks, allDeferredStacks) {
  // Called after fetch if we have stack data — currently deferred stacks not fetched by key; keep simple
  return null;
}

async function getDashboard({ token, teamId, timeframe } = {}) {
  const tf = timeframe && TIMEFRAMES.hasOwnProperty(String(timeframe).trim()) ? String(timeframe).trim() : (timeframe ? String(timeframe).trim() : '7d');
  const normalizedTf = Object.keys(TIMEFRAMES).find((k) => k.toLowerCase() === tf.toLowerCase()) || '7d';
  const cfg = resolveRuntimeConfig(teamId);

  if (!cfg.baseScopeJql || !String(cfg.baseScopeJql).trim()) {
    return {
      teamId: cfg.teamId, timeframe: normalizedTf, notConfigured: true,
      message: `CFD/CFI not configured for team "${cfg.teamId}". Add a CFD/CFI KPI in Admin → KPIs or configure cfdcfiConfig.json.`,
      baseScopeJql: '', hero: {}, paths: {}, rag: { level: 'GREEN', why: 'Not configured' }, pulse: null, priorityMix: [], assigneeMix: [], componentMix: [], fixVersionMix: [], openTickets: [], stacksPreview: [], health: { mttrMedian: null, p90: null, net: 0 },
      breakdowns: { customerFound: [] }, customerFound: [], boomerang: null, gapMeta: null,
    };
  }

  const cacheKey = `${cfg.teamId}:${normalizedTf}`;
  const cached = heroCache.get(cacheKey);
  if (cached) return cached;

  const queries = buildTimeframeHeroQueries(cfg, normalizedTf);
  const t0 = Date.now();
  const outJql = linkedOutJql(cfg);
  const windowOverride = computePulseWindow(normalizedTf);
  const pulseOpts = (() => {
    if (!cfg.baseScopeJql) return null;
    const opts = { token, baseJql: cfg.baseScopeJql, optionalHeroes: cfg.optionalHeroes || {}, agedOpenDays: cfg.agedOpenDays };
    if (windowOverride) opts.window = windowOverride;
    return opts;
  })();

  const [countsRes, openRes, closedRes, linkedOutRes, pulseRes, boomerangRes, customerFoundRes] = await Promise.allSettled([
    runCounts(token, queries),
    fetchOpenStacks(token, cfg).catch((e) => { throw e; }),
    fetchClosedCfdcfiStacks(token, cfg, normalizedTf).catch((e) => { throw e; }),
    outJql ? fetchLinkedOut(token, cfg) : Promise.resolve(0),
    pulseOpts ? buildPulse(pulseOpts) : Promise.resolve(null),
    fetchDeferredBoomerangs(token, cfg).catch(() => ({ boomerangs: [], boomerangRate: 0, deferredTotal: 0, gapMeta: { boomerangKeys: [] }, boomerangCells: {} })),
    fetchCustomerFoundBreakdown(token, cfg, cfg.baseScopeJql).catch(() => []),
  ]);

  const errors = {};
  const results = countsRes.status === 'fulfilled' ? countsRes.value.results : {};
  if (countsRes.status === 'rejected') errors.counts = countsRes.reason?.message || String(countsRes.reason);
  else if (countsRes.value.errors) Object.assign(errors, countsRes.value.errors);

  let openData = emptyStackData();
  if (openRes.status === 'fulfilled') openData = openRes.value;
  else errors.openStacks = openRes.reason?.message || String(openRes.reason);

  let closedStacks = [];
  let closedJqlStr = null;
  if (closedRes.status === 'fulfilled') { closedStacks = closedRes.value.stacks; closedJqlStr = closedRes.value.jql; }
  else errors.closedStacks = closedRes.reason?.message || String(closedRes.reason);

  let linkedOutCount = 0;
  if (linkedOutRes.status === 'fulfilled') linkedOutCount = linkedOutRes.value;
  else errors.linkedOut = linkedOutRes.reason?.message || String(linkedOutRes.reason);

  let pulse = null;
  if (pulseRes.status === 'fulfilled') pulse = pulseRes.value;
  else if (pulseOpts) errors.pulse = pulseRes.reason?.message || String(pulseRes.reason);

  let boomerang = { boomerangs: [], boomerangRate: 0, deferredTotal: 0, gapMeta: { boomerangKeys: [] }, boomerangCells: {} };
  if (boomerangRes.status === 'fulfilled') boomerang = boomerangRes.value;
  else errors.boomerang = boomerangRes.reason?.message || String(boomerangRes.reason);

  let customerFound = [];
  if (customerFoundRes.status === 'fulfilled') customerFound = Array.isArray(customerFoundRes.value) ? customerFoundRes.value : [];
  else errors.customerFound = customerFoundRes.reason?.message || String(customerFoundRes.reason);

  const hero = {
    open: cell(results.open, queries.open),
    agedOpen: cell(results.agedOpen, queries.agedOpen),
    closedInWindow: cell(results.closedInWindow, queries.closedInWindow),
    p0Open: cell(results.p0Open, queries.p0Open),
    p1Open: cell(results.p1Open, queries.p1Open),
    all: cell(results.all, queries.all),
    tbv: cell(results.tbv, queries.tbv),
  };

  const health = {
    mttrMedian: pulse?.mttr?.medianDays ?? null,
    p90: pulse?.mttr?.p90Days ?? null,
    net: pulse?.heroes?.netBurn?.count ?? 0,
    throughput: pulse?.heroes?.resolvedWindow?.count ?? 0,
    agedShare: (() => { const o = hero.open?.count || 0, a = hero.agedOpen?.count || 0; if (!o) return 0; return Math.round((a / o) * 100); })(),
    churn: pulse?.heroes?.createdWindow?.count ?? 0,
  };

  // Component / fixVersion mix from open stacks
  const componentMix = topN(openData.componentMix || {}, 8);
  const fixVersionMix = topN(openData.fixVersionMix || {}, 8);

  // Age buckets
  const ageBuckets = { '0-7': 0, '8-30': 0, '31-90': 0, '90+': 0 };
  for (const s of openData.stacks || []) {
    const age = s.ageDays ?? 0;
    if (age <= 7) ageBuckets['0-7'] += 1;
    else if (age <= 30) ageBuckets['8-30'] += 1;
    else if (age <= 90) ageBuckets['31-90'] += 1;
    else ageBuckets['90+'] += 1;
  }

  // Test-escape / rootCause breakdowns
  const testEscapeMix = {};
  const rootCauseMix = {};
  for (const s of openData.stacks || []) {
    const te = s.cfdcfiFields?.testEscape || '—';
    const rc = s.cfdcfiFields?.rootCause || '—';
    testEscapeMix[te] = (testEscapeMix[te] || 0) + 1;
    rootCauseMix[rc] = (rootCauseMix[rc] || 0) + 1;
  }

  // TH linkage counts
  const thLinked = (openData.stacks || []).filter((s) => s.techHelp && s.techHelp.length > 0).length;
  const techPubsLinked = (openData.stacks || []).filter((s) => s.techPubs && s.techPubs.length > 0).length;

  const paths = {
    ...buildPathCells(openData.pathStats, { linkedOutCell: cell(linkedOutCount, outJql) }),
    sample: { openTotal: results.open || 0, openFetched: openData.pathStats.openFetched || 0, capped: (openData.pathStats.openFetched || 0) < (results.open || 0), maxOpenIssuesFetch: cfg.maxOpenIssuesFetch, universe: 'cfdcfi_seeds' },
  };

  // Boomerang breakdowns by component/fixVersion if boomerang stacks available
  let boomerangByComponent = [];
  let boomerangByFixVersion = [];
  if (boomerang.boomerangs && boomerang.boomerangs.length && openData.stacks) {
    const bSet = new Set(boomerang.boomerangs);
    const bComp = {}, bFv = {};
    for (const s of openData.stacks) if (bSet.has(s.key)) {
      for (const c of s.components || []) bComp[c] = (bComp[c] || 0) + 1;
      for (const v of s.fixVersions || []) bFv[v] = (bFv[v] || 0) + 1;
    }
    boomerangByComponent = topN(bComp, 6);
    boomerangByFixVersion = topN(bFv, 6);
  }

  const rag = (() => {
    const ragCfg = cfg.rag || {};
    const aged = hero.agedOpen?.count || 0;
    const br = boomerang?.rate ?? boomerang?.boomerangRate ?? 0;
    const agedShare = health.agedShare ?? 0;
    if (aged >= (ragCfg.redAgedOpen ?? 5) || br >= (ragCfg.redBoomerangRate ?? 20)) {
      const why = [];
      if (aged >= (ragCfg.redAgedOpen ?? 5)) why.push(`${aged} aged open >${cfg.agedOpenDays}d`);
      if (br >= (ragCfg.redBoomerangRate ?? 20)) why.push(`${br}% boomerang rate`);
      return { level: 'RED', why: why.join(' · ') + '.' };
    }
    if (aged >= 2 || agedShare >= (ragCfg.yellowAgedShare ?? 30)) {
      return { level: 'YELLOW', why: `${aged} aged open · ${agedShare}% aged share.` };
    }
    return { level: 'GREEN', why: 'Backlog and boomerang rate look controlled.' };
  })();

  const openSeedJqlStr = openJql(cfg);
  const withJql = (arr, field) => arr.map((r) => ({ ...r, jql: r.jql || (r.name ? andParts(openSeedJqlStr, field + ' = "' + String(r.name).replace(/"/g, '\\"') + '"') : null) }));
  const ageBucketsWithJql = Object.entries(ageBuckets).map(([label, count]) => ({ label, count, jql: openSeedJqlStr ? andParts(openSeedJqlStr, label === '0-7' ? 'created >= -7d' : label === '8-30' ? 'created >= -30d AND created <= -8d' : label === '31-90' ? 'created >= -90d AND created <= -31d' : 'created <= -90d') : null }));

  const result = {
    teamId: cfg.teamId,
    baseScopeJql: cfg.baseScopeJql,
    jiraBaseUrl: cfg.jiraBaseUrl,
    agedOpenDays: cfg.agedOpenDays,
    rag,
    asOf: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    timeframe: normalizedTf,
    hero,
    health,
    pulse,
    paths,
    priorityMix: topN(openData.priorityMix),
    assigneeMix: topN(openData.assigneeMix),
    componentMix,
    fixVersionMix,
    breakdowns: {
      byComponent: withJql(componentMix, 'component'),
      byFixVersion: withJql(fixVersionMix, 'fixVersion'),
      ageBuckets: ageBucketsWithJql,
      testEscape: withJql(topN(testEscapeMix, 8), '"Test Escape?"'),
      rootCause: withJql(topN(rootCauseMix, 8), '"Root Cause"'),
      linkage: { thLinked, techPubsLinked, totalOpen: openData.stacks.length },
      customerFound,
    },
    boomerang: {
      keys: boomerang.boomerangs || [],
      rate: boomerang.boomerangRate || 0,
      deferredTotal: boomerang.deferredTotal || 0,
      byComponent: boomerangByComponent,
      byFixVersion: boomerangByFixVersion,
      cell: boomerang.boomerangCells?.total || cell(0, null),
    },
    gapMeta: {
      boomerangKeys: boomerang.gapMeta?.boomerangKeys || boomerang.boomerangs || [],
      boomerangCells: boomerang.boomerangCells || {},
    },
    customerFound,
    openTickets: mapTicketRows(openData.stacks),
    stacksPreview: openData.stacks.slice(0, 40).map((s) => ({
      key: s.key, summary: s.summary, status: s.status, priority: s.priority, assignee: s.assignee, ageDays: s.ageDays,
      components: s.components, fixVersions: s.fixVersions,
      techHelpCount: s.techHelp.length, engFixCount: s.engFixes.length, techPubsCount: (s.techPubs || []).length,
      cfdcfiFields: s.cfdcfiFields || null,
    })),
    openFetched: openData.pathStats.openFetched,
    closedStacksPreview: closedStacks.slice(0, 20).map((s) => ({ key: s.key, summary: s.summary, resolution: s.resolution, status: s.status })),
    closedJql: closedJqlStr,
    errors: Object.keys(errors).length ? errors : undefined,
  };

  heroCache.set(cacheKey, result);
  return result;
}

module.exports = { TIMEFRAMES, timeframeToDays, timeframeClause, buildTimeframeHeroQueries, computePulseWindow, getDashboard, fetchCustomerFoundBreakdown, fetchCustomerFound, buildCustomerFoundQueries, TOP_QUALIFIER_SUBCLAUSES };
