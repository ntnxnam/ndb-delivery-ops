/**
 * OnCalls quantitative dashboard — thin orchestrator.
 * Config → oncallConfigResolve; stacks → oncallStacksService; escalation → oncallEscalationService.
 */

const { getJira } = require('../utils/jiraClient');
const { classifyLinkRole, projectKeyOf } = require('./ticketNarrativeService');
const {
  resolveRuntimeConfig,
  baseJql,
  openJql,
  pastClosedJql,
  linkedOutJql,
  buildHeroQueries,
  cell,
} = require('./oncallConfigResolve');
const {
  resolveEscalationKpis,
  buildEscalationAnalysis,
} = require('./oncallEscalationService');
const {
  fetchOpenStacks,
  fetchPastStacks,
  buildPathCells,
  mapTicketRows,
  topN,
  emptyStackData,
} = require('./oncallStacksService');
const { buildPulse } = require('./kpiPulseService');
const logger = require('../utils/logger');

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

function wowDelta(curr, prev) {
  const c = curr || 0;
  const p = prev || 0;
  if (prev == null || prev === 0) {
    return { abs: c - p, pct: c ? 100 : 0, curr: c, prev: p };
  }
  const abs = c - p;
  const pct = Math.round((abs / p) * 100);
  return { abs, pct, curr: c, prev: p };
}

function computeRag(cfg, hero, pathStats) {
  const ragCfg = cfg.rag || {};
  const p0 = hero.p0Open?.count || 0;
  const aged = hero.agedOpen?.count || 0;
  const createdWow = hero.createdWow?.pct || 0;
  const noRemediation = pathStats.withoutTechHelpAndEng || 0;

  if (p0 >= (ragCfg.redOpenP0 ?? 1)) {
    return {
      level: 'RED',
      why: `${p0} open P0 OnCall(s) — customer-facing blockers active.`,
    };
  }
  if (
    aged >= (ragCfg.yellowAgedOpen ?? 8) ||
    createdWow >= (ragCfg.yellowCreatedWowPct ?? 30) ||
    noRemediation >= 5
  ) {
    return {
      level: 'YELLOW',
      why: [
        aged ? `${aged} aged open (>${cfg.agedOpenDays}d)` : null,
        createdWow >= (ragCfg.yellowCreatedWowPct ?? 30)
          ? `created WoW ${createdWow > 0 ? '+' : ''}${createdWow}%`
          : null,
        noRemediation ? `${noRemediation} open with neither TechHelp nor eng fix` : null,
      ]
        .filter(Boolean)
        .join(' · ') + '.',
    };
  }
  return {
    level: 'GREEN',
    why: 'No open P0s; aged volume and remediation coverage look controlled.',
  };
}

async function getDashboard({ token, teamId } = {}) {
  const cfg = resolveRuntimeConfig(teamId);
  const queries = buildHeroQueries(cfg);
  const t0 = Date.now();
  const { results, errors } = await runCounts(token, queries);

  let openData = emptyStackData();
  try {
    openData = await fetchOpenStacks(token, cfg);
  } catch (err) {
    errors.openStacks = err.message || String(err);
  }

  let pastData = emptyStackData();
  const pastJql = pastClosedJql(cfg);
  try {
    pastData = await fetchPastStacks(token, cfg);
  } catch (err) {
    errors.pastStacks = err.message || String(err);
  }

  const outJql = linkedOutJql(cfg);
  let linkedOutCount = 0;
  if (outJql) {
    try {
      const jira = await getJira(token);
      linkedOutCount = await jira.searchCount(outJql);
    } catch (err) {
      errors.linkedOut = err.message || String(err);
    }
  }

  let pastClosedCount = pastData.pathStats.fetched || 0;
  try {
    const jira = await getJira(token);
    pastClosedCount = await jira.searchCount(pastJql);
  } catch (err) {
    errors.pastClosedCount = err.message || String(err);
  }

  const createdWow = wowDelta(results.created7d, results.createdPrev7d);
  const closedWow = wowDelta(results.closed7d, results.closedPrev7d);

  const hero = {
    open: cell(results.open, queries.open),
    closed7d: cell(results.closed7d, queries.closed7d),
    created7d: cell(results.created7d, queries.created7d),
    agedOpen: cell(results.agedOpen, queries.agedOpen),
    p0Open: cell(results.p0Open, queries.p0Open),
    p1Open: cell(results.p1Open, queries.p1Open),
    all: cell(results.all, queries.all),
    createdWow,
    closedWow,
  };

  const openTotal = results.open || 0;
  const openFetched = openData.pathStats.openFetched || 0;
  const paths = {
    ...buildPathCells(openData.pathStats, {
      linkedOutCell: cell(linkedOutCount, outJql),
    }),
    sample: {
      openTotal,
      openFetched,
      capped: openFetched < openTotal,
      maxOpenIssuesFetch: cfg.maxOpenIssuesFetch,
      universe: 'oncall_seeds',
    },
  };

  const pastFetched = pastData.pathStats.fetched || 0;
  const past = {
    lookbackDays: cfg.pastLookbackDays,
    closed: cell(pastClosedCount, pastJql),
    paths: {
      ...buildPathCells(pastData.pathStats),
      sample: {
        closedTotal: pastClosedCount,
        fetched: pastFetched,
        capped: pastFetched < pastClosedCount,
        maxPastIssuesFetch: cfg.maxPastIssuesFetch,
        universe: 'oncall_seeds_closed',
      },
    },
    tickets: mapTicketRows(pastData.stacks),
    priorityMix: topN(pastData.priorityMix),
    assigneeMix: topN(pastData.assigneeMix),
  };

  const rag = computeRag(cfg, hero, openData.pathStats);

  let escalation = null;
  try {
    escalation = await buildEscalationAnalysis(token, cfg);
  } catch (err) {
    errors.escalation = err.message || String(err);
    escalation = { enabled: false, reason: err.message || String(err), rows: [] };
  }

  let pulse = null;
  if (cfg.baseScopeJql) {
    try {
      pulse = await buildPulse({
        token,
        baseJql: cfg.baseScopeJql,
        optionalHeroes: { p0: true, p1: true },
        agedOpenDays: cfg.agedOpenDays,
      });
    } catch (err) {
      errors.pulse = err.message || String(err);
      if (logger?.jira?.warning) {
        logger.jira.warning('oncalls', `buildPulse failed: ${errors.pulse}`);
      }
    }
  }

  return {
    teamId: cfg.teamId,
    onCallProject: cfg.onCallProject,
    baseScopeJql: cfg.baseScopeJql,
    techHelpProjects: cfg.techHelpProjects,
    engFixProjects: cfg.engFixProjects,
    agedOpenDays: cfg.agedOpenDays,
    pastLookbackDays: cfg.pastLookbackDays,
    jiraBaseUrl: cfg.jiraBaseUrl,
    asOf: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    hero,
    pulse,
    paths,
    past,
    rag,
    escalation,
    priorityMix: topN(openData.priorityMix),
    assigneeMix: topN(openData.assigneeMix),
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
    errors: Object.keys(errors).length ? errors : undefined,
  };
}

module.exports = {
  getDashboard,
  resolveRuntimeConfig,
  resolveEscalationKpis,
  buildEscalationAnalysis,
  openJql,
  baseJql,
  computeRag,
  classifyLinkRole,
  projectKeyOf,
};
