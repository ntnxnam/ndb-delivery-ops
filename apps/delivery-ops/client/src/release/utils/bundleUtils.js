/**
 * bundleUtils — CRA adapter copy of shared/src/domain/bundleDerive.js (D41).
 * Keep export names in sync (npm --workspace shared run smoke:wave3).
 *
 * CRA cannot import the shared file (ModuleScopePlugin + no Node in the
 * browser graph). Shared is the SoT; this copy is the client runtime.
 *
 * Exports
 * ───────
 *  deriveRetroProjectsFromBundle    – retrospective projects list
 *  deriveRetroDetailFromBundle      – retrospective project detail
 *  deriveSynopsisFromBundle         – release brief synopsis panel
 *  deriveOutstandingFromBundle      – release brief outstanding tiles
 *  deriveVelocityFromBundle         – release brief sprint velocity
 *  deriveBurndownFromBundle         – release brief created-vs-resolved
 *  deriveProjectBreakdownFromBundle – release brief per-FEAT breakdown matrix
 *  deriveComponentListFromBundle    – component report component list
 *  deriveComponentHealthFromBundle  – component report health card
 *  deriveComponentDataFromBundle    – component report outstanding + project breakdown
 *  derivePastSprintReportFromBundle – sprint report by date range
 */

// ── Shared constants ─────────────────────────────────────────────────────────

export const FEAT_TYPES = new Set(['Feature', 'Initiative', 'X-FEAT', 'X-Feat', 'Capability']);
const HIGH_SEVERITY = new Set(['P0', 'P1', 'Blocker', 'Critical', 'Blocker - P0', 'Critical - P1']);

// Resolution-based "done" — matches isDoneResolution() in resolutionCategoriesService.ts.
const DONE_RESOLUTIONS_LC = new Set(['fixed', 'done', 'resolved', 'complete']);

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Resolution-based done (used for general open/closed counts). */
export function isDone(ticket) {
  return (
    ticket['Is Done'] === true ||
    DONE_RESOLUTIONS_LC.has((ticket['Resolution'] ?? '').toLowerCase())
  );
}

/** Status-category-based closed (used for CC gate: Task/Unit Test). */
function isClosed(ticket) {
  return (ticket['Status Category'] ?? '').toLowerCase() === 'done';
}

/** Ticket resolved OR closed — used for CG/PG gate Bug/Improvement. */
function isDevFixed(ticket) {
  return isClosed(ticket) || ticket['Status'] === 'Resolved';
}

function isHighSeverity(ticket) {
  return HIGH_SEVERITY.has(ticket['Priority'] ?? '');
}

function lastDate(dates) {
  if (!dates.length) return null;
  return dates.slice().sort()[dates.length - 1];
}

// ── Hierarchy helpers ─────────────────────────────────────────────────────────

/**
 * Build two lookup maps for a release's tickets:
 *   typeByKey   : issue key → issue type string
 *   epicToFeat  : epic key  → FEAT key
 *
 * The FEAT→Epic link comes from Portfolio Parent Key (customfield_20363)
 * or falls back to Parent Key.
 */
export function buildHierarchyMaps(releaseTickets) {
  const typeByKey = {};
  const epicToFeat = {};

  for (const t of releaseTickets) {
    typeByKey[t['Issue Key']] = t['Issue Type'];
  }
  for (const t of releaseTickets) {
    if (t['Issue Type'] !== 'Epic') continue;
    const featKey = t['Portfolio Parent Key'] || t['Parent Key'];
    if (featKey && FEAT_TYPES.has(typeByKey[featKey])) {
      epicToFeat[t['Issue Key']] = featKey;
    }
  }

  return { typeByKey, epicToFeat };
}

/**
 * Resolve the top-level FEAT key for a work-item ticket.
 * Returns null if the ticket can't be attributed to any FEAT.
 *
 * Order:
 *  1. Parent Key → FEAT
 *  2. Parent Key → Epic → FEAT
 *  3. Epic Link Key → Epic → FEAT
 */
export function resolveFeat(ticket, typeByKey, epicToFeat) {
  const pk = ticket['Parent Key'];
  const el = ticket['Epic Link Key'];

  if (pk) {
    if (FEAT_TYPES.has(typeByKey[pk])) return pk;
    if (epicToFeat[pk]) return epicToFeat[pk];
  }
  if (el && epicToFeat[el]) return epicToFeat[el];
  return null;
}

// ── CC / CG / PG compliance (retrospective) ───────────────────────────────────

/**
 * Compute CC / CG / PG compliance stats for a single FEAT.
 * Logic mirrors retroService.getRetroProjectsPage exactly:
 *   CC  : Task + Unit Test     → done = statusCategory "Done"
 *   CG  : P0/P1 Bug/Improvement→ done = Resolved OR Closed
 *   PG  : All Bug/Improvement  → done = Resolved OR Closed
 *         Test                 → done = statusCategory "Done"
 */
// plannedCcDate parameter is no longer used — CC slip is computed client-side against
// the release-level CCM gate date (bootstrap.gateDates.ccmDate), not a per-FEAT field.
function computeFeatCompliance(featKey, plannedCcDate, children) {
  const cc = { done: 0, open: 0, lastClosedDate: null };
  const cg = { done: 0, open: 0, lastResolvedDate: null };
  const pg = { done: 0, open: 0, lastResolvedDate: null };

  const ccDoneDates = [];
  const cgDoneDates = [];
  const pgDoneDates = [];

  for (const c of children) {
    const it = c['Issue Type'];
    const rd = c['Resolved Date'];

    if (it === 'Task' || it === 'Unit Test') {
      if (isClosed(c)) { cc.done++; if (rd) ccDoneDates.push(rd); }
      else cc.open++;
    }
    if ((it === 'Bug' || it === 'Improvement') && isHighSeverity(c)) {
      if (isDevFixed(c)) { cg.done++; if (rd) cgDoneDates.push(rd); }
      else cg.open++;
    }
    if (it === 'Bug' || it === 'Improvement') {
      if (isDevFixed(c)) { pg.done++; if (rd) pgDoneDates.push(rd); }
      else pg.open++;
    }
    if (it === 'Test') {
      if (isClosed(c)) { pg.done++; if (rd) pgDoneDates.push(rd); }
      else pg.open++;
    }
  }

  cc.lastClosedDate = lastDate(ccDoneDates);
  cg.lastResolvedDate = lastDate(cgDoneDates);
  pg.lastResolvedDate = lastDate(pgDoneDates);

  return { cc, cg, pg };
}

// ── Week bucketing (burndown) ─────────────────────────────────────────────────

