/**
 * Team Management persistence: create, update, list, and smoke-test teams
 * in teamBoardConfig.json. Now supports auto-generated base JQL (teamBaseJqlService).
 *
 * Fields per spec:
 *  - team_name / name
 *  - is_shared_project (boolean)
 *  - custom_project_key (comma-separated, e.g. "ERA,NDBECO")
 *  - components (string[])
 *  - leader_outlook_dls (string[])
 *  - contacts: { team, serv_team, doc_team, security_team, legal, documentation, trade_compliance, others }
 *    each { entries: string[], isDL: boolean }  — checkbox per row
 *  - base_jql + baseFilter (both set to generated JQL for downstream compat)
 */

const fs = require('fs');
const path = require('path');
const { loadTeamBoardConfig, saveTeamBoardConfig, normalizeTeamId } = require('../utils/teamConfig');
const { parseSprintCalendar } = require('../utils/sprintCalendar');
const { sprintScopeFromBaseFilter, isUnreleasedVersion } = require('../utils/teamScope');

const KPI_CONFIG_PATH = path.join(__dirname, '../config/kpiConfig.json');
const TEAM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const LEGACY_FIELDS = ['projectType', 'versionPatterns', 'sprintBaseFilter'];
const CONTACT_ROW_KEYS = ['team', 'serv_team', 'doc_team', 'security_team', 'legal', 'documentation', 'trade_compliance', 'others'];

// Shared projects — single source in teamBaseJqlService; mirrored here for CJS compat (keep in sync via CONSOLIDATION.md #B1)
// TODO(B3): derive from teamBoardConfig companionDisciplines + ENG via productService (product-agnostic)
const SHARED_PROJECTS_ALL = ['ENG', 'FEAT', 'SDL', 'TECHPUBS', 'SR', 'LEG', 'NDBECO'];

function httpError(statusCode, error, message) {
  const err = new Error(message || error);
  err.statusCode = statusCode;
  err.publicError = error;
  return err;
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
}

function slugifyTeamId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function normalizeFeatureComponents(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, children] of Object.entries(raw)) {
    const name = String(key || '').trim();
    if (!name) continue;
    const list = Array.isArray(children) ? children : [];
    out[name] = [...new Set(list.map((c) => String(c || '').trim()).filter(Boolean))].sort();
  }
  return out;
}

