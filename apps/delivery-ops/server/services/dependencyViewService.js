/**
 * dependencyViewService — read-only Dependency View overview (Q1–Q6).
 * No JIRA mutates. JQL builders match agent-pack/context/domain/cross-team-dependencies.md.
 */
const fs = require('fs');
const path = require('path');
const { runSearchByJql } = require('../utils/jiraSearchByJql');
const { getTeamById, loadTeamBoardConfig, normalizeTeamId } = require('../utils/teamConfig');
const jiraFieldsConfig = require('../config/jiraFieldsConfig.json');

const CONFIG_PATH = path.join(__dirname, '../config/dependencyViewConfig.json');
const RELEASE_CFG_PATH = path.join(__dirname, '../config/releaseVersionsEmailConfig.json');
const RELEASE_COMMIT_FIELD =
  jiraFieldsConfig?.fields?.indicators?.releaseCommit?.id || 'customfield_11061';

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadReleaseGates() {
  try {
    return JSON.parse(fs.readFileSync(RELEASE_CFG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function jiraSearchUrl(base, jql) {
  const root = String(base || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return `${root}/issues/?jql=${encodeURIComponent(jql)}`;
}

/** Q1 — Companion hierarchy under a root project ticket */
function buildCompanionHierarchyJql(rootKey) {
  return [
    `key = ${rootKey}`,
    `OR "Parent Link" = ${rootKey}`,
    `OR issueFunction in issuesInEpics("\\"Parent Link\\" = ${rootKey} and type = Epic")`,
  ].join('\n');
}

/** Q2 — External / non-NDB-owned slice */
function buildCompanionExternalJql(rootKey, scopeGroups) {
  const members = (scopeGroups || [])
    .map((g) => `membersOf("${g}")`)
    .join(', ');
  return [
    '(',
    `  key = ${rootKey}`,
    `  OR "Parent Link" = ${rootKey}`,
    `  OR issueFunction in issuesInEpics("\\"Parent Link\\" = ${rootKey} and type = Epic")`,
    ')',
    'AND (',
    '  project != ERA',
    `  OR assignee not in (${members})`,
    ')',
  ].join('\n');
}

/** Q3 — Partnership: I wait on them */
function buildPartnershipBlockedByJql(release) {
  return `issueFunction in linkedIssuesOf("fixVersion = ${release}", "is blocked by")`;
}

/** Q4 — Partnership: they wait on me */
function buildPartnershipBlocksJql(release) {
  return `issueFunction in linkedIssuesOf("fixVersion = ${release}", "blocks")`;
}

/** Q5 — Train label discovery */
function buildTrainLabelsJql(trainSlug) {
  return `labels in ("ndb-${trainSlug}-dependency", "ndb-${trainSlug}-asks")`;
}

function selectOptionValue(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') return String(field.value || field.name || '');
  return String(field);
}

function isCommitted(issue, nonCommitFixVersions) {
  const denylist = new Set(
    (nonCommitFixVersions || []).map((v) => String(v).trim().toLowerCase())
  );
  const fvs = issue.fixVersions || [];
  const names = (Array.isArray(fvs) ? fvs : [])
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter(Boolean);
  const hasRealFv = names.some((n) => !denylist.has(String(n).trim().toLowerCase()));
  const releaseCommit = selectOptionValue(issue[RELEASE_COMMIT_FIELD]);
  const commitFlag = /^commit$/i.test(releaseCommit.trim());
  return hasRealFv || commitFlag;
}

function mapIssue(raw, { span = null, direction = null, source = null }, cfg) {
  const status = raw.status?.name || raw.status || '';
  const issueType = raw.issuetype?.name || raw.issuetype || '';
  const project = raw.project?.key || (raw.key ? String(raw.key).split('-')[0] : '');
  const assignee =
    raw.assignee?.displayName || raw.assignee?.name || raw.assignee?.emailAddress || '';
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const fixVersions = (raw.fixVersions || [])
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter(Boolean);
  const committed = isCommitted(raw, cfg.nonCommitFixVersions);
  return {
    key: raw.key,
    summary: raw.summary || '',
    status,
    issueType,
    project,
    assignee,
    labels,
    fixVersions,
    span,
    direction,
    source,
    commitState: committed ? 'committed' : 'ask',
    releaseCommit: selectOptionValue(raw[RELEASE_COMMIT_FIELD]) || null,
  };
}

async function searchSection(token, jql, meta, cfg, jiraBaseUrl) {
  const compact = jql.replace(/\s+/g, ' ').trim();
  let issues = [];
  let error = null;
  try {
    const result = await runSearchByJql(token, compact, 200);
    issues = (result.issues || []).map((iss) => mapIssue(iss, meta, cfg));
  } catch (err) {
    error = err.message || String(err);
    console.warn('[dependencyView] JQL failed:', compact.slice(0, 120), error);
  }
  return {
    jql: compact,
    jiraUrl: jiraSearchUrl(jiraBaseUrl, compact),
    count: issues.length,
    issues,
    ...(error ? { error } : {}),
  };
}

function pickNdbGates(releaseCfg, release) {
  const entry = releaseCfg?.versions?.[release] || releaseCfg?.[release] || {};
  // releaseVersionsEmailConfig nests under top-level keys that are release names
  const gate = releaseCfg?.[release] || entry;
  if (!gate || typeof gate !== 'object') return {};
  const pick = (obj, keys) => {
    const out = {};
    keys.forEach((k) => {
      if (obj[k] != null) out[k] = obj[k];
    });
    return out;
  };
  return pick(gate, [
    'ecDate',
    'ccm1Gate',
    'ccm2Gate',
    'commitGate1',
    'commitGate2',
    'promotionGate1',
    'promotionGate2',
    'ga1',
    'ga2',
    'codeComplete',
    'gaDate',
  ]);
}

function resolveAlignedTrain(cfg, release) {
  const row = cfg.alignedTrains?.[release];
  if (!row) {
    return {
      train: null,
      trainSlug: null,
      status: 'unknown',
      notes: 'No aligned train in dependencyViewConfig',
      partnerVersions: [],
      confluenceUrl: null,
    };
  }
  return { ...row };
}

/**
 * @param {{ token: string, teamId?: string, release?: string }} opts
 */
async function getOverview({ token, teamId, release } = {}) {
  const cfg = loadConfig();
  const board = loadTeamBoardConfig();
  const requested =
    normalizeTeamId(teamId) ||
    normalizeTeamId(cfg.defaultTeamId) ||
    normalizeTeamId(board.defaultTeamId) ||
    'ndb';
  const team = getTeamById(requested) || getTeamById(cfg.defaultTeamId) || getTeamById(board.defaultTeamId);
  const effectiveTeamId = (team && team.id) || requested;
  const effectiveRelease = (release || cfg.defaultRelease || 'NDB-3.0').trim();
  const jiraBaseUrl = process.env.JIRA_BASE_URL || cfg.jiraBaseUrlDefault || 'https://jira.nutanix.com';
  const releaseGatesCfg = loadReleaseGates();
  const alignedTrain = resolveAlignedTrain(cfg, effectiveRelease);
  const trainSlug = alignedTrain.trainSlug || String(effectiveRelease).replace(/^NDB-/i, '').toLowerCase();

  const partnershipBlockedBy = await searchSection(
    token,
    buildPartnershipBlockedByJql(effectiveRelease),
    { direction: 'i_wait_on_them', source: 'partnership' },
    cfg,
    jiraBaseUrl
  );
  const partnershipBlocks = await searchSection(
    token,
    buildPartnershipBlocksJql(effectiveRelease),
    { direction: 'they_wait_on_me', source: 'partnership' },
    cfg,
    jiraBaseUrl
  );
  const trainLabels = await searchSection(
    token,
    buildTrainLabelsJql(trainSlug),
    { source: 'labels' },
    cfg,
    jiraBaseUrl
  );

  const companionDefs = (cfg.companionRoots || []).filter((r) => {
    if (!r.rootKey) return false;
    if (!Array.isArray(r.releases) || !r.releases.length) return true;
    return r.releases.includes(effectiveRelease);
  });

  const companions = [];
  for (const root of companionDefs) {
    const hierarchy = await searchSection(
      token,
      buildCompanionHierarchyJql(root.rootKey),
      { span: root.span || null, source: 'companion' },
      cfg,
      jiraBaseUrl
    );
    const external = await searchSection(
      token,
      buildCompanionExternalJql(root.rootKey, cfg.scopeGroups),
      { span: root.span || null, source: 'companion_external' },
      cfg,
      jiraBaseUrl
    );
    companions.push({
      rootKey: root.rootKey,
      label: root.label || root.rootKey,
      span: root.span || null,
      hierarchy,
      external,
    });
  }

  return {
    teamId: effectiveTeamId,
    teamName: team?.name || effectiveTeamId,
    release: effectiveRelease,
    releases: cfg.releases || [],
    jiraBaseUrl,
    asOf: new Date().toISOString(),
    alignedTrain,
    ndbGates: pickNdbGates(releaseGatesCfg, effectiveRelease),
    partnerCatalog: cfg.partnerCatalog || [],
    spans: cfg.spans || [],
    sections: {
      partnershipBlockedBy,
      partnershipBlocks,
      trainLabels,
      companions,
    },
    jqlBuilders: {
      companionHierarchy: 'Q1',
      companionExternal: 'Q2',
      partnershipBlockedBy: 'Q3',
      partnershipBlocks: 'Q4',
      trainLabels: 'Q5',
      commitSignal: 'Q6',
    },
  };
}

module.exports = {
  getOverview,
  buildCompanionHierarchyJql,
  buildCompanionExternalJql,
  buildPartnershipBlockedByJql,
  buildPartnershipBlocksJql,
  buildTrainLabelsJql,
};
