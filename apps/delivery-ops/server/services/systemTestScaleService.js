/**
 * System-Test scale dashboard — live JIRA counts for
 * filter={teamCode}-System-Test with cf[13260] Regression? typing,
 * carry-over, components, and release trends.
 */
const fs = require('fs');
const path = require('path');
const { getJira } = require('../utils/jiraClient');
const { getTeamById, loadTeamBoardConfig, normalizeTeamId } = require('../utils/teamConfig');

const CONFIG_PATH = path.join(__dirname, '../config/systemTestScaleConfig.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function andParts(...parts) {
  return parts.filter(Boolean).join(' AND ');
}

function releaseScope(rel) {
  return `filter=${rel}-All`;
}

function deferredLabel(rel) {
  return `${String(rel || '').toLowerCase()}-deferred`;
}

/**
 * Resolve JIRA System-Test filter team code (e.g. NDB → filter=NDB-System-Test).
 */
function resolveTeamCode(team, teamCfg) {
  if (teamCfg?.teamCode) return String(teamCfg.teamCode).trim();
  if (team?.systemTestFilterCode) return String(team.systemTestFilterCode).trim();
  if (team?.releasePrefix) return String(team.releasePrefix).replace(/-+$/, '').trim();
  if (team?.labelPrefix) return String(team.labelPrefix).toUpperCase().trim();
  if (team?.name && /^[A-Za-z0-9]+$/.test(String(team.name).trim())) {
    return String(team.name).trim().toUpperCase();
  }
  return String(team?.id || 'ndb').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function buildKpiFilter(cfg, teamCode) {
  const tpl = cfg.kpiFilterTemplate || 'filter={teamCode}-System-Test';
  return tpl.replace(/\{teamCode\}/g, teamCode);
}

function flattenTeamComponents(team, teamCfg) {
  if (Array.isArray(teamCfg?.components) && teamCfg.components.length) {
    return teamCfg.components.slice();
  }
  const fc = team?.featureComponents || {};
  const out = [];
  const seen = new Set();
  Object.values(fc).forEach((arr) => {
    (arr || []).forEach((c) => {
      if (c && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    });
  });
  return out;
}

/**
 * Merge global config + per-team overrides into a runtime cfg used by builders.
 */
function resolveRuntimeConfig(teamId) {
  const cfg = loadConfig();
  const board = loadTeamBoardConfig();
  const requested = normalizeTeamId(teamId) || normalizeTeamId(cfg.defaultTeamId) || normalizeTeamId(board.defaultTeamId) || 'ndb';
  const team = getTeamById(requested) || getTeamById(cfg.defaultTeamId) || getTeamById(board.defaultTeamId);
  const effectiveTeamId = (team && team.id) || requested;
  const teamKey = normalizeTeamId(effectiveTeamId);
  const teamCfg = (cfg.teams && (cfg.teams[effectiveTeamId] || cfg.teams[teamKey] || cfg.teams.ndb)) || {};
  const teamCode = resolveTeamCode(team, teamCfg);
  const kpiFilter = buildKpiFilter(cfg, teamCode);
  const components = flattenTeamComponents(team, teamCfg);
  // Prefer per-team releases; fall back to legacy top-level cfg.releases.
  // Always coerce to a real array — a map-shaped `releases` object (from older
  // dashboard snapshots) would throw "cfg.releases is not iterable" later.
  let releases = [];
  if (Array.isArray(teamCfg.releases) && teamCfg.releases.length) {
    releases = teamCfg.releases.slice();
  } else if (Array.isArray(cfg.releases) && cfg.releases.length) {
    releases = cfg.releases.slice();
  } else if (team?.defaultReleaseVersion) {
    releases = [team.defaultReleaseVersion];
  }

  return {
    ...cfg,
    teamId: effectiveTeamId,
    teamName: team?.name || effectiveTeamId,
    teamCode,
    kpiFilter,
    releases: Array.isArray(releases) ? releases : [],
    defaultCurrentRelease: teamCfg.defaultCurrentRelease || cfg.defaultCurrentRelease || releases[releases.length - 1] || null,
    defaultCompareRelease: teamCfg.defaultCompareRelease || cfg.defaultCompareRelease || releases[0] || null,
    carryPairs: Array.isArray(teamCfg.carryPairs)
      ? teamCfg.carryPairs
      : (Array.isArray(cfg.carryPairs) ? cfg.carryPairs : []),
    componentReleases: Array.isArray(teamCfg.componentReleases) && teamCfg.componentReleases.length
      ? teamCfg.componentReleases
      : (Array.isArray(cfg.componentReleases) && cfg.componentReleases.length
        ? cfg.componentReleases
        : releases.slice(-2)),
    components,
    teamConfigured: releases.length > 0,
  };
}

function buildMetricJql(cfg, rel, key, component) {
  const kpi = cfg.kpiFilter;
  const base = andParts(kpi, releaseScope(rel), 'issuetype = Bug');
  const open = 'status not in (Resolved, Closed)';
  const types = cfg.regressionTypes;
  const map = {
    total: base,
    open: andParts(base, open),
    closed: andParts(base, 'status = Closed', 'resolution in (Fixed, Done, Resolved, Complete)'),
    tbv: andParts(base, 'status = Resolved', 'resolution is not EMPTY'),
    any: andParts(base, cfg.anyRegressionJql),
    b2b: andParts(base, types.b2b),
    r2r: andParts(base, types.r2r),
    yes: andParts(base, types.yes),
    no: andParts(base, types.no),
    empty: andParts(base, types.empty),
    anyOpen: andParts(base, cfg.anyRegressionJql, open),
    r2rOpen: andParts(base, types.r2r, open),
    b2bOpen: andParts(base, types.b2b, open),
    longevity: andParts(base, 'labels = longevity'),
    longevityOpen: andParts(base, 'labels = longevity', open),
    age30: andParts(base, open, 'created <= -30d'),
    age60: andParts(base, open, 'created <= -60d'),
    age90: andParts(base, open, 'created <= -90d'),
    reopen: andParts(base, 'status changed to Reopened'),
    fixed: andParts(base, 'status = Closed', 'resolution in (Fixed, Done, Resolved, Complete)'),
    deferred: andParts(kpi, 'issuetype = Bug', `labels = "${deferredLabel(rel)}"`),
    deferredOpen: andParts(kpi, 'issuetype = Bug', `labels = "${deferredLabel(rel)}"`, open),
  };
  let jql = map[key];
  if (!jql) return null;
  if (component) {
    jql = andParts(jql, `component = "${String(component).replace(/"/g, '\\"')}"`);
  }
  return jql;
}

function carryJql(cfg, prev, curr) {
  return andParts(
    cfg.kpiFilter,
    'issuetype = Bug',
    `labels = "${deferredLabel(prev)}"`,
    'status not in (Resolved, Closed)',
    releaseScope(curr)
  );
}

function cell(count, jql) {
  return { count: count || 0, jql };
}

function buildQueries(cfg) {
  const queries = {};
  const kpi = cfg.kpiFilter;
  const open = 'status not in (Resolved, Closed)';

  queries['kpi|all'] = andParts(kpi, 'issuetype = Bug');
  queries['kpi|open'] = andParts(kpi, 'issuetype = Bug', open);
  queries['kpi|any'] = andParts(kpi, 'issuetype = Bug', cfg.anyRegressionJql);
  queries['kpi|b2b'] = andParts(kpi, 'issuetype = Bug', cfg.regressionTypes.b2b);
  queries['kpi|r2r'] = andParts(kpi, 'issuetype = Bug', cfg.regressionTypes.r2r);
  queries['kpi|no'] = andParts(kpi, 'issuetype = Bug', cfg.regressionTypes.no);
  queries['kpi|empty'] = andParts(kpi, 'issuetype = Bug', cfg.regressionTypes.empty);

  const metricKeys = [
    'total', 'open', 'closed', 'tbv', 'any', 'b2b', 'r2r', 'yes', 'no', 'empty',
    'anyOpen', 'r2rOpen', 'b2bOpen', 'longevity', 'longevityOpen',
    'age30', 'age60', 'age90', 'reopen', 'fixed', 'deferred', 'deferredOpen',
  ];

  for (const rel of cfg.releases) {
    for (const key of metricKeys) {
      queries[`rel|${rel}|${key}`] = buildMetricJql(cfg, rel, key);
    }
  }

  const pairKeys = new Set();
  const addPair = (p, c) => {
    if (!p || !c || p === c) return;
    const key = `${p}->${c}`;
    if (pairKeys.has(key)) return;
    pairKeys.add(key);
    queries[`carry|${key}`] = carryJql(cfg, p, c);
  };
  for (const pair of cfg.carryPairs || []) {
    if (Array.isArray(pair) && pair.length >= 2) addPair(pair[0], pair[1]);
  }
  for (let i = 0; i < cfg.releases.length; i++) {
    for (let j = i + 1; j < cfg.releases.length; j++) {
      addPair(cfg.releases[i], cfg.releases[j]);
    }
  }

  for (const rel of cfg.componentReleases || []) {
    for (const c of cfg.components || []) {
      queries[`comp|${rel}|${c}|open`] = buildMetricJql(cfg, rel, 'open', c);
      queries[`comp|${rel}|${c}|any`] = buildMetricJql(cfg, rel, 'any', c);
      queries[`comp|${rel}|${c}|r2rOpen`] = buildMetricJql(cfg, rel, 'r2rOpen', c);
    }
  }

  return queries;
}

async function runCounts(token, queries, concurrency = 8) {
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

function releaseBlock(cfg, results, rel) {
  const g = (key) => results[`rel|${rel}|${key}`] || 0;
  const total = g('total');
  const any = g('any');
  const fixed = g('fixed');
  const reopen = g('reopen');
  const mk = (key) => cell(g(key), buildMetricJql(cfg, rel, key));

  return {
    total: mk('total'),
    open: mk('open'),
    closed: mk('closed'),
    tbv: mk('tbv'),
    any: mk('any'),
    b2b: mk('b2b'),
    r2r: mk('r2r'),
    yes: mk('yes'),
    no: mk('no'),
    empty: mk('empty'),
    anyOpen: mk('anyOpen'),
    r2rOpen: mk('r2rOpen'),
    b2bOpen: mk('b2bOpen'),
    longevity: mk('longevity'),
    longevityOpen: mk('longevityOpen'),
    age30: mk('age30'),
    age60: mk('age60'),
    age90: mk('age90'),
    reopen: mk('reopen'),
    fixed: mk('fixed'),
    deferred: mk('deferred'),
    deferredOpen: mk('deferredOpen'),
    rates: {
      regressionRate: total ? Math.round((1000 * any) / total) / 10 : 0,
      escapeRate: any ? Math.round((1000 * g('r2r')) / any) / 10 : 0,
      reopenRate: fixed ? Math.round((1000 * reopen) / fixed) / 10 : 0,
    },
  };
}

function buildTrends(cfg, byRelease) {
  const keys = [
    { key: 'total', label: 'Total bugs' },
    { key: 'open', label: 'Open bugs' },
    { key: 'any', label: 'Typed regressions (Yes*)' },
    { key: 'b2b', label: 'Build-to-build' },
    { key: 'r2r', label: 'Release-to-release' },
    { key: 'tbv', label: 'TBV (awaiting QA)' },
    { key: 'age90', label: 'Open ≥90d' },
    { key: 'longevityOpen', label: 'Longevity open' },
  ];
  const shortOf = (rel) => {
    const prefix = cfg.teamCode ? `${cfg.teamCode}-` : '';
    const s = String(rel || '');
    if (prefix && s.startsWith(prefix)) return s.slice(prefix.length);
    if (s.startsWith('NDB-')) return s.slice(4);
    return s;
  };

  return {
    releaseOrder: cfg.releases.slice(),
    series: keys.map(({ key, label }) => ({
      key,
      label,
      points: cfg.releases.map((rel) => {
        const block = byRelease[rel] || {};
        const metric = block[key] || { count: 0, jql: buildMetricJql(cfg, rel, key) };
        return {
          release: rel,
          short: shortOf(rel),
          value: metric.count || 0,
          jql: metric.jql,
        };
      }),
    })),
    rateSeries: [
      {
        key: 'regressionRate',
        label: 'Regression rate %',
        points: cfg.releases.map((rel) => ({
          release: rel,
          short: shortOf(rel),
          value: (byRelease[rel]?.rates?.regressionRate) || 0,
          jql: byRelease[rel]?.any?.jql || buildMetricJql(cfg, rel, 'any'),
        })),
      },
      {
        key: 'escapeRate',
        label: 'Escape rate % (R2R ÷ Yes*)',
        points: cfg.releases.map((rel) => ({
          release: rel,
          short: shortOf(rel),
          value: (byRelease[rel]?.rates?.escapeRate) || 0,
          jql: byRelease[rel]?.r2r?.jql || buildMetricJql(cfg, rel, 'r2r'),
        })),
      },
    ],
  };
}

function computeRag(curr) {
  const r2rOpen = curr?.r2rOpen?.count || 0;
  const anyOpen = curr?.anyOpen?.count || 0;
  const age90 = curr?.age90?.count || 0;
  const escape = curr?.rates?.escapeRate || 0;
  const open = curr?.open?.count || 0;
  if (r2rOpen > 0 || (anyOpen >= 3 && age90 >= 10)) {
    return {
      level: 'red',
      why: r2rOpen > 0
        ? `${r2rOpen} open release-to-release regression(s) still active.`
        : `${anyOpen} open regressions with ${age90} bugs aged ≥90d.`,
    };
  }
  if (anyOpen > 0 || escape >= 40 || open >= 15) {
    return {
      level: 'yellow',
      why: [
        anyOpen ? `${anyOpen} open typed regression(s)` : null,
        escape ? `escape rate ${escape}%` : null,
        open ? `${open} open System-Test bugs` : null,
      ].filter(Boolean).join(' · ') + '.',
    };
  }
  return {
    level: 'green',
    why: 'No open typed regressions; open volume and escape mix look controlled.',
  };
}

async function getDashboard({
  token,
  teamId,
  currentRelease,
  compareRelease,
} = {}) {
  const cfg = resolveRuntimeConfig(teamId);
  if (!Array.isArray(cfg.releases)) cfg.releases = [];
  if (!cfg.releases.length) {
    const err = new Error(
      `No System-Test releases configured for team "${cfg.teamId}". Add an entry under systemTestScaleConfig.teams.${cfg.teamId}.`
    );
    err.statusCode = 400;
    throw err;
  }

  const curr = currentRelease || cfg.defaultCurrentRelease;
  const prev = compareRelease || cfg.defaultCompareRelease;

  const t0 = Date.now();
  const queries = buildQueries(cfg);
  const requestedCarry = `carry|${prev}->${curr}`;
  if (!queries[requestedCarry] && prev && curr && prev !== curr) {
    queries[requestedCarry] = carryJql(cfg, prev, curr);
  }
  const { results, errors } = await runCounts(token, queries);

  const byRelease = {};
  for (const rel of cfg.releases) {
    byRelease[rel] = releaseBlock(cfg, results, rel);
  }

  const carry = {};
  for (const k of Object.keys(results)) {
    if (!k.startsWith('carry|')) continue;
    const pair = k.slice('carry|'.length);
    const [p, c] = pair.split('->');
    carry[pair] = cell(results[k], carryJql(cfg, p, c));
  }

  const components = {};
  for (const rel of cfg.componentReleases || []) {
    const rows = [];
    for (const c of cfg.components || []) {
      const openC = results[`comp|${rel}|${c}|open`] || 0;
      const anyC = results[`comp|${rel}|${c}|any`] || 0;
      const r2rC = results[`comp|${rel}|${c}|r2rOpen`] || 0;
      if (openC || anyC || r2rC) {
        rows.push({
          name: c,
          open: cell(openC, buildMetricJql(cfg, rel, 'open', c)),
          any: cell(anyC, buildMetricJql(cfg, rel, 'any', c)),
          r2rOpen: cell(r2rC, buildMetricJql(cfg, rel, 'r2rOpen', c)),
        });
      }
    }
    rows.sort((a, b) =>
      (b.r2rOpen.count - a.r2rOpen.count) ||
      (b.any.count - a.any.count) ||
      (b.open.count - a.open.count)
    );
    components[rel] = rows;
  }

  return {
    generatedAt: new Date().toISOString(),
    fetchSeconds: Math.round((Date.now() - t0) / 100) / 10,
    queryCount: Object.keys(queries).length,
    teamId: cfg.teamId,
    teamName: cfg.teamName,
    teamCode: cfg.teamCode,
    kpiFilter: cfg.kpiFilter,
    regressionField: cfg.regressionField,
    regressionFieldName: cfg.regressionFieldName,
    jiraBaseUrl: process.env.JIRA_BASE_URL || cfg.jiraBaseUrlDefault,
    releases: cfg.releases.slice(),
    currentRelease: curr,
    compareRelease: prev,
    current: byRelease[curr] || byRelease[cfg.defaultCurrentRelease] || {},
    compare: byRelease[prev] || byRelease[cfg.defaultCompareRelease] || {},
    rag: computeRag(byRelease[curr] || {}),
    byRelease,
    kpiGlobal: {
      all: cell(results['kpi|all'], andParts(cfg.kpiFilter, 'issuetype = Bug')),
      open: cell(results['kpi|open'], andParts(cfg.kpiFilter, 'issuetype = Bug', 'status not in (Resolved, Closed)')),
      any: cell(results['kpi|any'], andParts(cfg.kpiFilter, 'issuetype = Bug', cfg.anyRegressionJql)),
      b2b: cell(results['kpi|b2b'], andParts(cfg.kpiFilter, 'issuetype = Bug', cfg.regressionTypes.b2b)),
      r2r: cell(results['kpi|r2r'], andParts(cfg.kpiFilter, 'issuetype = Bug', cfg.regressionTypes.r2r)),
      no: cell(results['kpi|no'], andParts(cfg.kpiFilter, 'issuetype = Bug', cfg.regressionTypes.no)),
      empty: cell(results['kpi|empty'], andParts(cfg.kpiFilter, 'issuetype = Bug', cfg.regressionTypes.empty)),
    },
    carry,
    components,
    trends: buildTrends(cfg, byRelease),
    errors,
  };
}

module.exports = {
  loadConfig,
  resolveRuntimeConfig,
  resolveTeamCode,
  getDashboard,
  buildMetricJql,
  carryJql,
};