function mondayOfWeek(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const dow = d.getUTCDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function buildWeekLabel(mondayIso) {
  if (!mondayIso) return '';
  const d = new Date(mondayIso + 'T00:00:00Z');
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} W${Math.ceil(d.getUTCDate() / 7)}`;
}

// ── Retrospective: projects list ──────────────────────────────────────────────

/**
 * Derive the full projects page from the centralised bundle.
 * Returns null when the bundle has no tickets for this release.
 */
export function deriveRetroProjectsFromBundle(bundle, release) {
  if (!bundle || bundle.length === 0) return null;

  const releaseTickets = bundle.filter((t) => t['Release Name'] === release);
  if (releaseTickets.length === 0) return null;

  const featTickets = releaseTickets.filter(
    (t) =>
      FEAT_TYPES.has(t['Issue Type']) &&
      t.Components &&
      t.Components.includes('top_level_projects')
  );
  if (featTickets.length === 0) return null;

  // Guard: if the bundle was built before the Epic Link field ID was corrected
  // to customfield_10361 (Nutanix JIRA), all Epic Link Key values will be null
  // and resolveFeat() will return null for every ticket. Detect this and fall
  // back to the server API so stale caches don't silently show empty columns.
  const workTowardProject = releaseTickets.filter(
    (t) => t.Components && t.Components.includes('work_toward_project')
  );
  if (workTowardProject.length > 0) {
    const hasParentData = workTowardProject.some(
      (t) => t['Parent Key'] || t['Epic Link Key'] || t['Portfolio Parent Key']
    );
    if (!hasParentData) return null;
  }

  const { typeByKey, epicToFeat } = buildHierarchyMaps(releaseTickets);

  const childrenByFeat = {};
  for (const feat of featTickets) childrenByFeat[feat['Issue Key']] = [];

  for (const t of releaseTickets) {
    if (FEAT_TYPES.has(t['Issue Type']) || t['Issue Type'] === 'Epic') continue;
    const featKey = resolveFeat(t, typeByKey, epicToFeat);
    if (featKey && childrenByFeat[featKey]) childrenByFeat[featKey].push(t);
  }

  // Guard: if work_toward_project tickets exist but none could be attributed to any
  // FEAT via parent/epic links, the hierarchy traversal failed (e.g. portfolioChildrenOf
  // links aren't captured in the bundle fields). Fall back to the server API which uses
  // portfolioChildrenOf JQL directly and builds correct gate compliance counts.
  const totalAttributed = Object.values(childrenByFeat).reduce((s, arr) => s + arr.length, 0);
  if (totalAttributed === 0 && workTowardProject.length > 0) return null;

  const projects = featTickets.map((feat) => {
    const children = childrenByFeat[feat['Issue Key']] ?? [];
    // Pass null for plannedCcDate — CC slip is now computed client-side against the
    // release-level CCM gate date (bootstrap.gateDates.ccmDate), not customfield_11067.
    const { cc, cg, pg } = computeFeatCompliance(feat['Issue Key'], null, children);
    return {
      key: feat['Issue Key'],
      summary: feat['Summary'] || feat['Issue Key'],
      parentType: feat['Issue Type'] === 'Initiative' ? 'Initiative' : 'Feature',
      cc,
      cg,
      pg,
      _fromBundle: true,
      _childCount: children.length,
    };
  });

  return { page: 1, limit: projects.length, total: projects.length, hasMore: false, projects, _source: 'bundle' };
}

// ── Retrospective: project detail ─────────────────────────────────────────────

// ── Gate-compliance helpers (mirror retroService.ts) ─────────────────────────

function isPastGate(isoDate) {
  if (!isoDate) return false;
  const d = new Date(`${isoDate}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.getTime() <= Date.now();
}

function ccmRagFn(pct) {
  if (pct >= 95) return 'green';
  if (pct >= 80) return 'yellow';
  return 'red';
}

function thresholdRagFn(v, yellowMax, redMin) {
  if (v === 0) return 'green';
  if (v <= yellowMax) return 'yellow';
  if (v >= redMin) return 'red';
  return 'yellow';
}

/**
 * Derive the detail view for a single FEAT from the bundle.
 * Returns the same shape as getRetroProjectDetail on the server, including
 * a `checks` object so GateComplianceCard renders live data instead of all-zeros.
 *
 * Note: open-at-gate counts use Resolved Date as a proxy for JIRA status history.
 * Skipped = gate date not yet reached; mirrors server behaviour (returns 0 for future gates).
 *
 * @param {object} gateDates – { ccmDate, cgDate, pgDate, gaDate } ISO strings
 */
