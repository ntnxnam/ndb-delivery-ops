/**
 * CFD/CFI dashboard — team KPIs matching kpiNamePattern, each with KPI Pulse + open tickets.
 * KPI names/ids are never hard-coded (kpi-config-driven).
 */
const fs = require('fs');
const path = require('path');
const { loadKpiConfigSync, getKpisForTeam, normalizeTeamId } = require('../utils/teamConfig');
const { buildKpiCombinedJql, resolveKpiJql } = require('./kpiService');
const { buildPulse } = require('./kpiPulseService');
const { searchPages, getJira } = require('../utils/jiraClient');
const { daysBetween } = require('./ticketNarrativeService');
const { mapExtraTicketFields, withExtraTicketFields } = require('../utils/ticketRowFields');
const logger = require('../utils/logger');

const CONFIG_PATH = path.join(__dirname, '../config/cfdcfiConfig.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * Team KPIs whose names match cfdcfiConfig.kpiNamePattern (exclude OnCalls).
 */
function resolveCfdCfiKpis(teamId, cfg) {
  const pattern = new RegExp(cfg.kpiNamePattern || 'CFD|CFI', 'i');
  const kpiTeams = loadKpiConfigSync();
  const { kpis, normalizedTeamId } = getKpisForTeam(kpiTeams, teamId);
  const matched = (kpis || [])
    .filter((k) => k && k.name && pattern.test(k.name) && !/oncalls?/i.test(k.name))
    .map((k) => ({ id: k.id, name: k.name, baseQuery: k.baseQuery, order: k.order }));
  return { matched, normalizedTeamId };
}

function mapOpenIssue(issue) {
  const f = issue.fields || issue;
  const status = f.status?.name || f.status || null;
  const priority = f.priority?.name || f.priority || null;
  const assignee =
    f.assignee?.displayName || f.assignee?.name || f.assignee?.emailAddress || null;
  const created = f.created || null;
  const ageDays = daysBetween(created, new Date().toISOString());
  return {
    key: issue.key,
    summary: f.summary || '',
    status,
    priority,
    assignee,
    ...mapExtraTicketFields(f),
    ageDays,
  };
}

async function buildKpiSlice({ token, teamId, kpi, cfg }) {
  // Open-scoped JQL (team base often includes statusCategory!=Done) — for open list / tab chips.
  const combinedJql = await buildKpiCombinedJql(teamId, kpi.baseQuery, token, null);
  // Pulse / flow chart must use the KPI filter alone (includes Done). Composing onto the
  // open-only team base zeros Created / →Resolved / →Closed because closed tickets drop out.
  const pulseBaseJql =
    (await resolveKpiJql(kpi.baseQuery, token, null)) || kpi.baseQuery || null;
  if (!combinedJql && !pulseBaseJql) {
    return {
      id: kpi.id,
      name: kpi.name,
      baseQuery: kpi.baseQuery,
      combinedJql: null,
      pulse: null,
      openTickets: { total: 0, truncated: false, jql: null, issues: [] },
      error: 'Could not resolve KPI JQL',
    };
  }

  const openBase = combinedJql || pulseBaseJql;
  const openJql = `(${openBase}) AND (${cfg.openStatusJql || 'statusCategory != Done'})`;
  const maxOpen = cfg.maxOpenTickets || 80;

  let pulse = null;
  let pulseError = null;
  try {
    pulse = await buildPulse({
      token,
      baseJql: pulseBaseJql || combinedJql,
      optionalHeroes: cfg.optionalHeroes || { p0: true, p1: true, tbv: true },
    });
  } catch (err) {
    pulseError = err.message || String(err);
    logger.jira.warning('cfdcfi', `buildPulse failed for ${kpi.name}: ${pulseError}`);
  }

  let openTickets = { total: 0, truncated: false, jql: openJql, issues: [] };
  try {
    const jira = await getJira(token);
    let total = 0;
    try {
      total = await jira.searchCount(openJql);
    } catch (_) {
      total = 0;
    }
    const raw = await searchPages(
      token,
      `${openJql} ORDER BY priority ASC, updated DESC`,
      withExtraTicketFields('summary,status,priority,assignee,updated,issuetype'),
      { pageSize: 50, maxTotal: maxOpen, timeoutMs: 45000, delayMs: 150 }
    );
    const issues = (raw || []).map(mapOpenIssue);
    openTickets = {
      total: total || issues.length,
      truncated: (total || 0) > issues.length,
      jql: openJql,
      issues,
    };
  } catch (err) {
    openTickets.error = err.message || String(err);
    logger.jira.warning('cfdcfi', `open tickets failed for ${kpi.name}: ${openTickets.error}`);
  }

  return {
    id: kpi.id,
    name: kpi.name,
    baseQuery: kpi.baseQuery,
    order: kpi.order,
    combinedJql,
    pulse,
    openTickets,
    error: pulseError || null,
  };
}

async function getDashboard({ token, teamId }) {
  if (!token) throw Object.assign(new Error('JIRA token required'), { statusCode: 401 });
  const cfg = loadConfig();
  const requested = normalizeTeamId(teamId) || 'ndb';
  const { matched, normalizedTeamId } = resolveCfdCfiKpis(requested, cfg);
  const effectiveTeamId = normalizedTeamId || requested;

  if (!matched.length) {
    return {
      teamId: effectiveTeamId,
      jiraBaseUrl: cfg.jiraBaseUrl || 'https://jira.nutanix.com',
      kpiNamePattern: cfg.kpiNamePattern || 'CFD|CFI',
      asOf: new Date().toISOString(),
      kpis: [],
      emptyReason: `No KPIs for this team match “${cfg.kpiNamePattern || 'CFD|CFI'}”. Add them on the KPIs page.`,
    };
  }

  const slices = await Promise.all(
    matched.map((kpi) => buildKpiSlice({ token, teamId: effectiveTeamId, kpi, cfg }))
  );

  slices.sort((a, b) => {
    const ao = a.order != null ? a.order : 999;
    const bo = b.order != null ? b.order : 999;
    if (ao !== bo) return ao - bo;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    teamId: effectiveTeamId,
    jiraBaseUrl: cfg.jiraBaseUrl || 'https://jira.nutanix.com',
    kpiNamePattern: cfg.kpiNamePattern || 'CFD|CFI',
    asOf: new Date().toISOString(),
    kpis: slices,
  };
}

module.exports = {
  getDashboard,
  resolveCfdCfiKpis,
  loadConfig,
};
