/**
 * Team Management persistence: create, update, list, and smoke-test teams
 * in teamBoardConfig.json. Everything except name and id is detected from
 * the team's base filter (see teamInspectService).
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

/** Managed fields present in the body; undefined means "not supplied". */
function pickManagedFields(body) {
  const fields = {};
  if (body.name !== undefined) fields.name = String(body.name || '').trim();
  if (body.baseFilter !== undefined) fields.baseFilter = String(body.baseFilter || '').trim();
  if (body.projectKey !== undefined) fields.projectKey = String(body.projectKey || '').trim().toUpperCase();
  if (body.boardId !== undefined) {
    const id = Number(body.boardId);
    fields.boardId = Number.isInteger(id) && id > 0 ? id : null;
  }
  if (body.sprintCalendar !== undefined) fields.sprintCalendar = parseSprintCalendar(body.sprintCalendar);
  if (body.featureComponents !== undefined) fields.featureComponents = normalizeFeatureComponents(body.featureComponents);
  return fields;
}

function assertValidTeam(team) {
  if (!team.name) throw httpError(400, 'name is required');
  if (!team.baseFilter) throw httpError(400, 'baseFilter is required');
  if (!team.projectKey || !PROJECT_KEY_PATTERN.test(team.projectKey)) {
    throw httpError(400, 'projectKey is required', 'Run Detect on the base filter to fill in the JIRA project.');
  }
  if (!team.sprintCalendar) {
    throw httpError(400, 'sprintCalendar is required', 'Detect the sprint calendar from the team\'s scrum board.');
  }
}

function stripLegacy(team) {
  const out = { ...team };
  LEGACY_FIELDS.forEach((f) => delete out[f]);
  if (out.boardId == null) delete out.boardId;
  return out;
}

function listTeams() {
  const config = loadTeamBoardConfig();
  const kpiConfig = readJson(KPI_CONFIG_PATH);
  const teams = (config.teams || []).map((team) => ({
    ...team,
    sprintScope: sprintScopeFromBaseFilter(team.baseFilter),
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
  const team = stripLegacy({ id, ...fields });
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
  const team = stripLegacy({ ...existing, ...pickManagedFields(body), id: existing.id });
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
  const sprintScope = sprintScopeFromBaseFilter(team.baseFilter);
  const results = {
    projectAccess: await runCheck(async () => {
      const res = await jira.get(`/rest/api/2/project/${team.projectKey}`, { timeout: 15000 });
      return { projectName: res.data?.name };
    }),
    versionAccess: await runCheck(async () => {
      const versions = ((await jira.getProjectVersions(team.projectKey)) || []).filter(isUnreleasedVersion);
      return { totalVersions: versions.length, sampleVersions: versions.slice(0, 5).map((v) => v.name) };
    }),
    baseFilter: await runCheck(async () => ({ issueCount: await jira.searchCount(team.baseFilter) })),
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
};