export function deriveRetroDetailFromBundle(bundle, release, parentKey, gateDates) {
  if (!bundle || bundle.length === 0) return null;

  const releaseTickets = bundle.filter((t) => t['Release Name'] === release);

  // Same guard as deriveRetroProjectsFromBundle: if work_toward_project tickets
  // exist but none have parent link data, the Classic JIRA hierarchy is broken
  // and resolveFeat() will return null for every child. Return null to fall
  // through to the server API which handles Classic JIRA correctly.
  const workTowardProject = releaseTickets.filter(
    (t) => t.Components && t.Components.includes('work_toward_project')
  );
  if (workTowardProject.length > 0) {
    const hasParentData = workTowardProject.some(
      (t) => t['Parent Key'] || t['Epic Link Key'] || t['Portfolio Parent Key']
    );
    if (!hasParentData) return null;
  }

  const { typeByKey, epicToFeat } = buildHierarchyMaps(releaseTickets);

  const children = releaseTickets.filter((t) => {
    if (FEAT_TYPES.has(t['Issue Type']) || t['Issue Type'] === 'Epic') return false;
    return resolveFeat(t, typeByKey, epicToFeat) === parentKey;
  });

  // If no children were resolved it almost always means the bundle lacks the
  // portfolio parent-link fields (portfolioChildrenOf hierarchy isn't stored in
  // the JIRA parent/epicLink/portfolioParent fields). Return null so the caller
  // falls back to the server path which uses portfolioChildrenOf JQL directly.
  if (children.length === 0) return null;

  const { cc, cg, pg } = computeFeatCompliance(
    parentKey,
    gateDates?.ccmDate ?? null,
    children
  );

  // Tickets where resolved date is after the gate date (or never resolved) = open at gate.
  const openAtGate = (tickets, gateDate) => {
    if (!gateDate) return [];
    return tickets.filter((t) => { const rd = t['Resolved Date']; return !rd || rd > gateDate; });
  };

  const hasPastCcm = isPastGate(gateDates?.ccmDate);
  const hasPastCg  = isPastGate(gateDates?.cgDate);
  const hasPastPg  = isPastGate(gateDates?.pgDate);
  const hasPastGa  = isPastGate(gateDates?.gaDate);

  // CCM gate: Task + Unit Test
  const ccmTickets   = children.filter((t) => t['Issue Type'] === 'Task' || t['Issue Type'] === 'Unit Test');
  const ccmOpenArr   = openAtGate(ccmTickets, gateDates?.ccmDate);
  const ccmOpenCount = hasPastCcm ? ccmOpenArr.length : 0;
  const ccmTotal     = ccmTickets.length;
  const ccmClosedPct = ccmTotal > 0 ? Math.round(((ccmTotal - ccmOpenCount) / ccmTotal) * 100) : 100;

  // CG gate: high-severity bugs/improvements open at gate + found after gate
  const highSevBugs  = children.filter((t) => (t['Issue Type'] === 'Bug' || t['Issue Type'] === 'Improvement') && isHighSeverity(t));
  const cgOpenArr    = openAtGate(highSevBugs, gateDates?.cgDate);
  const cgFoundAfterArr = gateDates?.cgDate
    ? highSevBugs.filter((t) => { const cd = t['Created Date']; return cd && cd > gateDates.cgDate; })
    : [];

  // PG gate: all bugs/improvements (non-deferred) + tests
  const pgBugTickets = children.filter((t) => (t['Issue Type'] === 'Bug' || t['Issue Type'] === 'Improvement') && !(t.Labels ?? '').includes('deferred'));
  const pgTestTickets = children.filter((t) => t['Issue Type'] === 'Test');
  const pgBugsArr    = openAtGate(pgBugTickets, gateDates?.pgDate);
  const pgTestsArr   = openAtGate(pgTestTickets, gateDates?.pgDate);

  // GA gate: all work items open at gate
  const gaOpenArr    = openAtGate(children, gateDates?.gaDate);

  const checks = {
    ccm: {
      skipped: !hasPastCcm,
      total: ccmTotal,
      openAtGate: ccmOpenCount,
      closedPct: ccmClosedPct,
      rag: ccmRagFn(ccmClosedPct),
      links: {},
    },
    cg: {
      skipped: !hasPastCg,
      p0p1OpenAtGate: hasPastCg ? cgOpenArr.length : 0,
      p0p1FoundAfter: hasPastCg ? cgFoundAfterArr.length : 0,
      ragOpen:  thresholdRagFn(hasPastCg ? cgOpenArr.length : 0, 3, 4),
      ragAfter: thresholdRagFn(hasPastCg ? cgFoundAfterArr.length : 0, 5, 6),
      links: {},
    },
    pg: {
      skipped: !hasPastPg,
      testsOpenAtGate: hasPastPg ? pgTestsArr.length : 0,
      bugsOpenAtGate:  hasPastPg ? pgBugsArr.length : 0,
      ragTests: thresholdRagFn(hasPastPg ? pgTestsArr.length : 0, 5, 6),
      ragBugs:  thresholdRagFn(hasPastPg ? pgBugsArr.length : 0, 3, 4),
      links: {},
    },
    ga: {
      skipped: !hasPastGa,
      openAtGate: gaOpenArr.length,
      rag: thresholdRagFn(hasPastGa ? gaOpenArr.length : 0, 2, 3),
      links: {},
    },
  };

  return {
    parentKey,
    cc, cg, pg,
    checks,
    ccmOpen: ccmOpenArr.map((t) => t['Issue Key']),
    cgOpen: cgOpenArr.map((t) => t['Issue Key']),
    pgBugsOpen: pgBugsArr.map((t) => t['Issue Key']),
    pgTestsOpen: pgTestsArr.map((t) => t['Issue Key']),
    childCount: children.length,
    _source: 'bundle',
  };
}

// ── Release Brief: synopsis ───────────────────────────────────────────────────

const COMPONENT_LABELS = {
  top_level_projects: 'Top-Level Projects',
  work_toward_project: 'Work Toward Projects',
  standalone_epics: 'Standalone Epics',
  work_toward_standalone_epic: 'Work Toward Standalone Epics',
  direct_tickets: 'Direct Release Tickets',
  portfolio_children: 'Work Toward Projects',
  epic_children: 'Work Toward Projects (Epic Children)',
};

/**
 * Derive the synopsis panel (per-bucket + per-issue-group counts).
 * Mirrors: GET /api/release-dataset/synopsis
 */
