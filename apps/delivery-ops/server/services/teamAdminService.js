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

function normalizeStringArray(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => String(v || '').trim()).filter(Boolean))];
}

function normalizeReleasePrefixes(body) {
  // Canonical is releasePrefixes[]. Accept singular releasePrefix as legacy compat.
  if (body.releasePrefixes !== undefined) {
    if (!Array.isArray(body.releasePrefixes)) throw httpError(400, 'releasePrefixes must be an array');
    return normalizeStringArray(body.releasePrefixes);
  }
  if (body.releasePrefix !== undefined) {
    const v = String(body.releasePrefix || '').trim();
    return v ? [v] : [];
  }
  return undefined;
}

function normalizeReleaseRegexes(raw) {
  if (!Array.isArray(raw)) throw httpError(400, 'releaseRegexes must be an array');
  const out = [];
  for (const r of raw) {
    const s = String(r || '').trim();
    if (!s) continue;
    try {
      new RegExp(s);
    } catch {
      throw httpError(400, `Invalid releaseRegex: ${s}`);
    }
    out.push(s);
  }
  return [...new Set(out)];
}

function normalizeLabels(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || '').trim();
    if (!key) continue;
    const val = String(v || '').trim();
    if (val) out[key] = val;
  }
  return out;
}

function normalizeTcms(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'tcms must be an object');
  const out = {};
  if (raw.projectSegment !== undefined) out.projectSegment = String(raw.projectSegment || '').trim();
  if (raw.baseUrl !== undefined) out.baseUrl = String(raw.baseUrl || '').trim();
  return out;
}

function normalizeQaEnv(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'qaEnv must be an object');
  const out = {};
  if (raw.devUrl !== undefined) out.devUrl = String(raw.devUrl || '').trim();
  if (raw.qaUrl !== undefined) out.qaUrl = String(raw.qaUrl || '').trim();
  if (raw.prodUrl !== undefined) out.prodUrl = String(raw.prodUrl || '').trim();
  return out;
}

function normalizeBranding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'branding must be an object');
  const out = {};
  if (raw.displayName !== undefined) out.displayName = String(raw.displayName || '').trim();
  if (raw.shortName !== undefined) out.shortName = String(raw.shortName || '').trim();
  return out;
}

function normalizeNotificationEmails(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'notificationEmails must be an object');
  const out = {};
  for (const k of ['exec', 'techLeads', 'managers']) {
    if (raw[k] !== undefined) out[k] = String(raw[k] || '').trim();
  }
  return out;
}

function normalizeCompanionDisciplines(raw) {
  if (!Array.isArray(raw)) throw httpError(400, 'companionDisciplines must be an array');
  return raw.map((row) => {
    if (!row || typeof row !== 'object') throw httpError(400, 'companionDisciplines entries must be objects');
    const projectKey = String(row.projectKey || '').trim().toUpperCase();
    if (!projectKey || !PROJECT_KEY_PATTERN.test(projectKey)) throw httpError(400, 'companionDisciplines.projectKey is required');
    const out = { projectKey, label: String(row.label || '').trim() };
    if (row.hardGate !== undefined) {
      if (row.hardGate !== 'PG' && row.hardGate !== 'GA') throw httpError(400, 'companionDisciplines.hardGate must be PG or GA');
      out.hardGate = row.hardGate;
    }
    return out;
  });
}

