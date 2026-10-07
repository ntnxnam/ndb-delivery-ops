/**
 * Team inspection: everything Team Management derives from a team's base
 * filter — main JIRA project, release versions, scrum board + sprint
 * calendar, and the component names of the project the admin selects.
 */

const { collectSprintCalendarFromBoard } = require('../utils/sprintCalendar');
const { sprintScopeFromBaseFilter, isUnreleasedVersion } = require('../utils/teamScope');
const { parsePrimaryComponent } = require('../utils/primaryComponent');

const PROJECT_PAGE_SIZE = 1000;
const DEFAULT_FEATURE_PROJECT = 'FEAT';
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
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

function projectKeyFromStatRow(row) {
  const url = decodeURIComponent(String(row?.url || ''));
  const fromUrl = url.match(/project\s*=\s*"?([A-Za-z][A-Za-z0-9_]*)"?/i);
  const html = String(row?.html || '').replace(/<[^>]+>/g, ' ').trim();
  const key = [fromUrl?.[1], row?.key, row?.value, html]
    .map((value) => String(value || '').trim().toUpperCase())
    .find((value) => PROJECT_KEY.test(value));
  if (!key) return null;
  const label = html && html.toUpperCase() !== key ? html : key;
  return { key, name: label, count: Number(row.count) || 0 };
}

function withShare(projects, total) {
  return projects
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map((row) => ({ ...row, share: total ? Math.round((row.count / total) * 100) : 0 }));
}

/**
 * Every project in the base filter. The stats gadget returns the full
 * breakdown in one call. A first-page issue sample hides small projects
 * such as ENG when they fall outside the first 500 tickets.
 */
async function projectsFromStats(jira, baseFilter) {
  const res = await jira.get('/rest/gadget/1.0/stats/generate', {
    timeout: 20000,
    params: {
      queryString: baseFilter,
      statType: 'project',
      includeResolvedIssues: 'true',
    },
  });
  const data = res.data || {};
  const projects = (data.rows || data.results || []).map(projectKeyFromStatRow).filter(Boolean);
  const issueCount = Number(data.totalIssueCount) || projects.reduce((sum, row) => sum + row.count, 0);
  if (!projects.length) throw new Error('Project stats returned no project keys');
  if (issueCount === 0) throw badRequest('Base filter matched no tickets', 'Base filter matched no tickets');
  return { issueCount, sampledCount: issueCount, projects: withShare(projects, issueCount) };
}

async function projectsFromSearch(jira, baseFilter) {
  const counts = new Map();
  let startAt = 0;
  let issueCount = 0;
  let sampledCount = 0;
  for (;;) {
    let res;
    try {
      res = await jira.get('/rest/api/2/search', {
        timeout: 20000,
        params: { jql: baseFilter, fields: 'project', maxResults: PROJECT_PAGE_SIZE, startAt },
      });
    } catch (err) {
      if (err?.response?.status === 400) {
        throw badRequest(`Base filter rejected by JIRA: ${jiraErrorText(err)}`, 'Invalid base filter');
      }
      throw err;
    }
    const issues = res.data?.issues || [];
    issueCount = res.data?.total ?? (startAt + issues.length);
    for (const issue of issues) {
      const project = issue.fields?.project;
      if (!project?.key) continue;
      const row = counts.get(project.key) || { key: project.key, name: project.name || project.key, count: 0 };
      row.count += 1;
      counts.set(project.key, row);
    }
    sampledCount += issues.length;
    if (!issues.length || startAt + issues.length >= issueCount) break;
    startAt += issues.length;
  }
  if (issueCount === 0) throw badRequest('Base filter matched no tickets', 'Base filter matched no tickets');
  return { issueCount, sampledCount, projects: withShare([...counts.values()], sampledCount || issueCount) };
}

async function sampleProjects(jira, baseFilter) {
  try {
    return await projectsFromStats(jira, baseFilter);
  } catch (err) {
    if (err?.statusCode === 400) throw err;
    return projectsFromSearch(jira, baseFilter);
  }
}

async function listVersions(jira, projectKey) {
  const all = await jira.getProjectVersions(projectKey);
  const unreleased = (all || []).filter(isUnreleasedVersion).map((v) => String(v.name)).sort(sortNames);
  return { total: (all || []).length, unreleasedCount: unreleased.length, unreleased: unreleased.slice(0, VERSION_NAME_LIMIT) };
}

