/**
 * CFD/CFI runtime config + JQL helpers — mirrors oncallConfigResolve.
 * Product-agnostic: derives baseScopeJql from kpiConfig CFD|CFI clubbed + team baseFilter.
 */

const fs = require('fs');
const path = require('path');
const { loadKpiConfigSync, getKpisForTeam, normalizeTeamId, getTeamBaseFilter } = require('../utils/teamConfig');

const CONFIG_PATH = path.join(__dirname, '../config/cfdcfiConfig.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
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

function escapeLinkedIssuesOfInner(jql) {
  return String(jql || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function linkedIntoJql(seedJql, targetInnerJql) {
  const seed = String(seedJql || '').trim();
  const inner = String(targetInnerJql || '').trim();
  if (!seed || !inner) return null;
  return andParts(seed, `issueFunction in linkedIssuesOf("${escapeLinkedIssuesOfInner(inner)}")`);
}

function linkedOutJql(cfg) {
  const scope = String(cfg.baseScopeJql || '').trim();
  if (!scope) return null;
  return `issueFunction in linkedIssuesOf("${escapeLinkedIssuesOfInner(scope)}")`;
}

function resolveRuntimeConfig(teamId) {
  const cfg = loadConfig();
  const requested = normalizeTeamId(teamId) || normalizeTeamId(cfg.defaultTeamId) || 'ndb';
  const teamCfg = (cfg.teams && (cfg.teams[requested] || cfg.teams[normalizeTeamId(requested)])) || {};

  let baseScopeJql = String(teamCfg.baseScopeJql || cfg.baseScopeJql || '').trim();
  // Derive from kpiConfig CFD|CFI KPIs (clubbed baseQueries) + team baseFilter
  try {
    const kpiTeams = loadKpiConfigSync();
    const { kpis } = getKpisForTeam(kpiTeams, requested);
    const pattern = new RegExp(cfg.kpiNamePattern || 'CFD|CFI', 'i');
    const matched = (kpis || []).filter((k) => k && k.name && k.baseQuery && pattern.test(k.name) && !/oncalls?/i.test(k.name));
    if (matched.length) {
      const clubbed = matched.map((k) => `(${k.baseQuery})`).join(' OR ');
      baseScopeJql = clubbed;
    }
  } catch (_) {
    // keep config override / empty
  }
  try {
    const teamBaseFilter = getTeamBaseFilter(requested);
    if (teamBaseFilter && baseScopeJql) {
      baseScopeJql = `(${teamBaseFilter}) AND (${baseScopeJql})`;
    }
  } catch (_) {}

  const esc = { ...(cfg.escalation || {}), ...(teamCfg.escalation || {}) };

  return {
    ...cfg,
    ...teamCfg,
    teamId: requested,
    baseScopeJql,
    techHelpProjects: teamCfg.techHelpProjects || cfg.techHelpProjects || ['TH', 'TechHelp'],
    techPubsProjects: teamCfg.techPubsProjects || cfg.techPubsProjects || ['TECHPUBS'],
    knowledgeProjects: teamCfg.knowledgeProjects || cfg.knowledgeProjects || ['SR'],
    agedOpenDays: teamCfg.agedOpenDays || cfg.agedOpenDays || 14,
    needInfoDays: teamCfg.needInfoDays || cfg.needInfoDays || 10,
    waitingForCustomerDays: teamCfg.waitingForCustomerDays || cfg.waitingForCustomerDays || 21,
    pastLookbackDays: teamCfg.pastLookbackDays || cfg.pastLookbackDays || 30,
    openStatusJql: teamCfg.openStatusJql || cfg.openStatusJql || 'statusCategory != Done',
    doneStatusJql: teamCfg.doneStatusJql || cfg.doneStatusJql || 'statusCategory = Done',
    maxOpenIssuesFetch: cfg.maxOpenIssuesFetch || 200,
    maxPastIssuesFetch: cfg.maxPastIssuesFetch || 200,
    jiraBaseUrl: cfg.jiraBaseUrl || 'https://jira.nutanix.com',
    rag: { ...(cfg.rag || {}), ...(teamCfg.rag || {}) },
    slaThresholds: { ...(cfg.slaThresholds || {}), ...(teamCfg.slaThresholds || {}) },
    customFields: { ...(cfg.customFields || {}), ...(teamCfg.customFields || {}) },
    escalation: {
      kpiNamePattern: esc.kpiNamePattern || 'CFD|CFI',
      lookbackDays: esc.lookbackDays || 180,
      maxIssuesFetch: esc.maxIssuesFetch || 300,
      maxRows: esc.maxRows || 40,
      clock: esc.clock || 'created_to_resolved',
    },
  };
}

function baseJql(cfg) {
  const scope = String(cfg.baseScopeJql || '').trim();
  if (scope) return `(${scope})`;
  return '';
}

function cfdcfiSeedJql(cfg) {
  return baseJql(cfg);
}

function openJql(cfg) {
  return andParts(cfdcfiSeedJql(cfg), cfg.openStatusJql || 'statusCategory != Done');
}

function closedJql(cfg) {
  return andParts(cfdcfiSeedJql(cfg), cfg.doneStatusJql || 'statusCategory = Done');
}

function pastClosedJql(cfg) {
  const days = cfg.pastLookbackDays || 30;
  return andParts(cfdcfiSeedJql(cfg), cfg.doneStatusJql || 'statusCategory = Done', `resolved >= -${days}d`);
}

function buildHeroQueries(cfg) {
  const seed = cfdcfiSeedJql(cfg);
  const open = openJql(cfg);
  const aged = cfg.agedOpenDays || 14;
  return {
    all: seed,
    open,
    closed7d: andParts(seed, 'statusCategory = Done', 'resolved >= -7d'),
    created7d: andParts(seed, 'created >= -7d'),
    agedOpen: andParts(open, `created <= -${aged}d`),
    p0Open: andParts(open, 'priority = "Blocker - P0"'),
    p1Open: andParts(open, 'priority = "Critical - P1"'),
    tbv: andParts(seed, 'status = Resolved', 'resolution is not EMPTY'),
    createdPrev7d: andParts(seed, 'created >= -14d', 'created < -7d'),
    closedPrev7d: andParts(seed, 'statusCategory = Done', 'resolved >= -14d', 'resolved < -7d'),
  };
}

function buildTimeframeHeroQueries(cfg, timeframe) {
  const heroQueries = buildHeroQueries(cfg);
  return heroQueries;
}

module.exports = {
  loadConfig,
  andParts,
  cell,
  keysInJql,
  pushUnique,
  escapeLinkedIssuesOfInner,
  linkedIntoJql,
  linkedOutJql,
  resolveRuntimeConfig,
  baseJql,
  cfdcfiSeedJql,
  openJql,
  closedJql,
  pastClosedJql,
  buildHeroQueries,
  buildTimeframeHeroQueries,
};
