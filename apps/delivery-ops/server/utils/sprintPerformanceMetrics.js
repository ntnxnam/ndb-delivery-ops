/**
 * Pure metrics for the Sprint Performance leadership report.
 * Input: raw dataset from sprintPerformanceService + org directory.
 *
 * Unit of measure is an (issue × sprint) entry in JIRA's Sprint Report, so
 * every per-sprint number matches the board's Reports → Sprint Report view:
 * completed = "Completed Issues" (+ "completed outside this sprint"),
 * carried = "Issues Not Completed", removed = "Issues Removed From Sprint",
 * added = issues marked * (added after the sprint started).
 */

const perfConfig = require('../config/sprintPerformanceConfig.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const UNASSIGNED = 'Unassigned';
const UNMAPPED = 'Unmapped (no manager group)';
const MANAGER_LEFT = 'Unmapped (manager left)';
const NO_LEADER = 'No org data';

function loadPerformanceConfig(teamId) {
  return { ...perfConfig.defaults, ...((perfConfig.teams || {})[teamId] || {}) };
}

function itemWeights(raw) {
  const w = {};
  raw.perSprint.forEach((p) => p.issues.forEach((i) => { if (i.assigneeName) w[i.assigneeName] = (w[i.assigneeName] || 0) + 1; }));
  return w;
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

const MAX_JIRA_URL = 2500; // JIRA (Tomcat) rejects requests whose URL + SSO cookies exceed 8 KB

function jiraUrl(base, jql) {
  if (`${base}/issues/?jql=${encodeURIComponent(jql)}`.length > MAX_JIRA_URL) return null;
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`;
}

function sprintInJql(scope, ids, extra) {
  const clause = `Sprint in (${ids.join(', ')})`;
  const jql = scope ? `(${scope}) AND ${clause}` : clause;
  return extra ? `${jql} AND ${extra}` : jql;
}

function slotLabel(slot, anchor, sprintDays) {
  const start = new Date(new Date(anchor.startIso).getTime() + (slot - anchor.number) * sprintDays * DAY_MS);
  const end = new Date(start.getTime() + (sprintDays - 1) * DAY_MS);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return { slot, name: `S${slot}`, range: `${fmt(start)}–${fmt(end)}`, startIso: start.toISOString().slice(0, 10) };
}

/**
 * Release a closed ticket shipped in: the earliest released fix version whose
 * release date is on/after the resolution date, else the latest released one.
 */
function shippedIn(live) {
  if (!live || !live.resolved) return null;
  const released = (live.fixVersions || []).filter((v) => v.released && v.releaseDate).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  return released.find((v) => v.releaseDate >= live.resolved) || released[released.length - 1] || null;
}

function sprintReportUrl(base, boardId, sprintId) {
  return `${base}/secure/RapidBoard.jspa?rapidView=${boardId}&view=reporting&chart=sprintRetrospective&sprint=${sprintId}`;
}

function buildRows(raw, directory, cfg) {
  const portfolio = new Set(cfg.portfolioIssueTypes);
  const qaTypes = new Set(cfg.qaVerificationIssueTypes);
  const pendingQAStatus = cfg.pendingQAStatusName || 'Resolved';
  const sprintById = Object.fromEntries(raw.sprints.map((s) => [s.id, s]));
  const rows = [];

  const scopeGroups = cfg.scopeGroups || [];
  const inScope = (username) => !scopeGroups.length
    || Boolean(username && (raw.users?.[username]?.groups || []).some((g) => scopeGroups.includes(g)));
  for (const p of raw.perSprint) {
    const s = sprintById[p.sprintId];
    const added = new Set(p.addedKeys);
    for (const i of p.issues) {
      if (!inScope(i.assigneeName)) continue;
      const done = i.bucket === 'completed' || i.bucket === 'completedElsewhere';
      const org = i.assigneeName ? directory.byUser[i.assigneeName] : null;
      const lv = raw.live?.[i.key];
      const userGroups = raw.users?.[i.assigneeName]?.groups || [];
      rows.push({
        scopeGroup: scopeGroups.slice().reverse().find((g) => userGroups.includes(g)) || null,
        key: i.key,
        summary: i.summary,
        issuetype: i.issuetype,
        status: i.status,
        statusNow: lv ? lv.status : i.status,
        live: lv || null,
        bucket: i.bucket,
        assignee: i.assignee || UNASSIGNED,
        manager: !i.assigneeName ? UNASSIGNED : (org?.manager || (org?.formerManager ? MANAGER_LEFT : UNMAPPED)),
        managerGroup: org?.managerGroup || null,
        formerManager: org?.formerManager || null,
        leader: org?.leader || NO_LEADER,
        leaderGroup: org?.leaderGroup || null,
        slot: s.slot,
        sprintId: s.id,
        scrumTeam: s.scrumTeam,
        added: added.has(i.key),
        removed: i.bucket === 'removed',
        done,
        doneElsewhere: i.bucket === 'completedElsewhere',
        carried: i.bucket === 'notCompleted',
        sp: done ? (i.storyPoints || 0) : 0,
        devDone: done && i.issuetype !== 'Test' && !portfolio.has(i.issuetype),
        testDone: done && i.issuetype === 'Test',
        qaVerified: done && qaTypes.has(i.issuetype) && i.status === 'Closed',
        pendingQA: (lv ? lv.status : i.status) === pendingQAStatus,
        unresolvedNow: lv ? lv.statusCategory !== 'done' : i.statusCategory !== 'done',
      });
    }
  }
  const sprintsPerKey = {};
  rows.forEach((r) => { if (!r.removed) sprintsPerKey[r.key] = (sprintsPerKey[r.key] || 0) + 1; });
  rows.forEach((r) => { r.sprintCountEver = sprintsPerKey[r.key] || 0; });
  assignLeaderByManagerMajority(rows);
  const overrides = cfg.managerLeaderOverrides || {};
  rows.forEach((r) => {
    const o = overrides[r.manager];
    if (o) Object.assign(r, { leader: o, leaderGroup: `Team-${o.replace(/ /g, '-')}-Org` });
    if (r.scopeGroup) Object.assign(r, { leader: r.scopeGroup.replace(/^Team-|-Org$/g, '').replace(/-/g, ' '), leaderGroup: r.scopeGroup });
  });
  return rows;
}

// Matrix orgs can split one manager's reports across leaders; keep each manager under one.
function assignLeaderByManagerMajority(rows) {
  const votes = {};
  rows.forEach((r) => {
    if (r.manager === UNASSIGNED || r.manager === UNMAPPED) return;
    const v = (votes[r.manager] = votes[r.manager] || {});
    const k = `${r.leader}\u0000${r.leaderGroup || ''}`;
    v[k] = (v[k] || 0) + 1;
  });
  const winner = {};
  Object.entries(votes).forEach(([m, v]) => {
    const [leader, group] = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0].split('\u0000');
    winner[m] = { leader, leaderGroup: group || null };
  });
  rows.forEach((r) => { if (winner[r.manager]) Object.assign(r, winner[r.manager]); });
  return rows;
}

/** Dev finished = Resolved or Closed at Sprint Report close (statusAtClose on client payload). */
function isDevFinished(r) {
  const s = r.statusAtClose || r.status || '';
  return s === 'Resolved' || s === 'Closed';
}

// committed = every issue in the Sprint Report; planned = committed − added (the start-of-sprint commitment).
function agg(rows, cfg) {
  const count = (fn) => rows.reduce((n, r) => (fn(r) ? n + 1 : n), 0);
  const committed = rows.length;
  const added = count((r) => r.added);
  const planned = committed - added;
  const done = count((r) => r.done);
  const donePlanned = count((r) => r.done && !r.added);
  const carried = count((r) => r.carried);
  const qaVerified = count((r) => r.qaVerified);
  // Same membership / planned denominator as sayDo; Do = Resolved∪Closed (not Sprint Report "Completed").
  const devFinished = count((r) => isDevFinished(r));
  const devFinishedPlanned = count((r) => isDevFinished(r) && !r.added);
  return {
    committed,
    planned,
    added,
    done,
    donePlanned,
    notDone: committed - done,
    carried,
    removed: count((r) => r.removed),
    sayDo: pct(donePlanned, planned),
    sayDoDevFinished: pct(devFinishedPlanned, planned),
    completion: pct(done, committed),
    completionDevFinished: pct(devFinished, committed),
    scopeCreep: pct(added, planned),
    carryover: pct(carried, committed),
    sp: Math.round(rows.reduce((a, r) => a + r.sp, 0)),
    devDone: count((r) => r.devDone),
    testDone: count((r) => r.testDone),
    qaVerified,
    qaVerifiedAdj: Math.round(qaVerified * cfg.qaVerificationRatio * 10) / 10,
    pendingQA: new Set(rows.filter((r) => r.pendingQA).map((r) => r.key)).size,
    devFinished,
    devFinishedPlanned,
    notDevFinishedPlanned: Math.max(0, planned - devFinishedPlanned),
  };
}

function groupBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return m;
}

function seriesFor(rows, slots, cfg) {
  const bySlot = groupBy(rows, (r) => r.slot);
  return slots.map((s) => ({ slot: s.slot, ...agg(bySlot.get(s.slot) || [], cfg) }));
}

// Say/do of the last k slots ("recent") vs the k slots before them ("early").
function halves(series, k = 3) {
  const n = series.length;
  const w = Math.max(1, Math.min(k, Math.floor(n / 2)));
  const avg = (arr) => {
    const p = arr.reduce((a, x) => a + x.planned, 0);
    const d = arr.reduce((a, x) => a + x.donePlanned, 0);
    return pct(d, p);
  };
  return { early: avg(series.slice(n - 2 * w, n - w)), recent: avg(series.slice(n - w)) };
}

function ragFor(sayDo, cfg) {
  if (sayDo == null) return 'YELLOW';
  if (sayDo >= cfg.rag.greenSayDoPct) return 'GREEN';
  if (sayDo >= cfg.rag.yellowSayDoPct) return 'YELLOW';
  return 'RED';
}

// Sprint names drift over time ("Yoda"/"YODA", "HA/DR"/"HADR", "USService(13/May-03/Jun)");
// merge names that differ only by case, punctuation or a date suffix, keeping the most recent spelling.
function canonicalizeTeams(sprints) {
  const clean = (n) => String(n).replace(/\(.*$/, '').trim() || String(n);
  const key = (n) => clean(n).replace(/[^a-z0-9]/gi, '').toUpperCase();
  const latest = {};
  sprints.forEach((s) => {
    const k = key(s.scrumTeam);
    if (!latest[k] || s.slot >= latest[k].slot) latest[k] = { slot: s.slot, name: clean(s.scrumTeam) };
  });
  return sprints.map((s) => ({ ...s, scrumTeam: latest[key(s.scrumTeam)].name }));
}

function computeSprintPerformance(rawInput, directory, cfg) {
  const raw = { ...rawInput, sprints: canonicalizeTeams(rawInput.sprints) };
  const base = raw.jiraBaseUrl;
  const scope = cfg.scopeGroups?.length
    ? `(${cfg.scopeGroups.map((g) => `assignee in membersOf("${g}")`).join(' OR ')})`
    : raw.team.sprintScope;
  const slotNums = Array.from(new Set(raw.sprints.map((s) => s.slot))).sort((a, b) => a - b);
  const slots = slotNums.map((n) => slotLabel(n, raw.anchor, raw.sprintDays));
  const allIds = raw.sprints.map((s) => s.id);
  const rows = buildRows(raw, directory, cfg);
  const link = (jql) => jiraUrl(base, jql);

  const overallSeries = seriesFor(rows, slots, cfg);
  const window = agg(rows, cfg);
  const recentSlots = overallSeries.slice(-cfg.trendSlots);
  const recentSayDo = pct(recentSlots.reduce((a, x) => a + x.donePlanned, 0), recentSlots.reduce((a, x) => a + x.planned, 0));

  const slotSprintIds = Object.fromEntries(slots.map((s) => [s.slot, raw.sprints.filter((x) => x.slot === s.slot).map((x) => x.id)]));
  slots.forEach((s) => { s.url = link(sprintInJql(scope, slotSprintIds[s.slot])); s.sprintCount = slotSprintIds[s.slot].length; });

  const scrumTeams = Array.from(groupBy(rows, (r) => r.scrumTeam).entries()).map(([name, tRows]) => {
    const ids = raw.sprints.filter((s) => s.scrumTeam === name).map((s) => s.id);
    const series = seriesFor(tRows, slots, cfg);
    const mgrCounts = {};
    tRows.forEach((r) => { mgrCounts[r.manager] = (mgrCounts[r.manager] || 0) + 1; });
    const leadManager = Object.entries(mgrCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const window = agg(tRows, cfg);
    const unmeasurable = window.planned < cfg.minPlannedForRanking;
    const active = series.slice(-cfg.trendSlots).some((x) => x.committed > 0);
    return { name, series, window, trend: halves(series, cfg.trendSlots), leadManager, unmeasurable, active, url: link(sprintInJql(scope, ids)), sprintIds: ids };
  }).sort((a, b) => a.unmeasurable - b.unmeasurable || (b.window.sayDo ?? -1) - (a.window.sayDo ?? -1));

  const summarise = (name, gRows, group, emptyJql) => {
    const series = seriesFor(gRows, slots, cfg);
    const extra = group ? `assignee in membersOf("${group}")` : emptyJql;
    const teamCounts = {};
    gRows.forEach((r) => { teamCounts[r.scrumTeam] = (teamCounts[r.scrumTeam] || 0) + 1; });
    return {
      name,
      group,
      people: new Set(gRows.map((r) => r.assignee)).size,
      teams: Object.entries(teamCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t),
      series,
      window: agg(gRows, cfg),
      trend: halves(series, cfg.trendSlots),
      url: extra ? link(sprintInJql(scope, allIds, extra)) : null,
    };
  };

  const leaders = Array.from(groupBy(rows, (r) => r.leader).entries()).map(([name, lRows]) => {
    const group = lRows.find((r) => r.leaderGroup)?.leaderGroup || null;
    const managers = Array.from(groupBy(lRows, (r) => r.manager).entries())
      .map(([mName, mRows]) => ({
        ...summarise(mName, mRows, mRows.find((r) => r.managerGroup)?.managerGroup || null, mName === UNASSIGNED ? 'assignee is EMPTY' : null),
        isLeaderDirects: mName === name,
      }))
      .sort((a, b) => b.window.committed - a.window.committed);
    const major = managers.filter((m) => m.window.committed >= cfg.minPlannedForRanking);
    const minor = managers.filter((m) => m.window.committed < cfg.minPlannedForRanking);
    return { ...summarise(name, lRows, group, null), managers: major, minorManagers: minor };
  }).sort((a, b) => (a.name === NO_LEADER) - (b.name === NO_LEADER) || b.window.committed - a.window.committed);
  const minLeaderItems = cfg.minPlannedForRanking * 2;
  const otherLeaderRows = rows.filter((r) => leaders.some((l) => l.name === r.leader && l.window.committed < minLeaderItems));
  const majorLeaders = leaders.filter((l) => l.window.committed >= minLeaderItems);
  const otherContributors = otherLeaderRows.length ? {
    ...summarise('Other contributors', otherLeaderRows, null, null),
    fromLeaders: leaders.filter((l) => l.window.committed < minLeaderItems).map((l) => l.name),
  } : null;
  const managers = majorLeaders.flatMap((l) => l.managers.map((m) => ({ ...m, leader: l.name })));

  const chronicMap = new Map();
  rows.filter((r) => !r.removed && r.unresolvedNow && r.sprintCountEver >= cfg.chronicCarryoverSprints)
    .forEach((r) => { if (!chronicMap.has(r.key)) chronicMap.set(r.key, r); });
  const chronic = Array.from(chronicMap.values())
    .sort((a, b) => b.sprintCountEver - a.sprintCountEver)
    .map((r) => ({ key: r.key, summary: r.summary, issuetype: r.issuetype, status: r.statusNow, assignee: r.assignee, manager: r.manager, scrumTeam: r.scrumTeam, sprints: r.sprintCountEver, url: `${base}/browse/${r.key}` }));

  const today = new Date(raw.today).getTime();
  const hygieneFrom = slots[Math.max(0, slots.length - cfg.hygieneSlots)]?.slot;
  const recentSprints = raw.sprints.filter((s) => s.slot >= hygieneFrom);
  const sprintRef = (s) => ({ id: s.id, name: s.name, url: sprintReportUrl(base, raw.team.boardId, s.id) });
  const staleActive = recentSprints
    .filter((s) => s.state === 'active' && s.endDate && (today - new Date(s.endDate).getTime()) / DAY_MS > cfg.staleActiveSprintDays)
    .map((s) => ({ ...sprintRef(s), endDate: s.endDate.slice(0, 10), daysOverdue: Math.floor((today - new Date(s.endDate).getTime()) / DAY_MS) }));
  const lateClosed = recentSprints
    .filter((s) => s.completeDate && s.endDate && (new Date(s.completeDate) - new Date(s.endDate)) / DAY_MS > cfg.staleActiveSprintDays)
    .map((s) => ({ ...sprintRef(s), endDate: s.endDate.slice(0, 10), completeDate: s.completeDate.slice(0, 10), daysLate: Math.round((new Date(s.completeDate) - new Date(s.endDate)) / DAY_MS) }));
  const startedEmpty = raw.perSprint
    .filter((p) => p.issues.length >= 5 && p.addedKeys.length / p.issues.length >= 0.9)
    .map((p) => recentSprints.find((s) => s.id === p.sprintId))
    .filter(Boolean)
    .map(sprintRef);
  const lastSlot = slots[slots.length - 1]?.slot;
  const stillOpenLastSlot = raw.sprints.filter((s) => s.slot === lastSlot && s.state === 'active').map((s) => s.name);

  const model = {
    meta: {
      teamName: raw.team.name,
      teamId: raw.team.id,
      boardId: raw.team.boardId,
      generatedAt: raw.generatedAt,
      jiraBaseUrl: base,
      sprintScope: scope,
      scopeLabel: cfg.scopeGroups?.length ? `people in ${cfg.scopeGroups.join(' or ')}` : '',
      slots,
      sprintCount: raw.sprints.length,
      uniqueIssues: new Set(rows.map((r) => r.key)).size,
      people: new Set(rows.map((r) => r.assignee)).size,
      config: cfg,
      allSprintsUrl: link(sprintInJql(scope, allIds)),
      stillOpenLastSlot,
      unmappedItems: rows.filter((r) => r.manager === UNASSIGNED || r.manager === UNMAPPED || r.manager === MANAGER_LEFT).length,
      sprintReportBase: sprintReportUrl(base, raw.team.boardId, ''),
      dataSource: raw.dataSource || 'jira-sprint-report',
    },
    overall: { series: overallSeries, window, recentSayDo, rag: ragFor(recentSayDo, cfg), trend: halves(overallSeries, cfg.trendSlots) },
    scrumTeams,
    leaders: majorLeaders,
    otherContributors,
    managers,
    chronic,
    hygiene: { staleActive, lateClosed, startedEmpty },
    sprints: raw.sprints.map((s) => ({ id: s.id, name: s.name, slot: s.slot, scrumTeam: s.scrumTeam, state: s.state, url: sprintReportUrl(base, raw.team.boardId, s.id) })),
    rows,
  };
  Object.assign(model, buildNarrative(model, cfg));
  return model;
}


/** Unique mid-sprint-added tickets → top product release (excludes master / future buckets). */
function topChurnRelease(rows, releasePrefix) {
  const SKIP = /^(master|era\s*future|era\s*3\.0)$/i;
  const prefix = releasePrefix || '';
  const counts = {};
  const seen = new Set();
  let withRelease = 0;
  rows.filter((r) => r.added && !r.removed).forEach((r) => {
    if (seen.has(r.key)) return;
    seen.add(r.key);
    const versions = ((r.live && r.live.fixVersions) || [])
      .map((v) => v.name)
      .filter((n) => n && !SKIP.test(n) && (!prefix || n.startsWith(prefix)));
    if (!versions.length) return;
    withRelease += 1;
    new Set(versions).forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
  });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || !withRelease) return null;
  const share = (n) => pct(n, withRelease);
  const [name, n] = ranked[0];
  const out = { name, count: n, share: share(n) };
  if (ranked[1]) out.runnerUp = { name: ranked[1][0], count: ranked[1][1], share: share(ranked[1][1]) };
  return out;
}

function buildNarrative(model, cfg) {
  const highlights = [];
  const lowlights = [];
  const { overall, scrumTeams, managers, chronic, hygiene } = model;
  const rankable = scrumTeams.filter((t) => !t.unmeasurable && t.active);
  const trendTxt = `previous ${cfg.trendSlots} vs last ${cfg.trendSlots} sprints`;
  const cite = (label, url) => ({ label, url });

  const d = (overall.trend.recent ?? 0) - (overall.trend.early ?? 0);
  if (overall.trend.recent != null && overall.trend.early != null) {
    (d >= 0 ? highlights : lowlights).push({
      text: `Org-wide say/do ${d >= 0 ? 'improved' : 'declined'} from ${overall.trend.early}% to ${overall.trend.recent}% (${trendTxt}).`,
      cites: [cite(`${model.meta.sprintCount} sprints`, model.meta.allSprintsUrl)],
    });
  }
  rankable.slice(0, 2).forEach((t) => highlights.push({
    text: `${t.name} delivered ${t.window.sayDo}% of planned work (${t.window.donePlanned}/${t.window.planned}) over the last ${model.meta.slots.length} sprints.`,
    cites: [cite(t.name, t.url)],
  }));
  const improvers = rankable
    .filter((t) => t.trend.recent != null && t.trend.early != null && t.trend.recent - t.trend.early >= cfg.improvementAlertPts)
    .sort((a, b) => (b.trend.recent - b.trend.early) - (a.trend.recent - a.trend.early));
  improvers.slice(0, 2).forEach((t) => highlights.push({
    text: `${t.name} is the most improved: say/do ${t.trend.early}% → ${t.trend.recent}%.`,
    cites: [cite(t.name, t.url)],
  }));
  const rankedLeaders = model.leaders.filter((l) => l.group && l.window.planned >= cfg.minPlannedForRanking * 3)
    .sort((a, b) => (b.window.sayDo ?? 0) - (a.window.sayDo ?? 0));
  if (rankedLeaders.length >= 2) {
    const top = rankedLeaders[0];
    const bottom = rankedLeaders[rankedLeaders.length - 1];
    highlights.push({ text: `${top.name}'s org has the strongest say/do at ${top.window.sayDo}% (${top.people} people, ${top.window.committed} items).`, cites: [cite(top.name, top.url)] });
    if ((bottom.window.sayDo ?? 0) < cfg.rag.greenSayDoPct) lowlights.push({ text: `${bottom.name}'s org trails at ${bottom.window.sayDo}% say/do (${bottom.people} people, ${bottom.window.committed} items).`, cites: [cite(bottom.name, bottom.url)] });
  }
  const named = managers.filter((m) => m.group && m.people >= 3 && m.window.planned >= cfg.minPlannedForRanking);
  const bestMgr = [...named].sort((a, b) => (b.window.sayDo ?? 0) - (a.window.sayDo ?? 0))[0];
  if (bestMgr) highlights.push({ text: `${bestMgr.name}'s team leads managers on say/do at ${bestMgr.window.sayDo}% (${bestMgr.people} people).`, cites: [cite(bestMgr.name, bestMgr.url)] });
  const lowCreep = rankable.filter((t) => (t.window.scopeCreep ?? 100) <= 5).map((t) => t.name);
  if (lowCreep.length) highlights.push({ text: `Disciplined planning — scope creep ≤5% in ${lowCreep.join(', ')}.`, cites: rankable.filter((t) => lowCreep.includes(t.name)).map((t) => cite(t.name, t.url)) });

  rankable.slice(-2).reverse().forEach((t) => lowlights.push({
    text: `${t.name} delivered only ${t.window.sayDo}% of planned work (${t.window.donePlanned}/${t.window.planned}); ${t.window.carried} items not completed.`,
    cites: [cite(t.name, t.url)],
  }));
  const decliners = rankable
    .filter((t) => t.trend.recent != null && t.trend.early != null && t.trend.early - t.trend.recent >= cfg.improvementAlertPts)
    .sort((a, b) => (b.trend.early - b.trend.recent) - (a.trend.early - a.trend.recent));
  if (decliners.length) lowlights.push({
    text: `Say/do declining in ${decliners.length} teams (${trendTxt}): ${decliners.map((t) => `${t.name} ${t.trend.early}→${t.trend.recent}%`).join(', ')}.`,
    cites: decliners.map((t) => cite(t.name, t.url)),
  });
  const creepy = rankable.filter((t) => (t.window.scopeCreep ?? 0) > cfg.scopeCreepAlertPct).sort((a, b) => b.window.scopeCreep - a.window.scopeCreep);
  if (creepy.length) {
    const churnRel = topChurnRelease(model.rows, model.meta.releasePrefix);
    const releaseBit = churnRel
      ? ` Most mid-sprint adds landed on ${churnRel.name} (${churnRel.share}% of those tickets)`
        + (churnRel.runnerUp ? `, then ${churnRel.runnerUp.name} (${churnRel.runnerUp.share}%)` : '')
        + '.'
      : '';
    lowlights.push({
      text: `Mid-sprint scope added is ${overall.window.scopeCreep}% of planned (target ≤${cfg.scopeCreepAlertPct}%).${releaseBit} ${creepy.length} teams are above that — highest: ${creepy.slice(0, 5).map((t) => `${t.name} ${t.window.scopeCreep}%`).join(', ')}.`,
      cites: creepy.slice(0, 5).map((t) => cite(t.name, t.url)),
    });
  }
  if (chronic.length) lowlights.push({
    text: `${chronic.length} open tickets have been planned into ${cfg.chronicCarryoverSprints}+ sprints without closing; worst: ${chronic.slice(0, 3).map((c) => `${c.key} (${c.sprints} sprints)`).join(', ')}.`,
    cites: chronic.slice(0, 3).map((c) => cite(c.key, c.url)),
  });
  if (overall.window.pendingQA > 0) lowlights.push({
    text: `${overall.window.pendingQA} sprint items sit in Resolved (awaiting QA verification) right now.`,
    cites: [cite('QA queue', jiraUrl(model.meta.jiraBaseUrl, `${sprintInJql(model.meta.sprintScope, model.scrumTeams.flatMap((t) => t.sprintIds))} AND status = Resolved`))],
  });
  const hyg = [];
  if (hygiene.staleActive.length) hyg.push(`${hygiene.staleActive.length} sprint(s) still open long past end (${hygiene.staleActive.map((s) => `${s.name.split('(')[0]} +${s.daysOverdue}d`).join(', ')})`);
  if (hygiene.startedEmpty.length) {
    const teams = model.scrumTeams
      .filter((t) => t.unmeasurable && hygiene.startedEmpty.some((s) => s.name.includes(t.name)))
      .map((t) => t.name);
    hyg.push(`${hygiene.startedEmpty.length} sprint(s) started before being planned, so say/do can't be measured${teams.length ? ` for ${teams.join(', ')}` : ''}`);
  }
  if (hygiene.lateClosed.length) hyg.push(`${hygiene.lateClosed.length} closed ≥${cfg.staleActiveSprintDays} days late`);
  if (hyg.length) lowlights.push({ text: `Sprint hygiene: ${hyg.join('; ')}.`, cites: [] });
  const unmappedPct = pct(model.meta.unmappedItems, overall.window.committed);
  if (unmappedPct >= 5) lowlights.push({ text: `${unmappedPct}% of sprint items are unassigned or their assignee has no manager group in JIRA — ownership gap.`, cites: [] });

  const asks = [];
  if (decliners.length) asks.push({
    text: `Deep-dive with ${decliners.map((t) => t.name).join(', ')} on the say/do decline — capacity loss, unplanned escalations, or over-commit?`,
    owner: 'Team EMs + TPM',
  });
  if (creepy.length) asks.push({
    text: `Freeze sprint scope after day 2 for ${creepy.slice(0, 3).map((t) => t.name).join(', ')}; route new asks through the next sprint unless P0/P1.`,
    owner: 'Scrum masters',
  });
  if (overall.window.pendingQA > 0) asks.push({
    text: `Run a QA verification burn-down on the ${overall.window.pendingQA} items sitting in Resolved before the next gate.`,
    owner: 'QA leads',
  });
  if (chronic.length) asks.push({
    text: `Re-plan or de-scope the ${Math.min(chronic.length, 20)} oldest chronic carry-overs (planned into ${chronic[0].sprints}+ sprints) — move them to backlog or give them an owner and date.`,
    owner: 'EMs',
  });
  if (hygiene.staleActive.length || hygiene.startedEmpty.length) asks.push({
    text: `Sprint hygiene: close ${hygiene.staleActive.map((s) => s.name).join(', ') || 'overdue sprints'} and plan sprints before starting them (${Array.from(new Set(hygiene.startedEmpty.map((s) => s.name.split(/-?S\d/)[0]))).join(', ')}).`,
    owner: 'Scrum masters',
  });

  return { highlights, lowlights, asks: asks.slice(0, 5) };
}

module.exports = {
  shippedIn, computeSprintPerformance, sprintReportUrl, loadPerformanceConfig, itemWeights, agg, pct, halves,
  isDevFinished, jiraUrl, sprintInJql, UNASSIGNED, UNMAPPED, MANAGER_LEFT,
};