/** Managed fields present in the body; undefined means "not supplied". */
function pickManagedFields(body) {
  const fields = {};
  if (body.name !== undefined) fields.name = String(body.name || '').trim();
  if (body.displayName !== undefined) fields.displayName = String(body.displayName || '').trim();
  if (body.baseFilter !== undefined) fields.baseFilter = String(body.baseFilter || '').trim();
  if (body.sosBaseFilter !== undefined) fields.sosBaseFilter = String(body.sosBaseFilter || '').trim();
  if (body.projectKey !== undefined) fields.projectKey = String(body.projectKey || '').trim().toUpperCase();
  if (body.featureProjectKey !== undefined) {
    const v = String(body.featureProjectKey || '').trim().toUpperCase();
    fields.featureProjectKey = v || undefined;
  }
  if (body.boardId !== undefined) {
    if (body.boardId === null || body.boardId === '') {
      fields.boardId = null;
    } else {
      const id = Number(body.boardId);
      if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'boardId must be a positive integer');
      fields.boardId = id;
    }
  }
  if (body.labelPrefix !== undefined) fields.labelPrefix = String(body.labelPrefix || '').trim().toLowerCase();
  const prefixes = normalizeReleasePrefixes(body);
  if (prefixes !== undefined) fields.releasePrefixes = prefixes;
  if (body.releaseRegexes !== undefined) fields.releaseRegexes = normalizeReleaseRegexes(body.releaseRegexes);
  if (body.homeProjects !== undefined) fields.homeProjects = normalizeStringArray(body.homeProjects).map((s) => s.toUpperCase());
  if (body.activeVersionNames !== undefined) fields.activeVersionNames = normalizeStringArray(body.activeVersionNames);
  if (body.sprintCalendar !== undefined) fields.sprintCalendar = parseSprintCalendar(body.sprintCalendar);
  if (body.featureComponents !== undefined) fields.featureComponents = normalizeFeatureComponents(body.featureComponents);
  if (body.companionDisciplines !== undefined) fields.companionDisciplines = normalizeCompanionDisciplines(body.companionDisciplines);
  if (body.defaultRelease !== undefined) fields.defaultRelease = String(body.defaultRelease || '').trim();
  if (body.defaultReleaseVersion !== undefined) fields.defaultReleaseVersion = String(body.defaultReleaseVersion || '').trim();
  if (body.storyPointsField !== undefined) fields.storyPointsField = String(body.storyPointsField || '').trim();
  if (body.labels !== undefined) fields.labels = normalizeLabels(body.labels);
  if (body.tcms !== undefined) fields.tcms = normalizeTcms(body.tcms);
  if (body.qaEnv !== undefined) fields.qaEnv = normalizeQaEnv(body.qaEnv);
  if (body.branding !== undefined) fields.branding = normalizeBranding(body.branding);
  if (body.notificationEmails !== undefined) fields.notificationEmails = normalizeNotificationEmails(body.notificationEmails);
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
  if (!team.labelPrefix) throw httpError(400, 'labelPrefix is required', 'Set a label prefix (e.g. ncn-) — derived from team id when onboarding via Detect.');
  if (!Array.isArray(team.releasePrefixes) || team.releasePrefixes.length === 0) {
    throw httpError(400, 'releasePrefixes is required', 'At least one release prefix is required (e.g. NCN-Konvoy-, AOS ).');
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
  // Ergonomic defaults — Admin UI may not send every field explicitly
  if (!fields.labelPrefix && fields.name) fields.labelPrefix = `${slugifyTeamId(fields.name)}-`;
  if (!fields.homeProjects && fields.projectKey) fields.homeProjects = [fields.projectKey];
  const id = normalizeTeamId(body.id) || slugifyTeamId(fields.name);
  if (!TEAM_ID_PATTERN.test(id)) {
    throw httpError(400, 'Invalid team code', 'Use lowercase letters, digits, and dashes (max 40).');
  }
  const rawTeam = { id, ...fields };
  // Canonicalise singular releasePrefix → plural if both slipped through
  if (Array.isArray(rawTeam.releasePrefixes) && rawTeam.releasePrefixes.length > 0) delete rawTeam.releasePrefix;
  const team = stripLegacy(rawTeam);
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
  if (Array.isArray(merged.releasePrefixes) && merged.releasePrefixes.length > 0) delete merged.releasePrefix;
  const team = stripLegacy(merged);
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