const BOARD_TOKEN_STOP = new Set(['the', 'and', 'for', 'team', 'board', 'scrum', 'kanban', 'copy', 'of', 'all']);

function teamBoardTokens(teamName) {
  return [...new Set(
    String(teamName || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2 && !BOARD_TOKEN_STOP.has(token))
  )];
}

function scoreBoardName(name, tokens) {
  const words = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (words.some((word) => word === token)) score += 10;
    else if (words.some((word) => word.startsWith(token))) score += 6;
  }
  if (/^copy of\b/i.test(name)) score -= 4;
  return score;
}

/**
 * A shared JIRA project (ERA) returns every scrum board that mentions it —
 * mostly NDB boards. Keep boards whose names match the team; hold the rest
 * back so the dropdown is the team's boards.
 */
function selectBoards(boards, { teamName } = {}) {
  const unique = [];
  const seen = new Set();
  for (const board of boards || []) {
    if (!board?.id || seen.has(board.id)) continue;
    seen.add(board.id);
    unique.push({ id: board.id, name: board.name });
  }
  const tokens = teamBoardTokens(teamName);
  if (!tokens.length) return { boards: unique, otherBoards: [], matchedOn: 'project' };
  const ranked = unique
    .map((board) => ({ ...board, score: scoreBoardName(board.name, tokens) }))
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  const matched = ranked.filter((board) => board.score > 0).map(({ id, name }) => ({ id, name }));
  if (!matched.length) return { boards: unique, otherBoards: [], matchedOn: 'project' };
  const matchedIds = new Set(matched.map((board) => board.id));
  const otherBoards = unique.filter((board) => !matchedIds.has(board.id));
  return { boards: matched, otherBoards, matchedOn: 'team' };
}

