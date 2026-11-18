/**
 * OnCall open/past stack fetch, classify, and path cell builders.
 */

const { searchPages } = require('../utils/jiraClient');
const { mapLinkedIssues, daysAgo, daysBetween } = require('./ticketNarrativeService');
const {
  cell,
  keysInJql,
  pushUnique,
  openJql,
  pastClosedJql,
} = require('./oncallConfigResolve');

function isRemediationLink(role) {
  return role === 'eng_fix' || role === 'techpubs';
}

function classifyStacksFromIssues(issues, cfg, { sortBy = 'age' } = {}) {
  const stacks = [];
  // Path KPI keys are always OnCall seeds (never unique TH/ERA keys).
  // Counting linked tickets here made "Eng in flight" collide with gap cards
  // and open the wrong JIRA set.
  const withTechHelp = [];
  const withEng = [];
  const withTechPubs = [];
  const withKnowledge = [];
  const withoutTechHelp = [];
  const withoutEng = []; // has TechHelp, missing eng/docs (partial path)
  const withoutBoth = []; // neither TechHelp nor eng/docs
  const allLinkedOut = [];
  const priorityMix = {};
  const assigneeMix = {};

  for (const issue of issues) {
    const f = issue.fields || {};
    const key = issue.key;
    const linked = mapLinkedIssues(f.issuelinks, cfg);
    const techHelp = linked.filter((l) => l.role === 'techhelp');
    const techPubs = linked.filter((l) => l.role === 'techpubs');
    const knowledge = linked.filter((l) => l.role === 'knowledge');
    const engFixes = linked.filter((l) => isRemediationLink(l.role));
    const priority = f.priority?.name || 'Unknown';
    const assignee = f.assignee?.displayName || f.assignee?.name || 'Unassigned';
    const issueType = f.issuetype?.name || 'OnCall';
    const resolution = f.resolution?.name || null;
    const created = f.created || null;
    const resolutiondate = f.resolutiondate || null;
    const cycleDays = daysBetween(created, resolutiondate);

    priorityMix[priority] = (priorityMix[priority] || 0) + 1;
    assigneeMix[assignee] = (assigneeMix[assignee] || 0) + 1;

    const hasTh = techHelp.length > 0;
    const hasEng = engFixes.length > 0;

    if (hasTh) withTechHelp.push(key);
    else withoutTechHelp.push(key);

    if (hasEng) withEng.push(key);
    else if (hasTh) withoutEng.push(key); // TH only — needs an eng/docs owner

    if (techPubs.length) withTechPubs.push(key);
    if (knowledge.length) withKnowledge.push(key);
    if (!hasTh && !hasEng) withoutBoth.push(key);
    pushUnique(
      allLinkedOut,
      linked.filter((l) => l.role !== 'oncall').map((l) => l.key)
    );

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
      cycleDays: cycleDays,
      labels: Array.isArray(f.labels) ? f.labels : [],
      techHelp,
      techPubs,
      knowledge,
      engFixes,
      linked,
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
      keys: {
        withTechHelp,
        withoutTechHelp,
        withEng,
        withoutEng,
        withTechPubs,
        withKnowledge,
        withoutBoth,
        linkedOutFromStacks: allLinkedOut,
      },
      jqlTarget: {
        // All path KPI cells are OnCall seeds; linkedOut stays the downstream footprint.
        withTechHelp: 'oncall_seed',
        withEng: 'oncall_seed',
        withTechPubs: 'oncall_seed',
        withKnowledge: 'oncall_seed',
        linkedOut: 'linked',
        withoutTechHelp: 'oncall_seed',
        withoutEng: 'oncall_seed',
        withoutRemediation: 'oncall_seed',
      },
    },
    priorityMix,
    assigneeMix,
  };
}

async function fetchStacksByJql(token, cfg, jql, { maxTotal, sortBy } = {}) {
  const issues = await searchPages(
    token,
    jql,
    'key,summary,status,priority,assignee,created,updated,resolution,resolutiondate,issuelinks,labels,issuetype',
    {
      pageSize: 100,
      maxTotal: maxTotal || cfg.maxOpenIssuesFetch || 200,
      timeoutMs: 45000,
      delayMs: 150,
    }
  );
  return classifyStacksFromIssues(issues, cfg, { sortBy });
}

/** Fetch open OnCall issues and classify linked TechHelp / eng fixes. */
async function fetchOpenStacks(token, cfg) {
  return fetchStacksByJql(token, cfg, openJql(cfg), {
    maxTotal: cfg.maxOpenIssuesFetch,
    sortBy: 'age',
  });
}

/** Fetch recently closed OnCall seeds for the Past section. */
async function fetchPastStacks(token, cfg) {
  return fetchStacksByJql(token, cfg, pastClosedJql(cfg), {
    maxTotal: cfg.maxPastIssuesFetch,
    sortBy: 'resolved',
  });
}

function buildPathCells(pathStats, { linkedOutCell } = {}) {
  const pk = pathStats.keys || {};
  return {
    withTechHelp: cell(pathStats.withTechHelp, keysInJql(pk.withTechHelp)),
    withEng: cell(pathStats.withEng, keysInJql(pk.withEng)),
    withTechPubs: cell(pathStats.withTechPubs, keysInJql(pk.withTechPubs)),
    withKnowledge: cell(pathStats.withKnowledge, keysInJql(pk.withKnowledge)),
    linkedOut:
      linkedOutCell ||
      cell(pathStats.linkedOutFromStacks, keysInJql(pk.linkedOutFromStacks)),
    withoutTechHelp: cell(pathStats.withoutTechHelp, keysInJql(pk.withoutTechHelp)),
    withoutEng: cell(pathStats.withoutEng, keysInJql(pk.withoutEng)),
    withoutRemediation: cell(pathStats.withoutTechHelpAndEng, keysInJql(pk.withoutBoth)),
    jqlTarget: pathStats.jqlTarget || {},
  };
}

function slimLinked(list) {
  return (list || []).map((t) => ({
    key: t.key,
    status: t.status || '—',
    summary: t.summary || '',
  }));
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
    techHelpKeys: (s.techHelp || []).map((t) => t.key),
    engFixKeys: (s.engFixes || []).map((e) => e.key),
    techPubsKeys: (s.techPubs || []).map((t) => t.key),
    // Full linked objects for path drill drawers (OnCall ↔ TH / eng / TechPubs)
    techHelp: slimLinked(s.techHelp),
    engFixes: slimLinked(s.engFixes),
    techPubs: slimLinked(s.techPubs),
  }));
}

function topN(mix, n = 8) {
  return Object.entries(mix || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function emptyStackData() {
  return {
    stacks: [],
    pathStats: {
      fetched: 0,
      openFetched: 0,
      withTechHelp: 0,
      withoutTechHelp: 0,
      withEng: 0,
      withoutEng: 0,
      withTechPubs: 0,
      withKnowledge: 0,
      withoutTechHelpAndEng: 0,
      linkedOutFromStacks: 0,
      keys: {},
    },
    priorityMix: {},
    assigneeMix: {},
  };
}

module.exports = {
  isRemediationLink,
  classifyStacksFromIssues,
  fetchOpenStacks,
  fetchPastStacks,
  buildPathCells,
  mapTicketRows,
  topN,
  emptyStackData,
};