export function deriveSynopsisFromBundle(bundle, release) {
  if (!bundle || bundle.length === 0) return null;
  const tickets = bundle.filter((t) => t['Release Name'] === release);
  if (tickets.length === 0) return null;

  const componentCounts = {};
  for (const [key, label] of Object.entries(COMPONENT_LABELS)) {
    componentCounts[key] = { key, label, count: 0 };
  }
  for (const t of tickets) {
    for (const c of (t.Components || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (componentCounts[c]) componentCounts[c].count++;
    }
  }

  const uniqueKeys = new Set(tickets.map((t) => t['Issue Key']));

  const ISSUE_GROUP_KEYS = ['Project Hierarchy', 'Bug', 'Improvement', 'Dev Code', 'Test', 'Everything Else'];
  const issueTypeGroups = ISSUE_GROUP_KEYS.map((label) => ({
    key: `issue_group_${label.toLowerCase().replace(/\s+/g, '_')}`,
    label,
    count: tickets.filter((t) => t['Issue Group'] === label).length,
  }));

  const deferredCount = tickets.filter((t) => t['Is Deferred'] === true).length;

  return {
    release,
    total: { key: 'engineering_payload', label: 'Total Release Payload (deduped)', count: uniqueKeys.size },
    components: Object.values(componentCounts),
    sidecars: [{ key: 'deferred', label: 'Deferred', count: deferredCount }],
    issueTypeGroups,
    rawComponentSum: Object.values(componentCounts).reduce((s, c) => s + c.count, 0),
    _source: 'bundle',
  };
}

// ── Release Brief: outstanding tiles ─────────────────────────────────────────

/**
 * Derive the 5 Outstanding & Deferred tiles.
 * Mirrors: GET /api/release-dataset/outstanding
 * Note: pushed_out tile requires fixVersion changelog — not in bundle, returns null count.
 */
export function deriveOutstandingFromBundle(bundle, release, labelPrefix) {
  if (!bundle || bundle.length === 0) return null;
  const tickets = bundle.filter((t) => t['Release Name'] === release);
  if (tickets.length === 0) return null;

  const workTickets = tickets.filter((t) => !FEAT_TYPES.has(t['Issue Type']));

  return {
    release,
    tiles: [
      { key: 'open_in_release',   label: 'Open',       caption: 'Work still unfinished inside the release payload',               count: workTickets.filter((t) => !isDone(t) && !t['Is Deferred']).length },
      { key: 'closed_in_release', label: 'Closed',     caption: 'Resolved within the release payload',                            count: workTickets.filter((t) => isDone(t)).length },
      { key: 'deferred_label',    label: 'Deferred',   caption: `Labeled ${labelPrefix}-${release}-deferred`,                     count: workTickets.filter((t) => t['Is Deferred'] === true).length },
      { key: 'pushed_out',        label: 'Pushed Out', caption: 'Requires fixVersion history — re-sync to populate',              count: null },
      { key: 'blocked_open',      label: 'Blocked',    caption: 'Open tickets with a blocked label',                              count: workTickets.filter((t) => !isDone(t) && (t.Labels ?? '').toLowerCase().includes('blocked')).length },
    ],
    _source: 'bundle',
  };
}

// ── Release Brief: sprint velocity ───────────────────────────────────────────

/**
 * Derive 3-stream sprint velocity (Dev / QA-Verification / QA-Test-Tasks)
 * for the most recent N sprints. NOT release-scoped (team capacity metric).
 * Mirrors: GET /api/release-dataset/velocity
 */
export function deriveVelocityFromBundle(bundle, sprintsBack = 3) {
  if (!bundle || bundle.length === 0) return null;

  const resolved = bundle.filter((t) => t['Sprint Number'] != null);
  if (resolved.length === 0) return null;

  const maxSprint = Math.max(...resolved.map((t) => t['Sprint Number']));
  const sprints = [];

  for (let i = 0; i < sprintsBack; i++) {
    const sprintNum = maxSprint - i;
    if (sprintNum < 1) break;

    const devTickets = resolved.filter(
      (t) => t['Sprint Number'] === sprintNum && t['Work Type'] === 'Dev' && t['Issue Group'] !== 'Project Hierarchy'
    );
    const qaVerTickets = bundle.filter(
      (t) => t['Closed Sprint Number'] === sprintNum && (t['Issue Type'] === 'Bug' || t['Issue Type'] === 'Improvement') && t['Is QA Verification'] === true
    );
    const qaTestTickets = resolved.filter(
      (t) => t['Sprint Number'] === sprintNum && t['Issue Type'] === 'Test'
    );

    sprints.push({
      sprintNumber: sprintNum,
      sprintLabel: `S${sprintNum}`,
      isCurrent: i === 0,
      dev:            { count: devTickets.length,    storyPoints: devTickets.reduce((s, t) => s + (t['Story Points'] || 0), 0) },
      qaVerification: { count: qaVerTickets.length,  adjustedCount: Math.round(qaVerTickets.length * 0.33 * 100) / 100 },
      qaTestTasks:    { count: qaTestTickets.length, storyPoints: qaTestTickets.reduce((s, t) => s + (t['Story Points'] || 0), 0) },
      _source: 'bundle',
    });
  }

  sprints.reverse(); // chronological order (oldest first)
  return { sprints, _source: 'bundle' };
}

// ── Release Brief: burndown ───────────────────────────────────────────────────

/**
 * Derive week-by-week Created vs Resolved counts for a release.
 * Mirrors: GET /api/release-dataset/burndown
 */
export function deriveBurndownFromBundle(bundle, release, weeks = 52) {
  if (!bundle || bundle.length === 0) return null;
  const tickets = bundle.filter((t) => t['Release Name'] === release);
  if (tickets.length === 0) return null;

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const dow = now.getUTCDay();
  const currentMonday = new Date(now);
  currentMonday.setUTCDate(now.getUTCDate() - (dow === 0 ? 6 : dow - 1));

  const orderedKeys = [];
  const buckets = {};
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(currentMonday);
    d.setUTCDate(currentMonday.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    orderedKeys.push(key);
    buckets[key] = { weekStart: key, weekLabel: buildWeekLabel(key), created: 0, resolved: 0 };
  }
  const windowStartMs = new Date(orderedKeys[0] + 'T00:00:00Z').getTime();

  for (const t of tickets) {
    const createdStr  = t['Created Date'];
    const resolvedStr = t['Resolved Date'];
    if (createdStr) {
      const ms = new Date(createdStr).getTime();
      if (!isNaN(ms) && ms >= windowStartMs) { const k = mondayOfWeek(createdStr);  if (k && buckets[k]) buckets[k].created++; }
    }
    if (resolvedStr) {
      const ms = new Date(resolvedStr).getTime();
      if (!isNaN(ms) && ms >= windowStartMs) { const k = mondayOfWeek(resolvedStr); if (k && buckets[k]) buckets[k].resolved++; }
    }
  }

  return { release, weeks, totalFetched: tickets.length, weeklyData: orderedKeys.map((k) => buckets[k]), _source: 'bundle' };
}

// ── Release Brief: project breakdown matrix ───────────────────────────────────

/**
 * Derive the per-FEAT issue-type-group breakdown matrix.
 * Mirrors: GET /api/release-dataset/project-breakdown
 */
export function deriveProjectBreakdownFromBundle(bundle, release) {
  if (!bundle || bundle.length === 0) return null;
  const releaseTickets = bundle.filter((t) => t['Release Name'] === release);
  if (releaseTickets.length === 0) return null;

  const { typeByKey, epicToFeat } = buildHierarchyMaps(releaseTickets);

  const featTickets = releaseTickets.filter(
    (t) => FEAT_TYPES.has(t['Issue Type']) && t.Components && t.Components.includes('top_level_projects')
  );

  const GROUP_LABELS = ['Project Hierarchy', 'Bug', 'Improvement', 'Dev Code', 'Test', 'Everything Else'];

  const projects = featTickets.map((feat) => {
    const children = releaseTickets.filter(
      (t) => !FEAT_TYPES.has(t['Issue Type']) && t['Issue Type'] !== 'Epic' && resolveFeat(t, typeByKey, epicToFeat) === feat['Issue Key']
    );

    // Accumulate per-group counts keyed by label
    const groupsMap = {};
    for (const child of children) {
      const g = child['Issue Group'] || 'Everything Else';
      if (!groupsMap[g]) groupsMap[g] = { outstanding: 0, toVerify: 0, closed: 0, total: 0 };
      groupsMap[g].total++;
      if (isDone(child)) {
        if (child['Is QA Verification']) groupsMap[g].toVerify++;
        else groupsMap[g].closed++;
      } else {
        groupsMap[g].outstanding++;
      }
    }

    // Convert to the array shape that ProjectBreakdownMatrix / deriveStreams expects:
    // [{ label, outstanding, toVerify, closed, total }, …]
    const issueTypeGroups = GROUP_LABELS.map((label) => ({
      label,
      ...(groupsMap[label] || { outstanding: 0, toVerify: 0, closed: 0, total: 0 }),
    }));

    return {
      projectKey: feat['Issue Key'],
      projectName: feat['Summary'] || feat['Issue Key'],
      issueType: feat['Issue Type'],
      plannedCcDate: feat['CC Date'] ?? null,
      total: children.length,
      outstanding: children.filter((t) => !isDone(t)).length,
      closed: children.filter((t) => isDone(t)).length,
      issueTypeGroups,
      _fromBundle: true,
    };
  });

  return { release, projects, _source: 'bundle' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reopen Quality Metrics derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive reopen quality metrics for a release from the bundle.
 *
 * Returns:
 *   {
 *     release,
 *     totalQualityTickets,   // Bug + Improvement + Test in this release
 *     bugsReopened,          // tickets with Reopen Count > 0
 *     totalReopens,          // sum of all Reopen Count values
 *     avgReopensPerTicket,   // totalReopens / totalQualityTickets
 *     maxReopens,            // highest single Reopen Count
 *     perProject: [          // top-N projects sorted by totalReopens desc
 *       { projectKey, projectSummary, bugCount, bugsReopened, totalReopens, worstBugKey, worstBugReopens }
 *     ]
 *   }
 *
 * Returns null if bundle is empty, no data for the release, or all
 * Reopen Count fields are still 0 (bundle was synced before this feature).
 */
export function deriveQualityMetricsFromBundle(bundle, release) {
  if (!bundle || !bundle.tickets || !release) return null;

  const QUALITY_TYPES = new Set(['Bug', 'Improvement', 'Test']);
  const releaseTickets = bundle.tickets.filter(
    (t) => t['Release Name'] === release && QUALITY_TYPES.has(t['Issue Type'])
  );
  if (releaseTickets.length === 0) return null;

  // Only meaningful if at least one ticket has a non-zero Reopen Count.
  // A bundle synced before this feature will have all zeros — no point showing zeros.
  const anyReopened = releaseTickets.some((t) => (t['Reopen Count'] || 0) > 0);
  if (!anyReopened) return null;

  const totalReopens = releaseTickets.reduce((s, t) => s + (t['Reopen Count'] || 0), 0);
  const bugsReopened = releaseTickets.filter((t) => (t['Reopen Count'] || 0) > 0).length;
  const maxReopens = Math.max(...releaseTickets.map((t) => t['Reopen Count'] || 0));

  // Group by FEAT (Portfolio Parent Key → Epic Link Key → Parent Key → self as fallback)
  const projectMap = {};
  for (const t of releaseTickets) {
    const projectKey =
      t['Portfolio Parent Key'] || t['Epic Link Key'] || t['Parent Key'] || '_direct_';
    if (!projectMap[projectKey]) {
      projectMap[projectKey] = {
        projectKey,
        projectSummary: projectKey,
        bugCount: 0,
        bugsReopened: 0,
        totalReopens: 0,
        worstBugKey: null,
        worstBugReopens: 0,
      };
    }
    const p = projectMap[projectKey];
    p.bugCount++;
    const rc = t['Reopen Count'] || 0;
    p.totalReopens += rc;
    if (rc > 0) p.bugsReopened++;
    if (rc > p.worstBugReopens) {
      p.worstBugReopens = rc;
      p.worstBugKey = t['Issue Key'];
    }
  }

  const perProject = Object.values(projectMap)
    .filter((p) => p.totalReopens > 0)
    .sort((a, b) => b.totalReopens - a.totalReopens)
    .slice(0, 15);

  return {
    release,
    totalQualityTickets: releaseTickets.length,
    bugsReopened,
    totalReopens,
    avgReopensPerTicket: releaseTickets.length > 0
      ? Math.round((totalReopens / releaseTickets.length) * 100) / 100
      : 0,
    maxReopens,
    perProject,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-release comparison derivations (retrospective enrichment)
// ─────────────────────────────────────────────────────────────────────────────

/** Accept either a flat ticket array or a { tickets } bundle object. */
function ticketsOf(bundleOrArray) {
  if (Array.isArray(bundleOrArray)) return bundleOrArray;
  return bundleOrArray?.tickets || [];
}

/** Whole-day difference (b - a) in calendar days, or null if unparseable. */
function daysBetween(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

function percentile(nums, p) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

function average(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((x, y) => x + y, 0) / nums.length) * 10) / 10;
}

/** Coarse resolution category (velocity-resolution-categories.mdc). */
function resolutionCategory(res) {
  const r = (res ?? '').toLowerCase();
  if (!r || r === 'unresolved') return 'Unresolved';
  if (DONE_RESOLUTIONS_LC.has(r)) return 'Done';
  if (r === 'cannot reproduce' || r === 'duplicate') return 'Dupe or Not Reproducible';
  return 'Others';
}

/**
 * Bundle-derived scorecard for one release. All counts are offline
 * (no JIRA call). Each metric carries an approximate fixVersion-scoped
 * JQL string for click-through (the caller turns it into a URL).
 *
 * Mirror of shared/src/domain/bundleDerive.js — keep in sync.
 */
export function deriveReleaseScorecardFromBundle(bundleOrArray, release) {
  const all = ticketsOf(bundleOrArray);
  if (!all.length || !release) return null;
  const list = all.filter((t) => t['Release Name'] === release);
  if (!list.length) return null;

  const fv = `fixVersion = "${release}"`;

  const taskList = list.filter((t) => t['Issue Type'] === 'Task' || t['Issue Type'] === 'Unit Test');
  const taskDone = taskList.filter(isClosed).length;
  const taskClosure = {
    total: taskList.length,
    done: taskDone,
    pct: taskList.length ? Math.round((taskDone / taskList.length) * 100) : 0,
    jql: `${fv} AND issuetype in (Task, "Unit Test")`,
  };

  const bugList = list.filter((t) => t['Issue Type'] === 'Bug');
  const byResolution = { Done: 0, Unresolved: 0, 'Dupe or Not Reproducible': 0, Others: 0 };
  let bugsDone = 0;
  for (const t of bugList) {
    const cat = resolutionCategory(t['Resolution']);
    byResolution[cat] = (byResolution[cat] || 0) + 1;
    if (isDone(t)) bugsDone++;
  }
  const bugs = {
    total: bugList.length,
    done: bugsDone,
    open: bugList.length - bugsDone,
    byResolution,
    jql: `${fv} AND issuetype = Bug`,
  };

  const isP0 = (t) => t['Priority'] === 'Blocker - P0';
  const isP1 = (t) => t['Priority'] === 'Critical - P1';
  const p0List = list.filter(isP0);
  const p1List = list.filter(isP1);
  const p0 = {
    total: p0List.length,
    open: p0List.filter((t) => !isDone(t)).length,
    jql: `${fv} AND priority = "Blocker - P0"`,
  };
  const p1 = {
    total: p1List.length,
    open: p1List.filter((t) => !isDone(t)).length,
    jql: `${fv} AND priority = "Critical - P1"`,
  };

  const QUALITY = new Set(['Bug', 'Improvement', 'Test']);
  const qualityList = list.filter((t) => QUALITY.has(t['Issue Type']));
  const reopened = qualityList.filter((t) => (t['Reopen Count'] || 0) > 0).length;
  const reopen = {
    qualityTickets: qualityList.length,
    reopened,
    rate: qualityList.length ? Math.round((reopened / qualityList.length) * 1000) / 10 : 0,
    jql: `${fv} AND issuetype in (Bug, Improvement, Test)`,
  };

  return { release, taskClosure, bugs, p0, p1, reopen };
}

/**
 * Bug / Improvement verification at the Promotion Gate (PG).
 * Mirror of shared/src/domain/bundleDerive.js — keep in sync.
 */
export function deriveBugVerificationAtPG(bundleOrArray, release, pgDate) {
  const all = ticketsOf(bundleOrArray);
  if (!all.length || !release) return null;
  const list = all.filter((t) => t['Release Name'] === release);
  if (!list.length) return null;

  const forType = (issueType) => {
    const items = list.filter((t) => t['Issue Type'] === issueType);
    const resolvedField = (t) => t['Last Resolved Date'] || t['Resolved Date'] || null;

    const lags = [];
    for (const t of items) {
      const closed = t['Closed Date'];
      const resolved = resolvedField(t);
      const d = daysBetween(resolved, closed);
      if (d != null && d >= 0) lags.push(d);
    }

    let unverifiedAtPg = null;
    if (pgDate) {
      unverifiedAtPg = items.filter((t) => {
        const resolved = resolvedField(t);
        if (!resolved) return false;
        if (daysBetween(resolved, pgDate) < 0) return false;
        const closed = t['Closed Date'];
        return !closed || daysBetween(pgDate, closed) > 0;
      }).length;
    }

    const reopened = items.filter((t) => (t['Reopen Count'] || 0) > 0).length;
    const dist = { le7: 0, d8_30: 0, d31_90: 0, gt90: 0 };
    for (const d of lags) {
      if (d <= 7) dist.le7++;
      else if (d <= 30) dist.d8_30++;
      else if (d <= 90) dist.d31_90++;
      else dist.gt90++;
    }

    const typeClause = `issuetype = ${issueType}`;
    return {
      count: items.length,
      verifiedCount: lags.length,
      unverifiedAtPg,
      lag: {
        median: median(lags),
        avg: average(lags),
        p90: percentile(lags, 90),
        dist,
      },
      reopened,
      reopenRate: items.length ? Math.round((reopened / items.length) * 1000) / 10 : 0,
      jqlClosed: `fixVersion = "${release}" AND ${typeClause} AND status = Closed`,
      jqlUnverified: pgDate
        ? `fixVersion = "${release}" AND ${typeClause} AND status = Resolved AND status was not Closed ON "${pgDate}"`
        : null,
    };
  };

  return {
    release,
    pgDate: pgDate || null,
    bug: forType('Bug'),
    improvement: forType('Improvement'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Report derivations
// ─────────────────────────────────────────────────────────────────────────────

const CR_PRIORITY_ORDER = {
  'Blocker - P0': 0,
  'Critical - P1': 1,
  'Major - P2': 2,
  'Minor - P3': 3,
  'Trivial - P4': 4,
};

const CR_WORK_TYPES = ['Bug', 'TaskUnit', 'Improvement', 'Test', 'Other'];

function crClassifyType(issueType) {
  const t = (issueType || '').toLowerCase();
  if (t === 'bug') return 'Bug';
  if (t === 'improvement') return 'Improvement';
  if (t === 'task' || t === 'unit test') return 'TaskUnit';
  if (t === 'test') return 'Test';
  return 'Other';
}

function crIsDone(ticket) {
  const cat = (ticket['Status Category'] || '').toLowerCase();
  return cat === 'done';
}

function ticketHasComponent(ticket, componentName) {
  const comps = ticket['JIRA Components'] || '';
  return comps.split(',').map(s => s.trim()).includes(componentName);
}

/**
 * Return { success, components, count } from bundle.
 * components is an array of { name } objects — same shape as /api/component/list.
 * Returns null if bundle is empty.
 */
export function deriveComponentListFromBundle(bundle) {
  if (!bundle || !bundle.tickets || bundle.tickets.length === 0) return null;
  const nameSet = new Set();
  for (const t of bundle.tickets) {
    const comps = t['JIRA Components'] || '';
    comps.split(',').forEach(c => { const n = c.trim(); if (n) nameSet.add(n); });
  }
  if (nameSet.size === 0) return null;
  const components = [...nameSet].sort().map(name => ({ name }));
  return { success: true, components, count: components.length };
}

/**
 * Return { health, actions } for a named JIRA component — same shape as /api/component/health.
 * Returns null if bundle has no data for this component.
 */
export function deriveComponentHealthFromBundle(bundle, componentName) {
  if (!bundle || !bundle.tickets || !componentName) return null;
  const tickets = bundle.tickets.filter(t => ticketHasComponent(t, componentName));
  if (tickets.length === 0) return null;

  const outstanding = tickets.filter(t => !crIsDone(t));
  const p0Issues = outstanding.filter(t => t['Priority'] === 'Blocker - P0');
  const p1Issues = outstanding.filter(t => t['Priority'] === 'Critical - P1');

  let status = 'green';
  let verdict = 'ON TRACK';
  if (p0Issues.length > 3 || p1Issues.length > 8) { status = 'red'; verdict = 'CRITICAL'; }
  else if (p0Issues.length > 0 || p1Issues.length > 5) { status = 'yellow'; verdict = 'AT RISK'; }

  const now = Date.now();
  const ages = outstanding
    .map(t => t['Created Date'] ? Math.floor((now - new Date(t['Created Date']).getTime()) / 86400000) : 0);
  const avgAge = ages.length > 0 ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0;

  const total = tickets.length;
  const deferralPercent = total > 0 ? Math.floor((total - outstanding.length) / total * 100) : 0;

  const actions = p0Issues.length > 0 ? [{
    severity: 'critical',
    key: p0Issues[0]['Issue Key'],
    summary: p0Issues[0]['Summary'] || '',
    detail: `P0, ${p0Issues.length} total unresolved`,
    actions: ['Review', 'Escalate'],
  }] : [];

  return {
    health: { componentName, status, verdict, p0Count: p0Issues.length, p1Count: p1Issues.length,
      outstandingCount: outstanding.length, deferralPercent, avgAge },
    actions,
  };
}

/**
 * Return { outstanding, projectBreakdown, staleProjects, availableReleases }
 * for a named JIRA component — same shape as /api/component/data.
 * Returns null if bundle has no data for this component.
 */
export function deriveComponentDataFromBundle(bundle, componentName) {
  if (!bundle || !bundle.tickets || !componentName) return null;
  const tickets = bundle.tickets.filter(t => ticketHasComponent(t, componentName));
  if (tickets.length === 0) return null;

  const now = Date.now();

  // ── Build outstanding list ────────────────────────────────────────────────
  const outstanding = tickets
    .filter(t => !crIsDone(t))
    .map(t => {
      const age = t['Created Date']
        ? Math.floor((now - new Date(t['Created Date']).getTime()) / 86400000) : 0;
      return {
        key: t['Issue Key'],
        summary: t['Summary'] || '',
        issuetype: t['Issue Type'] || '',
        priority: t['Priority'] || 'Unprioritised',
        priorityOrder: CR_PRIORITY_ORDER[t['Priority']] ?? 5,
        assignee: t['Assignee'] || 'Unassigned',
        age,
        status: t['Status'] || '',
        fixVersions: t['Release Name'] || '',
      };
    })
    .sort((a, b) => {
      if (a.priorityOrder !== b.priorityOrder) return a.priorityOrder - b.priorityOrder;
      return b.age - a.age;
    });

  // ── Build available releases ──────────────────────────────────────────────
  const releaseSet = new Set();
  tickets.forEach(t => {
    const rel = t['Release Name'] || '';
    if (/^NDB-\d/.test(rel) || rel.toLowerCase() === 'master') releaseSet.add(rel);
  });
  const sortFV = (a, b) => {
    const ndbA = /^NDB-(\d+)\.(\d+)/.exec(a);
    const ndbB = /^NDB-(\d+)\.(\d+)/.exec(b);
    if (ndbA && ndbB) return parseInt(ndbB[1]) - parseInt(ndbA[1]) || parseInt(ndbB[2]) - parseInt(ndbA[2]);
    if (ndbA) return -1;
    if (ndbB) return 1;
    if (a.toLowerCase() === 'master') return -1;
    if (b.toLowerCase() === 'master') return 1;
    return a.localeCompare(b);
  };
  const availableReleases = [...releaseSet].sort(sortFV);

  // ── Build hierarchy maps for project breakdown ────────────────────────────
  const ticketByKey = {};
  tickets.forEach(t => { ticketByKey[t['Issue Key']] = t; });

  // children keyed by parent key
  const childrenOf = {};
  const addChild = (child, parentKey) => {
    if (!parentKey) return;
    if (!childrenOf[parentKey]) childrenOf[parentKey] = [];
    childrenOf[parentKey].push(child);
  };

  const PORTFOLIO_TYPES = ['Feature', 'Initiative', 'X-FEAT', 'Capability'];
  const feats = tickets.filter(t => PORTFOLIO_TYPES.includes(t['Issue Type']));
  const epics = tickets.filter(t => t['Issue Type'] === 'Epic');
  const workItems = tickets.filter(t =>
    !PORTFOLIO_TYPES.includes(t['Issue Type']) && t['Issue Type'] !== 'Epic');

  // epics parented to feats via Portfolio Parent Key
  epics.forEach(e => { addChild(e, e['Portfolio Parent Key']); });
  // work items parented to epics
  workItems.forEach(w => {
    const parentKey = w['Epic Link Key'] || w['Parent Key'];
    addChild(w, parentKey);
  });

  function collectDesc(key, visited = new Set()) {
    if (visited.has(key)) return [];
    visited.add(key);
    const direct = childrenOf[key] || [];
    return [...direct, ...direct.flatMap(c => collectDesc(c['Issue Key'], visited))];
  }

  function computeBreakdown(descendants) {
    const counts = {};
    CR_WORK_TYPES.forEach(wt => { counts[wt] = { outstanding: 0, done: 0, p0: 0, p1: 0 }; });
    counts.Bug.assignees = {};
    descendants.forEach(d => {
      const wt = crClassifyType(d['Issue Type']);
      if (crIsDone(d)) {
        counts[wt].done++;
      } else {
        counts[wt].outstanding++;
        if (d['Priority'] === 'Blocker - P0') counts[wt].p0++;
        else if (d['Priority'] === 'Critical - P1') counts[wt].p1++;
        if (wt === 'Bug') {
          const name = d['Assignee'] || 'Unassigned';
          counts.Bug.assignees[name] = (counts.Bug.assignees[name] || 0) + 1;
        }
      }
    });
    const topBugAssignees = Object.entries(counts.Bug.assignees || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([name, count]) => ({ name, count }));
    return { counts, topBugAssignees };
  }

  function totalOpen(breakdown) {
    return CR_WORK_TYPES.reduce((s, wt) => s + (breakdown.counts[wt]?.outstanding || 0), 0);
  }

  function mapRow(t, desc, rowType) {
    const fv = t['Release Name'] || 'Unknown';
    const breakdown = computeBreakdown(desc);
    const p0Bugs = breakdown.counts.Bug?.p0 || 0;
    const p1Bugs = breakdown.counts.Bug?.p1 || 0;
    const p0Total = CR_WORK_TYPES.reduce((s, wt) => s + breakdown.counts[wt].p0, 0);
    let health = 'green';
    if (p0Bugs > 3 || p0Total > 5) health = 'red';
    else if (p0Bugs > 0 || p1Bugs > 5) health = 'yellow';
    return {
      key: t['Issue Key'],
      summary: t['Summary'] || '',
      issuetype: t['Issue Type'] || '',
      status: t['Status'] || '',
      statusCategory: (t['Status Category'] || '').toLowerCase(),
      fixVersion: fv,
      fixVersions: fv,
      health,
      rowType,
      mismatch: false,
      affectedVersionAnomaly: false,
      breakdown,
      openChildCount: totalOpen(breakdown),
    };
  }

  // ── Active rows (feats + standalone epics + direct work items without parent) ──
  const featKeys = new Set(feats.map(f => f['Issue Key']));
  const epicKeys = new Set(epics.map(e => e['Issue Key']));
  const standaloneEpics = epics.filter(e => !e['Portfolio Parent Key'] || !featKeys.has(e['Portfolio Parent Key']));
  const directItems = workItems.filter(w => {
    const parentKey = w['Epic Link Key'] || w['Parent Key'];
    return !parentKey || (!epicKeys.has(parentKey) && !featKeys.has(parentKey));
  }).filter(w => !crIsDone(w));

  const activeRows = [
    ...feats.filter(f => !crIsDone(f)).map(f => mapRow(f, collectDesc(f['Issue Key']), 'feature')),
    ...standaloneEpics.filter(e => !crIsDone(e)).map(e => mapRow(e, collectDesc(e['Issue Key']), 'epic')),
    ...directItems.map(d => {
      const fv = d['Release Name'] || 'Unknown';
      const isRelevantFV = /^NDB-\d/.test(fv) || fv.toLowerCase() === 'master';
      if (!isRelevantFV) return null;
      const wt = crClassifyType(d['Issue Type']);
      const counts = {};
      CR_WORK_TYPES.forEach(cwt => { counts[cwt] = { outstanding: 0, done: 0, p0: 0, p1: 0 }; });
      counts.Bug.assignees = {};
      counts[wt].outstanding++;
      if (d['Priority'] === 'Blocker - P0') counts[wt].p0++;
      else if (d['Priority'] === 'Critical - P1') counts[wt].p1++;
      if (wt === 'Bug') counts.Bug.assignees[d['Assignee'] || 'Unassigned'] = 1;
      const topBugAssignees = wt === 'Bug' ? [{ name: d['Assignee'] || 'Unassigned', count: 1 }] : [];
      return {
        key: d['Issue Key'], summary: d['Summary'] || '', issuetype: d['Issue Type'] || '',
        status: d['Status'] || '', statusCategory: (d['Status Category'] || '').toLowerCase(),
        fixVersion: fv, fixVersions: fv, health: counts[wt]?.p0 > 0 ? 'red' : 'green',
        rowType: 'direct', mismatch: false, affectedVersionAnomaly: false,
        breakdown: { counts, topBugAssignees }, openChildCount: 1,
      };
    }).filter(Boolean),
  ];

  // ── Stale rows (done feats/epics with open children) ─────────────────────
  const staleProjects = [
    ...feats.filter(f => crIsDone(f)),
    ...standaloneEpics.filter(e => crIsDone(e)),
  ].map(t => {
    const desc = collectDesc(t['Issue Key']);
    return mapRow(t, desc, t['Issue Type'] === 'Epic' ? 'epic' : 'feature');
  }).filter(r => r.openChildCount > 0);

  // ── Group active rows by fixVersion ──────────────────────────────────────
  const byRelease = {};
  activeRows.forEach(row => {
    const fv = row.fixVersion;
    if (!byRelease[fv]) byRelease[fv] = { features: [], epics: [], directTickets: [] };
    if (row.rowType === 'feature') byRelease[fv].features.push(row);
    else if (row.rowType === 'epic') byRelease[fv].epics.push(row);
    else byRelease[fv].directTickets.push(row);
  });
  const releaseOrder = Object.keys(byRelease).sort(sortFV);

  return { outstanding, projectBreakdown: { byRelease, releaseOrder }, staleProjects, availableReleases };
}

// ─────────────────────────────────────────────────────────────────────────────
// Past Sprint Report derivation
// ─────────────────────────────────────────────────────────────────────────────

// Sprint calendar constants (from sprint-system.mdc)
const SPRINT_S1_START_MS = new Date('2024-10-09').getTime(); // Wednesday
const SPRINT_DURATION_MS = 21 * 24 * 60 * 60 * 1000; // 3 weeks

function sprintNumberToDateRange(sprintNumber) {
  const n = Number(sprintNumber);
  if (!n || n < 1) return null;
  const startMs = SPRINT_S1_START_MS + (n - 1) * SPRINT_DURATION_MS;
  const endMs = startMs + SPRINT_DURATION_MS;
  return {
    id: n,
    name: `S${n}`,
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date(endMs).toISOString().slice(0, 10),
  };
}

/**
 * Return { success, sprints, reports, aggregatedIssues, jiraBaseUrl }
 * from bundle — same shape as /api/jira/sprint-report-by-range.
 * Returns null if bundle is empty or no tickets match the range.
 */
export function derivePastSprintReportFromBundle(bundle, startDate, endDate, componentNames) {
  if (!bundle || !bundle.tickets || !startDate || !endDate) return null;

  const rangeStart = new Date(startDate).getTime();
  const rangeEnd = new Date(endDate + 'T23:59:59').getTime();
  if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) return null;

  const compFilter = Array.isArray(componentNames) && componentNames.length > 0
    ? new Set(componentNames) : null;

  const PORTFOLIO_TYPES = new Set(['Feature', 'Initiative', 'X-FEAT', 'Capability', 'Epic']);

  const inRange = bundle.tickets.filter(t => {
    // Skip portfolio-hierarchy items — they are not work items for sprint reports
    if (PORTFOLIO_TYPES.has(t['Issue Type'])) return false;
    const resolvedMs = t['Resolved Date'] ? new Date(t['Resolved Date']).getTime() : null;
    if (!resolvedMs || resolvedMs < rangeStart || resolvedMs > rangeEnd) return false;
    if (compFilter) {
      const comps = (t['JIRA Components'] || '').split(',').map(s => s.trim());
      if (!comps.some(c => compFilter.has(c))) return false;
    }
    return true;
  });

  if (inRange.length === 0) return null;

  // Group by Sprint Number
  const bySprintNum = {};
  inRange.forEach(t => {
    const sn = t['Sprint Number'] || 0;
    if (!bySprintNum[sn]) bySprintNum[sn] = [];
    bySprintNum[sn].push(t);
  });

  const sprintNumbers = Object.keys(bySprintNum).map(Number).sort((a, b) => a - b);

  const sprints = sprintNumbers.map(n => {
    const range = sprintNumberToDateRange(n);
    return range || { id: n, name: `S${n}`, startDate: '', endDate: '' };
  });

  const reports = sprintNumbers.map(n => {
    const sprintTickets = bySprintNum[n];
    const total = sprintTickets.length;
    const done = sprintTickets.filter(t => crIsDone(t)).length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 100;
    return {
      sprint: sprints.find(s => s.id === n) || { name: `S${n}` },
      metrics: {
        total,
        completed: done,
        completionRate,
        addedAfterStart: 0,
        removedFromSprint: 0,
      },
    };
  });

  const aggregatedIssues = inRange.map(t => ({
    key: t['Issue Key'],
    summary: t['Summary'] || '',
    issuetype: t['Issue Type'] || '',
    priority: t['Priority'] || '',
    assignee: t['Assignee'] || 'Unassigned',
    status: t['Status'] || '',
    resolution: t['Resolution'] || '',
    storyPoints: typeof t['Story Points'] === 'number' ? t['Story Points'] : null,
    classification: t['Is QA Verification'] ? 'pendingQA' : crIsDone(t) ? 'completedInSprint' : 'inProgress',
  }));

  return { success: true, sprints, reports, aggregatedIssues, jiraBaseUrl: 'https://jira.nutanix.com' };
}
