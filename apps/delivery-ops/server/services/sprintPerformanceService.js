/**
 * Sprint Performance (leadership) — collect a multi-sprint, multi-scrum-team
 * dataset for one product team and hand it to the metrics layer.
 *
 * Flow: board sprints → cadence slots → JIRA Sprint Report per sprint
 * (completed / not completed / removed / added during sprint, exactly as the
 * board's Reports → Sprint Report view) → assignee directory groups → compute.
 */

const fs = require('fs');
const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const { getTeamById, loadTeamBoardConfig } = require('../utils/teamConfig');
const { runWithConcurrency } = require('../utils/concurrency');
const { fetchUserGroups, buildOrgDirectory, resolveGroupOwners } = require('../utils/orgDirectory');
const { computeSprintPerformance, loadPerformanceConfig, itemWeights } = require('../utils/sprintPerformanceMetrics');
const { releaseGatesForSlots } = require('../utils/sprintReleaseGates');

const DAY_MS = 24 * 60 * 60 * 1000;

async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function fetchBoardSprints(jira, boardId) {
  const all = [];
  let startAt = 0;
  for (;;) {
    const r = await withRetry(() => jira.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
      timeout: 60000,
      params: { startAt, maxResults: 50, state: 'active,closed' },
    }));
    const values = r.data?.values || [];
    all.push(...values);
    startAt += values.length;
    if (r.data?.isLast || values.length === 0) break;
  }
  return all;
}

function slotFor(startIso, anchor, sprintDays) {
  const delta = (new Date(startIso).getTime() - new Date(anchor.startIso).getTime()) / (sprintDays * DAY_MS);
  return anchor.number + Math.round(delta);
}

function scrumTeamName(sprintName, prefix) {
  const raw = String(sprintName || '').replace(new RegExp(`^${prefix}-?`, 'i'), '');
  return (raw.split(/-?\s*S\d+/i)[0] || raw).replace(/[-\s]+$/, '').trim() || sprintName;
}

function selectWindowSprints(boardSprints, { boardId, anchor, sprintDays, windowSlots, today, teamPrefix }) {
  const own = boardSprints.filter((s) => s.originBoardId === boardId && s.startDate);
  const currentSlot = slotFor(today.toISOString(), anchor, sprintDays);
  const lastSlot = currentSlot - 1;
  const firstSlot = lastSlot - windowSlots + 1;
  return own
    .map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate,
      endDate: s.endDate || null,
      completeDate: s.completeDate || null,
      slot: slotFor(s.startDate, anchor, sprintDays),
      scrumTeam: scrumTeamName(s.name, teamPrefix),
    }))
    .filter((s) => s.slot >= firstSlot && s.slot <= lastSlot)
    .sort((a, b) => a.slot - b.slot || a.scrumTeam.localeCompare(b.scrumTeam));
}

const LIVE_FIELDS = ['status', 'resolution', 'resolutiondate', 'fixVersions'];

/** Current status / resolution / fix versions per key (sprint reports only carry the status at sprint close). */
async function fetchLiveIssues(jira, keys, log) {
  const batches = [];
  for (let i = 0; i < keys.length; i += 100) batches.push(keys.slice(i, i + 100));
  log(`Fetching current status and fix versions for ${keys.length} tickets (${batches.length} batches)…`);
  const out = {};
  await runWithConcurrency(batches.map((batch) => async () => {
    const r = await withRetry(() => jira.post('/rest/api/2/search', {
      jql: `key in (${batch.join(',')})`, fields: LIVE_FIELDS, maxResults: batch.length, validateQuery: false,
    }, { timeout: 60000 }));
    (r.data?.issues || []).forEach((it) => {
      const f = it.fields || {};
      out[it.key] = {
        status: f.status?.name || '',
        statusCategory: f.status?.statusCategory?.key || '',
        resolution: f.resolution?.name || '',
        resolved: f.resolutiondate ? f.resolutiondate.slice(0, 10) : '',
        fixVersions: (f.fixVersions || []).map((v) => ({ name: v.name, released: Boolean(v.released), releaseDate: v.releaseDate || '' })),
      };
    });
  }), 4);
  return out;
}

const reportKeys = (raw) => Array.from(new Set(raw.perSprint.flatMap((p) => p.issues.map((i) => i.key))));