function dedupeTrim(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = String(v || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function parseCommaList(v) {
  if (Array.isArray(v)) return dedupeTrim(v);
  return dedupeTrim(String(v || '').split(/[,;\n]+/));
}

function esc(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function normalizeContacts(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const key of CONTACT_ROW_KEYS) {
    const row = raw[key];
    if (!row) continue;
    if (Array.isArray(row)) {
      // legacy array → treat as handles
      out[key] = { entries: dedupeTrim(row), isDL: false };
    } else if (typeof row === 'object') {
      const entries = Array.isArray(row.entries) ? dedupeTrim(row.entries) : parseCommaList(row.entries || row.values || row.value);
      const isDL = Boolean(row.isDL ?? row.is_dl ?? row.dl ?? false);
      if (entries.length) out[key] = { entries, isDL };
    } else if (typeof row === 'string') {
      const entries = parseCommaList(row);
      if (entries.length) out[key] = { entries, isDL: false };
    }
  }
  return out;
}

function buildBaseJqlFromTeam(team) {
  const comps = Array.isArray(team.components) ? dedupeTrim(team.components) : [];
  if (comps.length === 0) return null;

  const isShared = team.is_shared_project !== false; // default true for backward compat if missing
  const customRaw = team.custom_project_key || team.customProjectKey || null;
  const customKeys = customRaw ? dedupeTrim(String(customRaw).split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)) : [];

  // Collect DLs/handles from 8 contact rows
  const contacts = team.contacts || {};
  const dlList = [];
  const handleList = [];
  for (const key of CONTACT_ROW_KEYS) {
    const row = contacts[key];
    if (!row || !Array.isArray(row.entries)) continue;
    if (row.isDL) dlList.push(...row.entries);
    else handleList.push(...row.entries);
  }
  // Also support leader_outlook_dls as DLs for JQL if needed — task says DLs are for JQL assignee
  // But spec says leader_outlook_dls are for email, not JQL. Keep separate.

  const dlParts = dedupeTrim(dlList).map(dl => `membersOf("${esc(dl)}")`);
  const handleParts = dedupeTrim(handleList);
  const assigneeParts = [...dlParts, ...handleParts];

  const componentClause = `component in (${comps.map(c => /\s/.test(c) || c.includes('"') ? `"${esc(c)}"` : c).join(', ')})`;
  const primaryClause = `"primary component" in (${comps.map(c => `"${esc(c)}"`).join(', ')})`;
  const assigneeClause = assigneeParts.length ? `assignee in (${assigneeParts.join(', ')})` : null;
  const oncallClause = `issuetype in ("Era Oncall", "ERA Oncall")`;

  const innerParts = [componentClause, primaryClause, assigneeClause, oncallClause].filter(Boolean);
  const innerOr = innerParts.join(' OR ');

  const sharedStr = SHARED_PROJECTS_ALL.join(', ');

  if (isShared) {
    return `project in (${sharedStr}) AND (${innerOr})`;
  }
  if (customKeys.length === 0) return null;
  const customStr = customKeys.join(', ');
  return `(project in (${customStr}) OR (project in (${sharedStr}) AND (${innerOr})))`;
}

/** Managed fields present in the body; undefined means "not supplied". */
function pickManagedFields(body) {
  const fields = {};
  if (body.name !== undefined || body.team_name !== undefined) fields.name = String(body.name ?? body.team_name ?? '').trim();
  if (body.baseFilter !== undefined) fields.baseFilter = String(body.baseFilter || '').trim();
  if (body.base_jql !== undefined) fields.base_jql = String(body.base_jql || '').trim();
  if (body.projectKey !== undefined) fields.projectKey = String(body.projectKey || '').trim().toUpperCase();
  if (body.boardId !== undefined) {
    const id = Number(body.boardId);
    fields.boardId = Number.isInteger(id) && id > 0 ? id : null;
  }
  if (body.sprintCalendar !== undefined) fields.sprintCalendar = parseSprintCalendar(body.sprintCalendar);
  if (body.featureComponents !== undefined) fields.featureComponents = normalizeFeatureComponents(body.featureComponents);
  // New fields
  if (body.is_shared_project !== undefined || body.isSharedProject !== undefined) {
    fields.is_shared_project = Boolean(body.is_shared_project ?? body.isSharedProject);
  }
  if (body.custom_project_key !== undefined || body.customProjectKey !== undefined) {
    const raw = body.custom_project_key ?? body.customProjectKey;
    fields.custom_project_key = raw != null ? String(raw).trim().toUpperCase() : null;
    if (fields.custom_project_key === '') fields.custom_project_key = null;
  }
  if (body.components !== undefined) {
    fields.components = Array.isArray(body.components) ? dedupeTrim(body.components) : parseCommaList(body.components);
  }
  if (body.leader_outlook_dls !== undefined || body.leaderOutlookDls !== undefined) {
    const raw = body.leader_outlook_dls ?? body.leaderOutlookDls;
    fields.leader_outlook_dls = Array.isArray(raw) ? dedupeTrim(raw) : parseCommaList(raw);
  }
  if (body.contacts !== undefined) {
    fields.contacts = normalizeContacts(body.contacts);
  }
  // Support legacy contacts shape from old admin: contacts as flat
  if (body.documentation_contacts !== undefined || body.devex_contacts !== undefined || body.serviceability_contacts !== undefined) {
    fields.contacts = fields.contacts || {};
    if (body.documentation_contacts) fields.contacts.documentation = { entries: parseCommaList(body.documentation_contacts), isDL: false };
    if (body.devex_contacts) fields.contacts.documentation = { entries: parseCommaList(body.documentation_contacts), isDL: false };
    if (body.serviceability_contacts) fields.contacts.others = { entries: parseCommaList(body.serviceability_contacts), isDL: false };
  }
  return fields;
}

function assertValidTeam(team) {
  if (!team.name) throw httpError(400, 'name is required');
  // New validation: if is_shared_project explicitly set, validate accordingly
  if (team.is_shared_project === false) {
    if (!team.custom_project_key) throw httpError(400, 'custom_project_key is required when Not Shared / Custom Project is selected');
    const keys = dedupeTrim(String(team.custom_project_key).split(/[,;]+/));
    for (const k of keys) {
      if (!PROJECT_KEY_PATTERN.test(k.trim().toUpperCase())) throw httpError(400, `custom_project_key "${k}" is not a valid JIRA project key`);
    }
  }
  if (team.components !== undefined && Array.isArray(team.components) && team.components.length === 0) {
    // allow empty only for legacy teams not yet migrated; new teams must have at least 1
    // but don't block edits of old teams that haven't set components yet
    if (team.is_shared_project !== undefined) throw httpError(400, 'At least one component is required');
  }
  // For new flow, base_jql is generated; for legacy, baseFilter still required unless we can generate
  if (team.is_shared_project !== undefined) {
    // new teams: try to build JQL, fail if can't
    const jql = buildBaseJqlFromTeam(team);
    if (!jql) throw httpError(400, 'Could not build base JQL — check components and custom project key');
  } else {
    // legacy path: baseFilter required
    if (!team.baseFilter) throw httpError(400, 'baseFilter is required');
    if (!team.projectKey || !PROJECT_KEY_PATTERN.test(team.projectKey)) {
      throw httpError(400, 'projectKey is required', 'Run Detect on the base filter to fill in the JIRA project.');
    }
  }
  if (!team.sprintCalendar) {
    // sprintCalendar optional for new flow — will be auto-detected on first board fetch, don't block Save
  }
}

function stripLegacy(team) {
  const out = { ...team };
  LEGACY_FIELDS.forEach((f) => delete out[f]);
  if (out.boardId == null) delete out.boardId;
  return out;
}

function enrichTeamWithJql(team) {
  // If new fields present, generate base_jql and sync to baseFilter for downstream compat
  if (team.is_shared_project !== undefined || team.components !== undefined || team.custom_project_key !== undefined || team.contacts !== undefined) {
    const jql = buildBaseJqlFromTeam(team);
    if (jql) {
      team.base_jql = jql;
      team.baseFilter = jql; // downstream code reads baseFilter
      // Keep projectKey in sync for legacy testTeamConfig
      if (team.is_shared_project === false && team.custom_project_key) {
        const firstKey = dedupeTrim(String(team.custom_project_key).split(/[,;]+/))[0];
        if (firstKey) team.projectKey = firstKey;
      } else if (team.is_shared_project === true) {
        team.projectKey = 'ENG';
      }
    }
  }
  return team;
}

function listTeams() {
  const config = loadTeamBoardConfig();
  const kpiConfig = readJson(KPI_CONFIG_PATH);
  const teams = (config.teams || []).map((team) => ({
    ...team,
    sprintScope: sprintScopeFromBaseFilter(team.baseFilter || team.base_jql || ''),
    kpiCount: (kpiConfig.teams?.[team.id] || []).length,
  }));
  return { teams, defaultTeamId: config.defaultTeamId };
}

function createTeam(body = {}) {
  const fields = pickManagedFields(body);
  const id = normalizeTeamId(body.id) || slugifyTeamId(fields.name);
  if (!TEAM_ID_PATTERN.test(id)) {
    throw httpError(400, 'Invalid team code', 'Use lowercase letters, digits, and dashes (max 40).');
  }
  let team = stripLegacy({ id, ...fields });
  // Enrich before validation so baseFilter is set
  team = enrichTeamWithJql(team);
  assertValidTeam(team);

  const config = loadTeamBoardConfig();
  if ((config.teams || []).some((t) => normalizeTeamId(t.id) === id)) {
    throw httpError(409, 'Team already exists', `Team with id "${id}" already exists`);
  }
  saveTeamBoardConfig({ ...config, teams: [...(config.teams || []), team] });

  const kpiConfig = readJson(KPI_CONFIG_PATH);
  if (!kpiConfig.teams?.[id]) {
    kpiConfig.teams = { ...(kpiConfig.teams || {}), [id]: [] };
    fs.writeFileSync(KPI_CONFIG_PATH, JSON.stringify(kpiConfig, null, 2), 'utf8');
  }
  return team;
}

function updateTeam(teamId, body = {}) {
  const config = loadTeamBoardConfig();
  const teams = [...(config.teams || [])];
  const index = teams.findIndex((t) => normalizeTeamId(t.id) === normalizeTeamId(teamId));
  if (index === -1) throw httpError(404, 'Team not found', `Team with id "${teamId}" not found`);

  const existing = teams[index];
  const merged = { ...existing, ...pickManagedFields(body), id: existing.id };
  // Preserve contacts row-by-row: PATCH with only subset shouldn't wipe others, but explicit empty clears row (H1 fix)
  if (body.contacts !== undefined) {
    const incomingRaw = body.contacts || {};
    const normalized = pickManagedFields(body).contacts || {};
    const nextContacts = { ...(existing.contacts || {}) };
    for (const k of CONTACT_ROW_KEYS) {
      if (Object.prototype.hasOwnProperty.call(incomingRaw, k)) {
        if (normalized[k]) nextContacts[k] = normalized[k];
        else delete nextContacts[k];
      } else if (normalized[k]) {
        nextContacts[k] = normalized[k];
      }
    }
    merged.contacts = nextContacts;
  } else if (existing.contacts) {
    merged.contacts = existing.contacts;
  }
  let team = stripLegacy(merged);
  team = enrichTeamWithJql(team);
  assertValidTeam(team);
  teams[index] = team;
  saveTeamBoardConfig({ ...config, teams });
  return team;
}

function getTeam(teamId) {
  const team = (loadTeamBoardConfig().teams || []).find(
    (t) => normalizeTeamId(t.id) === normalizeTeamId(teamId)
  );
  if (!team) throw httpError(404, 'Team not found', `Team with id "${teamId}" not found`);
  return team;
}

function errorText(err) {
  return err?.response?.data?.errorMessages?.join(', ') || err?.message || 'Request failed';
}

async function runCheck(fn) {
  try {
    return { valid: true, ...(await fn()) };
  } catch (err) {
    return { valid: false, error: errorText(err) };
  }
}

async function testTeamConfig(teamId, jira) {
  const team = getTeam(teamId);
  const base = team.baseFilter || team.base_jql || '';
  const sprintScope = sprintScopeFromBaseFilter(base);
  const results = {
    projectAccess: await runCheck(async () => {
      const key = team.projectKey || (team.custom_project_key ? String(team.custom_project_key).split(',')[0].trim() : 'ENG');
      const res = await jira.get(`/rest/api/2/project/${key}`, { timeout: 15000 });
      return { projectName: res.data?.name };
    }),
    versionAccess: await runCheck(async () => {
      const key = team.projectKey || (team.custom_project_key ? String(team.custom_project_key).split(',')[0].trim() : 'ENG');
      const versions = ((await jira.getProjectVersions(key)) || []).filter(isUnreleasedVersion);
      return { totalVersions: versions.length, sampleVersions: versions.slice(0, 5).map((v) => v.name) };
    }),
    baseFilter: await runCheck(async () => ({ issueCount: await jira.searchCount(base) })),
    sprintScope: await runCheck(async () => ({ jql: sprintScope, issueCount: await jira.searchCount(sprintScope) })),
  };
  return {
    success: Object.values(results).every((r) => r.valid),
    teamId: team.id,
    teamName: team.name,
    results,
  };
}

module.exports = {
  slugifyTeamId,
  normalizeFeatureComponents,
  listTeams,
  createTeam,
  updateTeam,
  testTeamConfig,
  buildBaseJqlFromTeam,
  CONTACT_ROW_KEYS,
};