function pickBoard(boards, { boardId, teamName, projectKey }) {
  if (!boards.length) return null;
  const wanted = Number(boardId);
  const byId = boards.find((b) => b.id === wanted);
  if (byId) return byId;
  const tokens = teamBoardTokens(teamName);
  const best = boards
    .map((board) => ({ board, score: scoreBoardName(board.name, tokens) }))
    .sort((a, b) => b.score - a.score)
    .find((row) => row.score > 0);
  if (best) return best.board;
  const needles = [teamName, projectKey].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
  for (const needle of needles) {
    const hit = boards.find((b) => String(b.name || '').toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return boards[0];
}

async function fetchScrumBoards(jira, params) {
  const res = await jira.get('/rest/agile/1.0/board', {
    timeout: 15000,
    params: { type: 'scrum', maxResults: 50, ...params },
  });
  return (res.data?.values || []).map((b) => ({ id: b.id, name: b.name }));
}

async function calendarFor(jira, boardId) {
  try {
    return await boardCalendar(jira, boardId);
  } catch (err) {
    return { boardId: Number(boardId), sprintCalendar: null, calendarError: jiraErrorText(err) };
  }
}

async function detectBoard(jira, { projectKey, boardId, teamName, calendarPromise = null }) {
  const explicitId = Number(boardId) > 0 ? Number(boardId) : null;
  // The saved board is already known on edit. Read it while the name search
  // runs so a long sprint history cannot be stacked on top of the filter sample.
  const pendingCalendar = calendarPromise || (explicitId ? calendarFor(jira, explicitId) : null);

  const named = [];
  await Promise.all(teamBoardTokens(teamName).map(async (token) => {
    try {
      named.push(...await fetchScrumBoards(jira, { name: token }));
    } catch {
      // Name search is only a way to find this team's boards. The project list still loads.
    }
  }));
  let projectBoards = [];
  let projectError = null;
  try {
    projectBoards = await fetchScrumBoards(jira, { projectKeyOrId: projectKey });
  } catch (err) {
    projectError = err;
    if (!named.length && !pendingCalendar) throw err;
  }
  const selected = selectBoards([...named, ...projectBoards], { teamName });
  const boards = selected.boards;
  const extra = {
    otherBoards: selected.otherBoards,
    matchedOn: selected.matchedOn,
    ...(projectError && !boards.length ? { error: jiraErrorText(projectError) } : {}),
  };
  if (pendingCalendar) return { boards, ...extra, ...(await pendingCalendar) };
  const chosen = pickBoard(boards, { boardId, teamName, projectKey });
  if (!chosen) {
    return {
      boards,
      ...extra,
      boardId: null,
      sprintCalendar: null,
      calendarError: extra.error || `No scrum board found for ${projectKey}`,
    };
  }
  return { boards, ...extra, ...(await calendarFor(jira, chosen.id)) };
}

/**
 * Boards and versions for the project the admin picked. The list is that
 * project's scrum boards, with names that match the project key (DR → DR-*)
 * shown first. Name search from another project is not mixed in.
 */
async function inspectProject(jira, { projectKey, teamName } = {}) {
  const key = String(projectKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+$/.test(key)) throw badRequest('projectKey is required');

  const [versionsResult, boardsResult, componentsResult] = await Promise.allSettled([
    listVersions(jira, key),
    fetchScrumBoards(jira, { projectKeyOrId: key }),
    listProjectComponents(jira, key),
  ]);
  const versions = versionsResult.status === 'fulfilled'
    ? versionsResult.value
    : { total: 0, unreleasedCount: 0, unreleased: [], error: jiraErrorText(versionsResult.reason) };

  const feature = componentsResult.status === 'fulfilled'
    ? componentsResult.value
    : { projectKey: key, components: [], featureComponents: {}, error: jiraErrorText(componentsResult.reason) };

  if (boardsResult.status === 'rejected') {
    const err = boardsResult.reason;
    return {
      projectKey: key,
      versions,
      feature,
      board: {
        boards: [],
        otherBoards: [],
        matchedOn: 'project',
        boardId: null,
        sprintCalendar: null,
        calendarError: jiraErrorText(err),
      },
    };
  }

  const selected = selectBoards(boardsResult.value, { teamName: [teamName, key].filter(Boolean).join(' ') });
  const chosen = pickBoard(selected.boards, { teamName: key, projectKey: key });
  const calendar = chosen
    ? await calendarFor(jira, chosen.id)
    : { boardId: null, sprintCalendar: null, calendarError: `No scrum board found for ${key}` };
  return {
    projectKey: key,
    versions,
    feature,
    board: {
      boards: selected.boards,
      otherBoards: selected.otherBoards,
      matchedOn: selected.matchedOn,
      ...calendar,
    },
  };
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
    // Missing sprint dates are filled in on the form; they must not fail Detect.
    if (err.code === 'NO_DATED_SPRINTS') {
      return { boardId: Number(boardId), sprintCalendar: null, calendarError: err.message };
    }
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

async function listProjectComponents(jira, projectKey) {
  const key = String(projectKey || '').trim().toUpperCase();
  const res = await jira.get(`/rest/api/2/project/${encodeURIComponent(key)}/components`, { timeout: 15000 });
  const components = (Array.isArray(res.data) ? res.data : [])
    .map((component) => String(component?.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((name) => ({ name, count: null, primaryComponents: [], suggested: true }));
  return {
    projectKey: key,
    components,
    featureComponents: Object.fromEntries(components.map((component) => [component.name, []])),
  };
}

function settled(result, fallback) {
  if (result.status === 'fulfilled') return result.value;
  return { ...fallback, error: jiraErrorText(result.reason) };
}

async function inspectBaseFilter(jira, { baseFilter, teamName, boardId } = {}) {
  const filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  if (!filter) throw badRequest('baseFilter is required');

  const explicitId = Number(boardId) > 0 ? Number(boardId) : null;
  const calendarPromise = explicitId ? calendarFor(jira, explicitId) : null;
  const sample = await sampleProjects(jira, filter);
  const projects = sample.projects;
  const main = projects.find((p) => p.key !== DEFAULT_FEATURE_PROJECT) || projects[0];
  if (!main?.key) throw badRequest('Base filter matched no projects', 'Base filter matched no projects');
  const [versions, board, feature] = await Promise.allSettled([
    listVersions(jira, main.key),
    detectBoard(jira, { projectKey: main.key, boardId, teamName, calendarPromise }),
    listProjectComponents(jira, main.key),
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
    feature: settled(feature, { projectKey: main.key, components: [], featureComponents: {} }),
  };
}

module.exports = {
  inspectBaseFilter,
  boardCalendar,
  groupFeatureComponents,
  pickBoard,
  selectBoards,
  inspectProject,
};
