/**
 * Team inspection: everything Team Management derives from a team's base
 * filter — main JIRA project, release versions, scrum board + sprint
 * calendar, and feature-project components.
 */

const { collectSprintCalendarFromBoard } = require('../utils/sprintCalendar');
const { wrapTeamScope, stripOrderBy, sprintScopeFromBaseFilter, isUnreleasedVersion } = require('../utils/teamScope');
const { getPrimaryComponentField, parsePrimaryComponent } = require('../utils/primaryComponent');

const PROJECT_SAMPLE_SIZE = 500;
const FEATURE_PAGE_SIZE = 500;
const FEATURE_MAX_ISSUES = 5000;
const DEFAULT_FEATURE_PROJECT = 'FEAT';
const VERSION_NAME_LIMIT = 50;
const SUGGEST_MIN_COUNT = 3;
const SUGGEST_MIN_SHARE = 0.05;

function badRequest(message, publicError) {
  const err = new Error(message);
  err.statusCode = 400;
  err.publicError = publicError || message;
  return err;
}

function jiraErrorText(err) {
  const data = err?.response?.data;
  const msgs = [...(data?.errorMessages || []), ...Object.values(data?.errors || {})];
  return msgs.filter(Boolean).join('; ') || err?.message || 'JIRA request failed';
}

function sortNames(a, b) {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
}

async function sampleProjects(jira, baseFilter) {
  let res;
  try {
    res = await jira.get('/rest/api/2/search', {
      timeout: 30000,
      params: { jql: baseFilter, fields: 'project', maxResults: PROJECT_SAMPLE_SIZE, startAt: 0 },
    });
  } catch (err) {
    if (err?.response?.status === 400) {
      throw badRequest(`Base filter rejected by JIRA: ${jiraErrorText(err)}`, 'Invalid base filter');
    }
    throw err;
  }
  const issues = res.data?.issues || [];
  const issueCount = res.data?.total ?? issues.length;
  if (issueCount === 0) throw badRequest('Base filter matched no tickets', 'Base filter matched no tickets');

  const counts = new Map();
  for (const issue of issues) {
    const p = issue.fields?.project;
    if (!p?.key) continue;
    const row = counts.get(p.key) || { key: p.key, name: p.name || p.key, count: 0 };
    row.count += 1;
    counts.set(p.key, row);
  }
  const projects = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map((row) => ({ ...row, share: issues.length ? Math.round((row.count / issues.length) * 100) : 0 }));
  return { issueCount, sampledCount: issues.length, projects };
}

async function listVersions(jira, projectKey) {
  const all = await jira.getProjectVersions(projectKey);
  const unreleased = (all || []).filter(isUnreleasedVersion).map((v) => String(v.name)).sort(sortNames);
  return { total: (all || []).length, unreleasedCount: unreleased.length, unreleased: unreleased.slice(0, VERSION_NAME_LIMIT) };
}

