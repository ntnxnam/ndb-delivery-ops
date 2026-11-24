/**
 * CFD/CFI open/past stack fetch, classify, and path cell builders.
 * Mirrors oncallStacksService — keyed to cfdcfiConfigRuntime + issuelinks linkage.
 */

const { searchPages } = require('../utils/jiraClient');
const { mapLinkedIssues, daysAgo, daysBetween } = require('./ticketNarrativeService');
const {
  cell,
  keysInJql,
  pushUnique,
  openJql,
  pastClosedJql,
} = require('./cfdcfiConfigResolve');

function getCfdcfiFieldIds(cfg) {
  const cf = cfg?.customFields || {};
  return Object.values(cf)
    .filter((v) => v && typeof v === 'object' && v.id && v.id.startsWith('customfield_'))
    .map((v) => v.id);
}

function extractCfdcfiFields(f, cfg) {
  const cf = cfg?.customFields || {};
  const pick = (key) => {
    const meta = cf[key];
    if (!meta?.id) return null;
    const raw = f[meta.id];
    if (raw == null || raw === '') return null;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw.map((o) => o.value || o.name || o.displayName || String(o)).join(', ') || null;
    if (typeof raw === 'object') return raw.value || raw.name || raw.displayName || raw.text || null;
    return String(raw);
  };
  return {
    testEscape: pick('testEscape'),
    rootCause: pick('rootCause'),
    correctiveActionCompleted: pick('correctiveActionCompleted'),
    rcaStatus: pick('rcaStatus'),
  };
}

function classifyStacksFromIssues(issues, cfg, { sortBy = 'age' } = {}) {
  const stacks = [];
  const withTechHelp = [];
  const withEng = [];
  const withTechPubs = [];
  const withKnowledge = [];
  const withoutTechHelp = [];
  const withoutEng = [];
  const withoutBoth = [];
  const allLinkedOut = [];
  const priorityMix = {};
  const assigneeMix = {};
  const componentMix = {};
  const fixVersionMix = {};

  for (const issue of issues) {
    const f = issue.fields || {};
    const key = issue.key;
    const linked = mapLinkedIssues(f.issuelinks, cfg);
    const techHelp = linked.filter((l) => l.role === 'techhelp');
    const techPubs = linked.filter((l) => l.role === 'techpubs');
    const knowledge = linked.filter((l) => l.role === 'knowledge');
    const engFixes = linked.filter((l) => l.role === 'eng_fix' || l.role === 'techpubs');
    const priority = f.priority?.name || 'Unknown';
    const assignee = f.assignee?.displayName || f.assignee?.name || 'Unassigned';
    const issueType = f.issuetype?.name || 'Unknown';
    const resolution = f.resolution?.name || null;
    const created = f.created || null;
    const resolutiondate = f.resolutiondate || null;
    const cycleDays = daysBetween(created, resolutiondate);
    const components = Array.isArray(f.components) ? f.components.map((c) => c.name || String(c)).filter(Boolean) : [];
    const fixVersions = Array.isArray(f.fixVersions) ? f.fixVersions.map((v) => v.name || String(v)).filter(Boolean) : [];

    priorityMix[priority] = (priorityMix[priority] || 0) + 1;
    assigneeMix[assignee] = (assigneeMix[assignee] || 0) + 1;
    for (const c of components) componentMix[c] = (componentMix[c] || 0) + 1;
    for (const v of fixVersions) fixVersionMix[v] = (fixVersionMix[v] || 0) + 1;

    const hasTh = techHelp.length > 0;
    const hasEng = engFixes.length > 0;

    if (hasTh) withTechHelp.push(key);
    else withoutTechHelp.push(key);
    if (hasEng) withEng.push(key);
    else if (hasTh) withoutEng.push(key);
    if (techPubs.length) withTechPubs.push(key);
    if (knowledge.length) withKnowledge.push(key);
    if (!hasTh && !hasEng) withoutBoth.push(key);
    pushUnique(allLinkedOut, linked.filter((l) => l.role !== 'oncall' && l.role !== 'knowledge').map((l) => l.key));

    stacks.push({
      key,
      summary: f.summary || '',
      issueType,
      status: f.status?.name || 'unknown',
      resolution,
      priority,
      assignee,
      created,
      updated: f.updated || null,
      resolutiondate,
      ageDays: daysAgo(created),
      cycleDays,
      labels: Array.isArray(f.labels) ? f.labels : [],
      components,
      fixVersions,
      techHelp,
      techPubs,
      knowledge,
      engFixes,
      linked,
      cfdcfiFields: extractCfdcfiFields(f, cfg),
    });
  }

  stacks.sort((a, b) => {
    if (sortBy === 'resolved') {
      const ta = a.resolutiondate ? Date.parse(a.resolutiondate) : 0;
      const tb = b.resolutiondate ? Date.parse(b.resolutiondate) : 0;
      return tb - ta;
    }
    const pRank = (p) => {
      const s = String(p || '').toLowerCase();
      if (s.includes('blocker') || s.includes('p0')) return 0;
      if (s.includes('critical') || s.includes('p1')) return 1;
      return 2;
    };
    const d = pRank(a.priority) - pRank(b.priority);
    if (d !== 0) return d;
    return (b.ageDays || 0) - (a.ageDays || 0);
  });

  return {
    stacks,
    pathStats: {
      fetched: stacks.length,
      openFetched: stacks.length,
      withTechHelp: withTechHelp.length,
      withoutTechHelp: withoutTechHelp.length,
      withEng: withEng.length,
      withoutEng: withoutEng.length,
      withTechPubs: withTechPubs.length,
      withKnowledge: withKnowledge.length,
      withoutTechHelpAndEng: withoutBoth.length,
      linkedOutFromStacks: allLinkedOut.length,
      keys: { withTechHelp, withoutTechHelp, withEng, withoutEng, withTechPubs, withKnowledge, withoutBoth, linkedOutFromStacks: allLinkedOut },
      jqlTarget: { withTechHelp: 'cfdcfi_seed', withEng: 'cfdcfi_seed', withTechPubs: 'cfdcfi_seed', withKnowledge: 'cfdcfi_seed', linkedOut: 'linked', withoutTechHelp: 'cfdcfi_seed', withoutEng: 'cfdcfi_seed', withoutRemediation: 'cfdcfi_seed' },
    },
    priorityMix,
    assigneeMix,
    componentMix,
    fixVersionMix,
  };
}

