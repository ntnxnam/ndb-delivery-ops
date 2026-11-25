/**
 * OnCalls runtime config + JQL helpers (no emitted-JQL changes).
 */

const fs = require('fs');
const path = require('path');
const { loadKpiConfigSync, getKpisForTeam, normalizeTeamId, getTeamBaseFilter, getTeamById } = require('../utils/teamConfig');

const CONFIG_PATH = path.join(__dirname, '../config/oncallConfig.json');

let configCache = { data: null, mtimeMs: -1 };
function loadConfig() {
  try {
    const mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
    if (configCache.data && configCache.mtimeMs === mtimeMs) return configCache.data;
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    configCache = { data, mtimeMs };
    return data;
  } catch {
    if (configCache.data) return configCache.data;
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
}

function andParts(...parts) {
  return parts.filter(Boolean).join(' AND ');
}

function cell(count, jql) {
  return { count: count || 0, jql: jql || null };
}

function keysInJql(keys) {
  const uniq = [...new Set((keys || []).filter(Boolean))];
  if (!uniq.length) return null;
  if (uniq.length === 1) return `key = ${uniq[0]}`;
  return `key in (${uniq.join(',')})`;
}

function pushUnique(target, keys) {
  for (const k of keys || []) {
    if (k && !target.includes(k)) target.push(k);
  }
}

function escComponent(c) {
  const s = String(c || '').trim();
  if (!s) return null;
  // JIRA component names with spaces/commas/parens must be quoted; escape " and \
  const esc = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (/[,\s"()]/.test(s)) return `"${esc}"`;
  return esc;
}

function buildOncallTeamClause(team) {
  if (!team) return null;
  const parts = [];
  // component clause — from team.components (admin chips, canonical source)
  const comps = Array.isArray(team.components) ? team.components : [];
  const compTokens = comps.map(escComponent).filter(Boolean);
  if (compTokens.length) parts.push(`component in (${compTokens.join(', ')})`);
  // assignee clause — leader DLs are team ownership signal per team-config-auto-jql
  const dls = Array.isArray(team.leader_outlook_dls) ? team.leader_outlook_dls : [];
  const dlTokens = dls.map((d) => String(d || '').trim()).filter(Boolean).map((d) => `membersOf("${d.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`);
  if (dlTokens.length) parts.push(`assignee in (${dlTokens.join(', ')})`);
  // OnCall issuetype is team-agnostic but indicates OnCall origin — always include for ONCALL project scope
  parts.push('issuetype in ("Era Oncall", "ERA Oncall")');
  if (!parts.length) return null;
  return parts.join(' OR ');
}

function resolveRuntimeConfig(teamId) {
  const cfg = loadConfig();
  const requested = normalizeTeamId(teamId) || normalizeTeamId(cfg.defaultTeamId) || 'ndb';
  const teamCfg = (cfg.teams && (cfg.teams[requested] || cfg.teams[normalizeTeamId(requested)])) || {};

  let onCallProject = teamCfg.onCallProject || cfg.onCallProject || 'OnCall';
  // Scope from kpiConfig OnCalls KPI baseQuery + team baseFilter (AND) — never hard-code filter names here
  let baseScopeJql = String(teamCfg.baseScopeJql || cfg.baseScopeJql || '').trim();
  try {
    // loadKpiConfigSync() returns the teams map directly (not { teams: ... })
    const kpiTeams = loadKpiConfigSync();
    const { kpis } = getKpisForTeam(kpiTeams, requested);
    const onCallsKpi = (kpis || []).find((k) => /oncalls?/i.test(k.name || ''));
    if (onCallsKpi?.baseQuery) {
      baseScopeJql = String(onCallsKpi.baseQuery).trim();
      const m = baseScopeJql.match(/project\s*=\s*([A-Za-z][A-Za-z0-9_]*)/i);
      if (m && !/TH|TechHelp/i.test(m[1])) onCallProject = m[1];
    }
  } catch (_) {
    // keep config override / empty
  }
  // AND with team-scoped OnCall clause so NDB sees only NDB OnCalls.
  // Do NOT blindly AND the full teamBaseFilter — for ONCALL project the
  // shared `project in (ERA,NDBECO) OR (project in (ENG,FEAT,ONCALL...) AND (ownership))`
  // branch makes `project=ONCALL AND project in (ERA,NDBECO)` impossible and
  // zeros the pulse/hero counts (flatline). Instead scope ONCALL via ownership only.
  try {
    const isOncallScope = /^\s*project\s*=\s*ONCALL\s*$/i.test(baseScopeJql);
    if (isOncallScope) {
      const team = getTeamById(requested);
      const teamClause = buildOncallTeamClause(team);
      if (teamClause) {
        baseScopeJql = `(${baseScopeJql}) AND (${teamClause})`;
      }
    } else if (baseScopeJql) {
      const teamBaseFilter = getTeamBaseFilter(requested);
      if (teamBaseFilter) {
        baseScopeJql = `(${teamBaseFilter}) AND (${baseScopeJql})`;
      }
    }
  } catch (_) {}

  const esc = { ...(cfg.escalation || {}), ...(teamCfg.escalation || {}) };

  return {
    ...cfg,
    ...teamCfg,
    teamId: requested,
    onCallProject,
    baseScopeJql,
    techHelpProjects: teamCfg.techHelpProjects || cfg.techHelpProjects || ['TH', 'TechHelp'],
    knowledgeProjects: teamCfg.knowledgeProjects || cfg.knowledgeProjects || ['SR'],
    techPubsProjects: teamCfg.techPubsProjects || cfg.techPubsProjects || ['TECHPUBS'],
    engFixProjects: teamCfg.engFixProjects || cfg.engFixProjects || [],
    agedOpenDays: teamCfg.agedOpenDays || cfg.agedOpenDays || 14,
    needInfoDays: teamCfg.needInfoDays || cfg.needInfoDays || 10,
    waitingForCustomerDays: teamCfg.waitingForCustomerDays || cfg.waitingForCustomerDays || 21,
    pastLookbackDays: teamCfg.pastLookbackDays || cfg.pastLookbackDays || 30,
    openStatusJql: teamCfg.openStatusJql || cfg.openStatusJql || 'statusCategory != Done',
    doneStatusJql: teamCfg.doneStatusJql || cfg.doneStatusJql || 'statusCategory = Done',
    maxOpenIssuesFetch: cfg.maxOpenIssuesFetch || 200,
    maxPastIssuesFetch: cfg.maxPastIssuesFetch || 200,
    jiraBaseUrl: cfg.jiraBaseUrl || 'https://jira.nutanix.com',
    escalation: {
      kpiNamePattern: esc.kpiNamePattern || 'CFD|CFI',
      lookbackDays: esc.lookbackDays || 180,
      maxOncallsFetch: esc.maxOncallsFetch || 300,
      maxRows: esc.maxRows || 40,
      clock: esc.clock || 'oncall_created_to_linked_resolved',
    },
  };
}

function baseJql(cfg) {
  const scope = String(cfg.baseScopeJql || '').trim();
  if (scope) return `(${scope})`;
  return `project = ${cfg.onCallProject}`;
}

/** OnCall-project seeds only — for stack / CFD escalation (not TH union rows). */
function oncallSeedJql(cfg) {
  return andParts(baseJql(cfg), `project = ${cfg.onCallProject}`);
}

/** Escape inner JQL for ScriptRunner linkedIssuesOf("…"). */
function escapeLinkedIssuesOfInner(jql) {
  return String(jql || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/**
 * Issues in `seedJql` that link into tickets matching `targetInnerJql`.
 * Shape: (seed) AND issueFunction in linkedIssuesOf("<target>")
 */
function linkedIntoJql(seedJql, targetInnerJql) {
  const seed = String(seedJql || '').trim();
  const inner = String(targetInnerJql || '').trim();
  if (!seed || !inner) return null;
  return andParts(seed, `issueFunction in linkedIssuesOf("${escapeLinkedIssuesOfInner(inner)}")`);
}

/**
 * ALL tickets linked from the team OnCalls KPI baseQuery (kpiConfig).
 * Shape: issueFunction in linkedIssuesOf("<OnCalls KPI baseQuery>")
 * No open/closed filter — full linked universe.
 */
function linkedOutJql(cfg) {
  const scope = String(cfg.baseScopeJql || '').trim();
  if (!scope) return null;
  return `issueFunction in linkedIssuesOf("${escapeLinkedIssuesOfInner(scope)}")`;
}

function openJql(cfg) {
  // Pulse "Open" = open OnCall seeds (same universe as path sampling) — not TH union rows
  return andParts(oncallSeedJql(cfg), cfg.openStatusJql);
}

/** Recently closed OnCall seeds (past window). */
function pastClosedJql(cfg) {
  const days = cfg.pastLookbackDays || 30;
  return andParts(
    oncallSeedJql(cfg),
    cfg.doneStatusJql || 'statusCategory = Done',
    `resolved >= -${days}d`
  );
}

function buildHeroQueries(cfg) {
  const seed = oncallSeedJql(cfg);
  const open = openJql(cfg);
  const aged = cfg.agedOpenDays;
  return {
    all: seed,
    open,
    closed7d: andParts(seed, 'statusCategory = Done', 'resolved >= -7d'),
    created7d: andParts(seed, 'created >= -7d'),
    agedOpen: andParts(open, `created <= -${aged}d`),
    p0Open: andParts(open, 'priority = "Blocker - P0"'),
    p1Open: andParts(open, 'priority = "Critical - P1"'),
    createdPrev7d: andParts(seed, 'created >= -14d', 'created < -7d'),
    closedPrev7d: andParts(seed, 'statusCategory = Done', 'resolved >= -14d', 'resolved < -7d'),
  };
}

module.exports = {
  loadConfig,
  andParts,
  cell,
  keysInJql,
  pushUnique,
  resolveRuntimeConfig,
  baseJql,
  oncallSeedJql,
  escapeLinkedIssuesOfInner,
  linkedIntoJql,
  linkedOutJql,
  openJql,
  pastClosedJql,
  buildHeroQueries,
  buildOncallTeamClause,
};