function pickBoard(boards, { boardId, teamName, projectKey }) {
  if (!boards.length) return null;
  const wanted = Number(boardId);
  const byId = boards.find((b) => b.id === wanted);
  if (byId) return byId;
  const needles = [teamName, projectKey].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
  for (const needle of needles) {
    const hit = boards.find((b) => String(b.name || '').toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return boards[0];
}

async function detectBoard(jira, { projectKey, boardId, teamName }) {
  const res = await jira.get('/rest/agile/1.0/board', {
    timeout: 15000,
    params: { projectKeyOrId: projectKey, type: 'scrum', maxResults: 50 },
  });
  const boards = (res.data?.values || []).map((b) => ({ id: b.id, name: b.name }));
  if (Number(boardId) > 0) return { boards, ...(await boardCalendar(jira, Number(boardId))) };
  const chosen = pickBoard(boards, { boardId, teamName, projectKey });
  if (!chosen) return { boards, boardId: null, sprintCalendar: null, calendarError: `No scrum board found for ${projectKey}` };
  return { boards, ...(await boardCalendar(jira, chosen.id)) };
}

async function boardCalendar(jira, boardId) {
  try {
    const out = await collectSprintCalendarFromBoard(jira, boardId);
    return {
      boardId: out.board.id,
      boardName: out.board.name,
      sprintCalendar: out.sprintCalendar,
      inferredFrom: out.inferredFrom,
      sprintCount: out.sprintCount,
    };
  } catch (err) {
    if (err.statusCode === 400) throw err;
    return { boardId: Number(boardId), sprintCalendar: null, calendarError: jiraErrorText(err) };
  }
}

/**
 * Group feature tickets by JIRA component. Each component lists the
 * Primary Component children seen on tickets whose Primary Component
 * parent is that component.
 */
function groupFeatureComponents(issues, pcField) {
  const groups = new Map();
  const ensure = (name) => {
    if (!groups.has(name)) groups.set(name, { count: 0, children: new Set() });
    return groups.get(name);
  };
  for (const issue of issues) {
    const fields = issue.fields || {};
    const names = (fields.components || []).map((c) => c?.name).filter(Boolean);
    names.forEach((name) => { ensure(name).count += 1; });
    const pc = parsePrimaryComponent(fields[pcField]);
    if (pc?.parent) {
      const g = ensure(pc.parent);
      if (!names.includes(pc.parent)) g.count += 1;
      if (pc.child) g.children.add(pc.child);
    }
  }
  const minCount = Math.max(1, Math.min(SUGGEST_MIN_COUNT, Math.ceil(issues.length * SUGGEST_MIN_SHARE)));
  const components = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, g]) => ({
      name,
      count: g.count,
      primaryComponents: [...g.children].sort(),
      suggested: g.count >= minCount,
    }));
  const featureComponents = Object.fromEntries(components.map((c) => [c.name, c.primaryComponents]));
  return { components, featureComponents };
}

async function detectFeatureComponents(jira, { baseFilter, featureProjectKey }) {
  const pcField = getPrimaryComponentField();
  const jql = wrapTeamScope(stripOrderBy(baseFilter), `project = ${featureProjectKey}`);
  const issues = await jira.searchAll(jql, ['components', pcField].filter(Boolean).join(','), {
    pageSize: FEATURE_PAGE_SIZE,
    maxIssues: FEATURE_MAX_ISSUES,
  });
  return { projectKey: featureProjectKey, jql, issueCount: issues.length, ...groupFeatureComponents(issues, pcField) };
}

function settled(result, fallback) {
  if (result.status === 'fulfilled') return result.value;
  if (result.reason?.statusCode === 400) throw result.reason;
  return { ...fallback, error: jiraErrorText(result.reason) };
}

async function inspectBaseFilter(jira, { baseFilter, featureProjectKey, teamName, boardId } = {}) {
  const filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  if (!filter) throw badRequest('baseFilter is required');
  const featureKey = String(featureProjectKey || DEFAULT_FEATURE_PROJECT).trim().toUpperCase();

  const sample = await sampleProjects(jira, filter);
  const main = sample.projects.find((p) => p.key !== featureKey) || sample.projects[0];
  const [versions, board, feature] = await Promise.allSettled([
    listVersions(jira, main.key),
    detectBoard(jira, { projectKey: main.key, boardId, teamName }),
    detectFeatureComponents(jira, { baseFilter: filter, featureProjectKey: featureKey }),
  ]);

  return {
    baseFilter: filter,
    sprintScope: sprintScopeFromBaseFilter(filter),
    issueCount: sample.issueCount,
    sampledCount: sample.sampledCount,
    projects: sample.projects,
    projectKey: main.key,
    projectShare: main.share,
    versions: settled(versions, { total: 0, unreleasedCount: 0, unreleased: [] }),
    board: settled(board, { boards: [], boardId: null, sprintCalendar: null }),
    feature: settled(feature, { projectKey: featureKey, issueCount: 0, components: [], featureComponents: {} }),
  };
}

module.exports = {
  inspectBaseFilter,
  boardCalendar,
  groupFeatureComponents,
  pickBoard,
};