async function collectSprintPerformance({ token, teamId, today = new Date(), cachePath, log = () => {} }) {
  if (cachePath && fs.existsSync(cachePath)) {
    log(`Using cached raw dataset ${cachePath}`);
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    let dirty = false;
    const jira = token ? await getJira(token) : null;
    if (!cached.live && jira) {
      cached.live = await fetchLiveIssues(jira, reportKeys(cached), log);
      cached.liveFetchedAt = new Date().toISOString();
      dirty = true;
    }
    if (!cached.groupOwners && jira && cached.users) {
      const groupNames = Array.from(new Set(Object.values(cached.users).flatMap((u) => u.groups || [])));
      log(`Checking which manager/org group owners are still active…`);
      cached.groupOwners = await resolveGroupOwners(jira, groupNames);
      dirty = true;
    }
    if (dirty) fs.writeFileSync(cachePath, JSON.stringify(cached));
    return cached;
  }
  const boardCfg = loadTeamBoardConfig() || {};
  const team = getTeamById(teamId || boardCfg.defaultTeamId);
  if (!team?.boardId) throw Object.assign(new Error(`Team "${teamId}" has no boardId`), { statusCode: 400 });
  const perfCfg = loadPerformanceConfig(team.id);
  const sprintDays = team.sprintCalendar?.sprintDays || 21;
  const anchor = perfCfg.cadenceLabelAnchor || { startIso: team.sprintCalendar?.s1StartIso, number: 1 };

  const jira = await getJira(token);
  log(`Fetching sprints for board ${team.boardId}…`);
  const boardSprints = await fetchBoardSprints(jira, team.boardId);
  const sprints = selectWindowSprints(boardSprints, {
    boardId: team.boardId, anchor, sprintDays, windowSlots: perfCfg.windowSlots, today, teamPrefix: team.name,
  });
  log(`${sprints.length} sprints in window (slots ${sprints[0]?.slot}–${sprints[sprints.length - 1]?.slot})`);

  const reportTasks = sprints.map((s) => async () => {
    const r = await withRetry(() => jira.get('/rest/greenhopper/1.0/rapid/charts/sprintreport', {
      timeout: 60000,
      params: { rapidViewId: team.boardId, sprintId: s.id },
    }));
    const c = r.data?.contents || {};
    const entities = c.entityData || {};
    const issues = REPORT_BUCKETS.flatMap(([bucket, field]) => (c[field] || []).map((i) => slimReportIssue(i, bucket, entities)));
    const addedKeys = Object.keys(c.issueKeysAddedDuringSprint || {});
    log(`  ${s.name}: ${issues.length} issues, ${addedKeys.length} added during sprint`);
    return { sprintId: s.id, addedKeys, issues };
  });
  const perSprint = await runWithConcurrency(reportTasks, 4);

  const usernames = new Set();
  perSprint.forEach((p) => p.issues.forEach((i) => { if (i.assigneeName) usernames.add(i.assigneeName); }));
  log(`Resolving reporting lines for ${usernames.size} assignees…`);
  const users = await fetchUserGroups(jira, Array.from(usernames));
  const groupNames = Array.from(new Set(Object.values(users).flatMap((u) => u.groups || [])));
  log(`Checking which manager/org group owners are still active (${groupNames.filter((g) => /DirectReports$|-Org$/.test(g)).length} groups)…`);
  const groupOwners = await resolveGroupOwners(jira, groupNames);

  const raw = {
    dataSource: 'jira-sprint-report',
    generatedAt: new Date().toISOString(),
    today: today.toISOString(),
    jiraBaseUrl: JIRA_API_V2.BASE_URL,
    team: { id: team.id, name: team.name, boardId: team.boardId, projectKey: team.projectKey, sprintScope: null },
    sprintDays,
    anchor,
    sprints,
    perSprint,
    users,
    groupOwners,
  };
  raw.live = await fetchLiveIssues(jira, reportKeys(raw), log);
  raw.liveFetchedAt = new Date().toISOString();
  if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(raw));
  return raw;
}

const REPORT_BUCKETS = [
  ['completed', 'completedIssues'],
  ['notCompleted', 'issuesNotCompletedInCurrentSprint'],
  ['removed', 'puntedIssues'],
  ['completedElsewhere', 'issuesCompletedInAnotherSprint'],
];

// Sprint Report issue: `assignee` is the username, `assigneeName` the display name.
function slimReportIssue(i, bucket, entities) {
  const st = entities.statuses?.[i.statusId];
  const sp = (i.currentEstimateStatistic || i.estimateStatistic)?.statFieldValue?.value;
  return {
    key: i.key,
    summary: i.summary || '',
    bucket,
    status: st?.status?.name || st?.statusName || '',
    statusCategory: st?.status?.statusCategory?.key || '',
    issuetype: entities.types?.[i.typeId]?.typeName || '',
    assigneeName: i.assignee || null,
    assignee: i.assigneeName || null,
    storyPoints: typeof sp === 'number' ? sp : 0,
  };
}

/** Trim a (possibly wider) cached dataset to the configured window of slots. */
function trimToWindow(raw, cfg) {
  const slotsAll = Array.from(new Set(raw.sprints.map((s) => s.slot))).sort((a, b) => a - b);
  const keep = new Set(slotsAll.slice(-cfg.windowSlots));
  if (keep.size === slotsAll.length) return raw;
  const sprints = raw.sprints.filter((s) => keep.has(s.slot));
  const ids = new Set(sprints.map((s) => s.id));
  return { ...raw, sprints, perSprint: raw.perSprint.filter((p) => ids.has(p.sprintId)) };
}

function computeFromRaw(rawInput) {
  const cfg = loadPerformanceConfig(rawInput.team.id);
  const raw = trimToWindow(rawInput, cfg);
  const directory = buildOrgDirectory(raw.users, { weights: itemWeights(raw), leaderMaxShare: cfg.leaderMaxSharePct / 100, groupOwners: raw.groupOwners || {} });
  const model = computeSprintPerformance(raw, directory, cfg);
  const slots = model.meta.slots;
  const releasePrefix = getTeamById(raw.team.id)?.releasePrefix;
  model.meta.releasePrefix = releasePrefix || '';
  model.meta.releases = slots.length ? releaseGatesForSlots({
    anchor: raw.anchor,
    sprintDays: raw.sprintDays,
    firstSlot: slots[0].slot,
    lastSlot: slots[slots.length - 1].slot,
    releasePrefix,
  }) : [];
  model.meta.sprintDays = raw.sprintDays;
  return model;
}

async function buildSprintPerformance(opts) {
  return computeFromRaw(await collectSprintPerformance(opts));
}

module.exports = { collectSprintPerformance, computeFromRaw, buildSprintPerformance, scrumTeamName, slotFor };