async function fetchStacksByJql(token, cfg, jql, { maxTotal, sortBy } = {}) {
  const cfdcfiFields = getCfdcfiFieldIds(cfg).join(',');
  const baseFields = 'key,summary,status,priority,assignee,created,updated,resolution,resolutiondate,issuelinks,labels,issuetype,components,fixVersions';
  const fields = cfdcfiFields ? `${baseFields},${cfdcfiFields}` : baseFields;
  const issues = await searchPages(token, jql, fields, {
    pageSize: 100,
    maxTotal: maxTotal || cfg.maxOpenIssuesFetch || 200,
    timeoutMs: 45000,
    delayMs: 150,
  });
  return classifyStacksFromIssues(issues, cfg, { sortBy });
}

async function fetchOpenStacks(token, cfg) {
  return fetchStacksByJql(token, cfg, openJql(cfg), { maxTotal: cfg.maxOpenIssuesFetch, sortBy: 'age' });
}

async function fetchClosedStacks(token, cfg, timeframe) {
  // Used by dashboardV2 via direct jql construction; kept as helper
  const TIMEFRAMES = { '7d': 7, '15d': 15, '1M': 30, '1Q': 90, '2Q': 180, '1Y': 365, '18M': 540, Overall: null };
  function tfDays(tf) { const v = TIMEFRAMES[String(tf || '').trim()]; return v !== undefined ? v : TIMEFRAMES['7d']; }
  const days = tfDays(timeframe);
  const { andParts, cfdcfiSeedJql } = require('./cfdcfiConfigResolve');
  const seed = cfdcfiSeedJql(cfg);
  const doneJql = cfg.doneStatusJql || 'statusCategory = Done';
  const clause = days == null ? null : `resolved >= -${days}d`;
  const jql = clause ? andParts(seed, doneJql, clause) : andParts(seed, doneJql);
  return fetchStacksByJql(token, cfg, jql, { maxTotal: cfg.maxPastIssuesFetch || 200, sortBy: 'resolved' });
}

function buildPathCells(pathStats, { linkedOutCell } = {}) {
  const pk = pathStats.keys || {};
  return {
    withTechHelp: cell(pathStats.withTechHelp, keysInJql(pk.withTechHelp)),
    withEng: cell(pathStats.withEng, keysInJql(pk.withEng)),
    withTechPubs: cell(pathStats.withTechPubs, keysInJql(pk.withTechPubs)),
    withKnowledge: cell(pathStats.withKnowledge, keysInJql(pk.withKnowledge)),
    linkedOut: linkedOutCell || cell(pathStats.linkedOutFromStacks, keysInJql(pk.linkedOutFromStacks)),
    withoutTechHelp: cell(pathStats.withoutTechHelp, keysInJql(pk.withoutTechHelp)),
    withoutEng: cell(pathStats.withoutEng, keysInJql(pk.withoutEng)),
    withoutRemediation: cell(pathStats.withoutTechHelpAndEng, keysInJql(pk.withoutBoth)),
    jqlTarget: pathStats.jqlTarget || {},
  };
}

function slimLinked(list) {
  return (list || []).map((t) => ({ key: t.key, status: t.status || '—', summary: t.summary || '' }));
}

function mapTicketRows(stacks) {
  return (stacks || []).map((s) => ({
    key: s.key,
    issueType: s.issueType,
    summary: s.summary,
    status: s.status,
    resolution: s.resolution || 'N/A',
    priority: s.priority,
    assignee: s.assignee,
    ageDays: s.ageDays,
    cycleDays: s.cycleDays,
    resolutiondate: s.resolutiondate || null,
    components: s.components || [],
    fixVersions: s.fixVersions || [],
    techHelpKeys: (s.techHelp || []).map((t) => t.key),
    engFixKeys: (s.engFixes || []).map((e) => e.key),
    techPubsKeys: (s.techPubs || []).map((t) => t.key),
    techHelp: slimLinked(s.techHelp),
    engFixes: slimLinked(s.engFixes),
    techPubs: slimLinked(s.techPubs),
    cfdcfiFields: s.cfdcfiFields || null,
  }));
}

function topN(mix, n = 8) {
  return Object.entries(mix || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
}

function emptyStackData() {
  return { stacks: [], pathStats: { fetched: 0, openFetched: 0, withTechHelp: 0, withoutTechHelp: 0, withEng: 0, withoutEng: 0, withTechPubs: 0, withKnowledge: 0, withoutTechHelpAndEng: 0, linkedOutFromStacks: 0, keys: {} }, priorityMix: {}, assigneeMix: {}, componentMix: {}, fixVersionMix: {} };
}

module.exports = {
  getCfdcfiFieldIds,
  extractCfdcfiFields,
  classifyStacksFromIssues,
  fetchStacksByJql,
  fetchOpenStacks,
  fetchClosedStacks,
  buildPathCells,
  mapTicketRows,
  topN,
  emptyStackData,
};
