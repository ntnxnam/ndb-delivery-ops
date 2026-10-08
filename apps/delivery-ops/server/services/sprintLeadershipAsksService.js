/**
 * Sprint Performance — AI "Asks of leadership" (org-wide).
 * Builds a compact intelligence packet from the computed model, calls the
 * sprint-specific NAI prompt, and falls back to rule-based asks on failure.
 */

const { generateSprintLeadershipAsks } = require('./naiService');
const logger = require('../utils/logger');

const DAY_MS = 86400000;

function daysBetween(a, b) {
  if (!a || !b) return null;
  const t0 = Date.parse(String(a).slice(0, 10));
  const t1 = Date.parse(String(b).slice(0, 10));
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / DAY_MS);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] * (hi - i) + sorted[hi] * (i - lo));
}

function rankableTeams(model) {
  return (model?.scrumTeams || []).filter((t) => !t.unmeasurable && t.active);
}

/** Dev-finished say/do − JIRA Completed say/do = QA lag inside the same planned set. */
function buildDevFinishedGap(model, rankable) {
  const o = model?.overall?.window || {};
  const jira = o.sayDo;
  const dev = o.sayDoDevFinished;
  const gap = (jira != null && dev != null) ? Math.round(dev - jira) : null;
  const teamGaps = rankable
    .map((t) => {
      const j = t.window?.sayDo;
      const d = t.window?.sayDoDevFinished;
      if (j == null || d == null) return null;
      return { name: t.name, jiraSayDo: j, devFinishedSayDo: d, gapPts: Math.round(d - j) };
    })
    .filter(Boolean)
    .sort((a, b) => b.gapPts - a.gapPts);
  return {
    orgJiraSayDo: jira,
    orgDevFinishedSayDo: dev,
    orgGapPts: gap,
    largestTeamGaps: teamGaps.slice(0, 6).filter((t) => t.gapPts > 0),
  };
}

/**
 * Resolved→Closed lag from live fields on unique keys (same signal as the report widget).
 */
function buildQaLagSummary(model) {
  const today = (model?.meta?.generatedAt || new Date().toISOString()).slice(0, 10);
  const pendingStatus = model?.meta?.config?.pendingQAStatusName || 'Resolved';
  const seen = new Map();
  (model?.rows || []).forEach((r) => {
    if (!seen.has(r.key)) seen.set(r.key, r);
  });
  const waiting = [];
  const closedDays = [];
  seen.forEach((r) => {
    const lv = r.live || {};
    const status = r.statusNow || lv.status || '';
    const resolved = lv.resolved || '';
    const closed = lv.closed || '';
    if (status === pendingStatus && resolved) {
      const d = daysBetween(resolved, today);
      if (d != null) {
        waiting.push({
          key: r.key,
          days: d,
          scrumTeam: r.scrumTeam,
          assignee: r.assignee,
          manager: r.manager,
        });
      }
    } else if (status === 'Closed' && resolved && closed) {
      const d = daysBetween(resolved, closed);
      if (d != null) closedDays.push(d);
    }
  });
  waiting.sort((a, b) => b.days - a.days);
  closedDays.sort((a, b) => a - b);
  return {
    stillWaiting: waiting.length,
    waitingMedianDays: percentile(waiting.map((w) => w.days).sort((a, b) => a - b), 0.5),
    waitingP90Days: percentile(waiting.map((w) => w.days).sort((a, b) => a - b), 0.9),
    closedMedianLagDays: percentile(closedDays, 0.5),
    closedP90LagDays: percentile(closedDays, 0.9),
    closedAfter14d: closedDays.filter((d) => d > 14).length,
    closedWithBothDates: closedDays.length,
    longestWaits: waiting.slice(0, 10),
  };
}

function buildOrgRankings(model) {
  const cfg = model?.meta?.config || {};
  const minPlanned = cfg.minPlannedForRanking || 5;
  const leaders = (model?.leaders || [])
    .filter((l) => l.group && (l.window?.planned ?? 0) >= minPlanned * 3)
    .map((l) => ({
      name: l.name,
      sayDo: l.window?.sayDo,
      people: l.people,
      committed: l.window?.committed,
    }))
    .sort((a, b) => (b.sayDo ?? -1) - (a.sayDo ?? -1));
  const managers = (model?.managers || [])
    .filter((m) => m.group && (m.people ?? 0) >= 3 && (m.window?.planned ?? 0) >= minPlanned)
    .map((m) => ({
      name: m.name,
      leader: m.leader,
      sayDo: m.window?.sayDo,
      people: m.people,
      committed: m.window?.committed,
    }))
    .sort((a, b) => (b.sayDo ?? -1) - (a.sayDo ?? -1));
  const trail = (ranked) => (ranked.length <= 1
    ? []
    : ranked.slice(-Math.min(3, ranked.length - 1)).reverse());
  return {
    topLeaders: leaders.slice(0, 3),
    trailingLeaders: trail(leaders),
    topManagers: managers.slice(0, 3),
    trailingManagers: trail(managers),
  };
}

function buildVelocityStreams(model) {
  const w = model?.overall?.window || {};
  const series = model?.overall?.series || [];
  const k = model?.meta?.config?.trendSlots || 3;
  const recent = series.slice(-k);
  const sum = (key) => recent.reduce((a, x) => a + (x[key] || 0), 0);
  return {
    window: {
      devDone: w.devDone,
      qaVerified: w.qaVerified,
      qaVerifiedAdj: w.qaVerifiedAdj,
      testDone: w.testDone,
    },
    lastTrendSlots: {
      slots: k,
      devDone: sum('devDone'),
      qaVerifiedAdj: Math.round(sum('qaVerifiedAdj') * 10) / 10,
      testDone: sum('testDone'),
    },
  };
}

/**
 * Compact packet for the sprint leadership-asks prompt (no full row dump).
 * @param {object} model - computeSprintPerformance output
 */
function buildSprintAsksIntelligence(model) {
  const cfg = model?.meta?.config || {};
  const slots = model?.meta?.slots || [];
  const windowLabel = slots.length
    ? `${slots[0].name}–${slots[slots.length - 1].name}`
    : '';
  const rankable = rankableTeams(model);
  const decliningTeams = rankable
    .filter((t) => t.trend?.recent != null && t.trend?.early != null
      && t.trend.early - t.trend.recent >= (cfg.improvementAlertPts || 8))
    .sort((a, b) => (b.trend.early - b.trend.recent) - (a.trend.early - a.trend.recent))
    .slice(0, 8)
    .map((t) => `${t.name} ${t.trend.early}→${t.trend.recent}%`);
  const improvingTeams = rankable
    .filter((t) => t.trend?.recent != null && t.trend?.early != null
      && t.trend.recent - t.trend.early >= (cfg.improvementAlertPts || 8))
    .sort((a, b) => (b.trend.recent - b.trend.early) - (a.trend.recent - a.trend.early))
    .slice(0, 5)
    .map((t) => `${t.name} ${t.trend.early}→${t.trend.recent}%`);
  const scopeCreepTeams = rankable
    .filter((t) => (t.window?.scopeCreep ?? 0) > (cfg.scopeCreepAlertPct || 15))
    .sort((a, b) => b.window.scopeCreep - a.window.scopeCreep)
    .slice(0, 8)
    .map((t) => `${t.name} ${t.window.scopeCreep}%`);

  const committed = model?.overall?.window?.committed || 0;
  const unmappedItems = model?.meta?.unmappedItems || 0;
  const unmappedPct = committed
    ? Math.round((1000 * unmappedItems) / committed) / 10
    : 0;

  const qaLag = buildQaLagSummary(model);
  const chronic = (model?.chronic || []).slice(0, 15).map((c) => ({
    key: c.key,
    summary: c.summary,
    sprints: c.sprints,
    assignee: c.assignee,
    scrumTeam: c.scrumTeam,
  }));

  return {
    teamId: model?.meta?.teamId,
    teamName: model?.meta?.teamName,
    window: windowLabel,
    generatedAt: model?.meta?.generatedAt,
    overall: {
      sayDo: model?.overall?.window?.sayDo,
      sayDoDevFinished: model?.overall?.window?.sayDoDevFinished,
      sayDoRecent: model?.overall?.recentSayDo,
      trendEarly: model?.overall?.trend?.early,
      trendRecent: model?.overall?.trend?.recent,
      scopeCreep: model?.overall?.window?.scopeCreep,
      pendingQA: model?.overall?.window?.pendingQA,
      committed,
      carried: model?.overall?.window?.carried,
      completion: model?.overall?.window?.completion,
      rag: model?.overall?.rag,
      unmappedItems,
      unmappedPct,
    },
    devFinishedGap: buildDevFinishedGap(model, rankable),
    qaLag,
    orgRankings: buildOrgRankings(model),
    velocityStreams: buildVelocityStreams(model),
    highlights: (model?.highlights || []).map((h) => h.text).slice(0, 8),
    lowlights: (model?.lowlights || []).map((h) => h.text).slice(0, 10),
    decliningTeams,
    improvingTeams,
    scopeCreepTeams,
    chronic,
    hygiene: {
      staleActive: (model?.hygiene?.staleActive || []).slice(0, 8),
      startedEmpty: (model?.hygiene?.startedEmpty || []).slice(0, 8),
      lateClosed: (model?.hygiene?.lateClosed || []).slice(0, 8),
    },
    seedAsks: (model?.asks || []).slice(0, 5),
  };
}

/**
 * Replace model.asks with AI output when NAI succeeds; keep rule-based on failure.
 * @param {object} model
 * @returns {Promise<object>} same model (mutated)
 */
async function enrichModelAsksWithAi(model) {
  if (!model) return model;
  const seed = Array.isArray(model.asks) ? model.asks.slice() : [];
  model.asksSource = 'rules';
  const intelligence = buildSprintAsksIntelligence(model);
  try {
    const asks = await generateSprintLeadershipAsks(intelligence);
    model.asks = asks;
    model.asksSource = 'ai';
    model.asksIntelligence = {
      chronicKeys: intelligence.chronic.map((c) => c.key),
      qaWaitKeys: (intelligence.qaLag?.longestWaits || []).map((w) => w.key),
      generatedAt: new Date().toISOString(),
    };
    logger.info(
      `[sprint-leadership-asks] AI asks ready for ${model.meta?.teamId}: ${asks.length} (was ${seed.length} seed)`
    );
  } catch (err) {
    model.asks = seed;
    model.asksSource = 'rules';
    model.asksError = err.message || String(err);
    logger.error(
      `[sprint-leadership-asks] Falling back to rule-based asks for ${model.meta?.teamId}`,
      err
    );
  }
  return model;
}

module.exports = {
  buildSprintAsksIntelligence,
  enrichModelAsksWithAi,
  // test helpers
  _internals: { buildDevFinishedGap, buildQaLagSummary, buildOrgRankings, buildVelocityStreams, daysBetween },
};
