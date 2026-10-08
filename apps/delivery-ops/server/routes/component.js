/**
 * Component Report API Routes
 * 
 * Endpoints:
 * GET /api/component/list - list all components from ERA (cached in session)
 * GET /api/component/health - health card metrics for a component
 * GET /api/component/data - full component data (outstanding, projects, trends, cleanup)
 */

const express = require('express');
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');
const { fetchComponentsFromERA, fetchComponentPayload } = require('../services/componentReportService');
const { getTeamById, loadTeamBoardConfig } = require('../utils/teamConfig');

const router = express.Router();

const auth = [apiLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions')];

/**
 * GET /api/component/list
 * Components for the selected team's JIRA project.
 * Query: productId (or team). Omitted → default team. Cache is per project.
 */
router.get('/list', auth, async (req, res) => {
  try {
    const jiraToken = req.jiraToken;

    if (!jiraToken) {
      return res.status(401).json({ error: 'JIRA token required' });
    }

    const requestedId = String(req.query.productId || req.query.team || '').trim();
    const config = loadTeamBoardConfig();
    const teamId = requestedId || config.defaultTeamId || 'ndb';
    const team = getTeamById(teamId);
    const projectKey = team && team.projectKey ? String(team.projectKey).trim() : '';
    if (!projectKey) {
      return res.status(400).json({ error: `Unknown team '${teamId}' or missing projectKey` });
    }

    const shouldRefresh = req.query.refresh === 'true' || req.query.refresh === true;
    if (req.session && !req.session.componentListByProject) req.session.componentListByProject = {};
    const cached = req.session?.componentListByProject?.[projectKey];
    if (!shouldRefresh && cached && (Date.now() - cached.cachedAt) < 3600000) {
      return res.json(cached.result);
    }
    if (shouldRefresh && req.session?.componentListByProject) {
      delete req.session.componentListByProject[projectKey];
    }

    const result = await fetchComponentsFromERA(jiraToken, projectKey);
    console.log('[component route] Fetched', result.count, 'components for', projectKey);

    if (req.session?.componentListByProject) {
      req.session.componentListByProject[projectKey] = { result, cachedAt: Date.now() };
    }
    res.json(result);
  } catch (err) {
    console.error('[component route] Error fetching components:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/component/health
 * Return health card data for a component
 */
router.get('/health', auth, async (req, res) => {
  try {
    const { component, releaseFilter = 'current', team = 'ndb' } = req.query;
    const jiraToken = req.jiraToken;

    if (!component) {
      return res.status(400).json({ error: 'component required' });
    }

    if (!jiraToken) {
      return res.status(401).json({ error: 'JIRA token required' });
    }

    console.log('[component route] Health requested for component:', component);

    // Fetch component payload
    const payload = await fetchComponentPayload(component, jiraToken, releaseFilter);

    // Count outstanding (statusCategory != Done) and other metrics
    // Note: runSearchByJql spreads fields directly onto the issue object (no .fields wrapper)
    const allIssues = [
      ...payload.topLevelProjects,
      ...payload.portfolioChildren,
      ...payload.epicChildren,
      ...payload.standaloneEpics,
      ...payload.standaloneEpicChildren,
      ...payload.directTickets
    ];

    const outstandingIssues = allIssues.filter(issue => 
      issue.status && issue.status.statusCategory?.name !== 'Done'
    );

    const p0Issues = outstandingIssues.filter(issue =>
      issue.priority?.name === 'Blocker - P0'
    );

    const p1Issues = outstandingIssues.filter(issue =>
      issue.priority?.name === 'Critical - P1'
    );

    // Simple RAG calculation
    let status = 'green';
    let verdict = 'ON TRACK';

    if (p0Issues.length > 3 || p1Issues.length > 8) {
      status = 'red';
      verdict = 'CRITICAL';
    } else if (p0Issues.length > 0 || p1Issues.length > 5) {
      status = 'yellow';
      verdict = 'AT RISK';
    }

    res.json({
      health: {
        componentName: component,
        status,
        verdict,
        p0Count: p0Issues.length,
        p1Count: p1Issues.length,
        outstandingCount: outstandingIssues.length,
        deferralPercent: Math.floor((allIssues.length - outstandingIssues.length) / allIssues.length * 100) || 0,
        avgAge: 22, // TODO: calculate from dates
      },
      actions: p0Issues.length > 0 ? [
        {
          severity: 'critical',
          key: p0Issues[0].key,
          summary: p0Issues[0].summary,
          detail: `P0, ${p0Issues.length} total unresolved`,
          actions: ['Review', 'Escalate'],
        }
      ] : []
    });
  } catch (err) {
    console.error('[component route] Error fetching health:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function ageInDays(createdStr) {
  if (!createdStr) return 0;
  return Math.floor((Date.now() - new Date(createdStr).getTime()) / 86400000);
}

const PRIORITY_ORDER = {
  'Blocker - P0': 0,
  'Critical - P1': 1,
  'Major - P2': 2,
  'Minor - P3': 3,
  'Trivial - P4': 4,
};

// W4 work-type columns: Task covers "Task" and "Unit Test" combined
const WORK_TYPES = ['Bug', 'TaskUnit', 'Improvement', 'Test', 'Other'];

function classifyIssueType(issuetype) {
  const t = (issuetype || '').toLowerCase();
  if (t === 'bug') return 'Bug';
  if (t === 'improvement') return 'Improvement';
  if (t === 'task' || t === 'unit test') return 'TaskUnit';
  if (t === 'test') return 'Test';
  return 'Other';
}

// Extract primary fixVersion name from an issue (first NDB-* or master, else first)
function primaryFixVersion(issue) {
  const fvs = Array.isArray(issue.fixVersions)
    ? issue.fixVersions.map(v => v.name)
    : (issue.fixVersions ? String(issue.fixVersions).split(',').map(s => s.trim()) : []);
  const preferred = fvs.find(v => /^NDB-\d/.test(v) || v.toLowerCase() === 'master');
  return preferred || fvs[0] || 'Unknown';
}

// Check if any descendant has a fixVersion that differs from the parent's primary fixVersion
function hasMismatch(parentFV, descendants) {
  if (!parentFV || parentFV === 'Unknown') return false;
  return descendants.some(d => {
    const dfvs = Array.isArray(d.fixVersions)
      ? d.fixVersions.map(v => v.name)
      : (d.fixVersions ? String(d.fixVersions).split(',').map(s => s.trim()) : []);
    return dfvs.length > 0 && !dfvs.includes(parentFV);
  });
}

// Check if affectedVersion contains ERA Future or Triage
function hasAffectedVersionAnomaly(issue) {
  const avs = Array.isArray(issue.versions)
    ? issue.versions.map(v => (v.name || '').toLowerCase())
    : [];
  return avs.some(v => v.includes('era future') || v === 'triage');
}

function isDone(issue) {
  return issue.status?.statusCategory?.key === 'done';
}

// A project/epic is "active" if it is not in a terminal done state
function isActiveRow(issue) {
  return !isDone(issue);
}

// A project/epic is "stale" if it IS done but has outstanding (non-done) descendants
function isStaleWithOpenWork(issue, descendants) {
  if (!isDone(issue)) return false;
  return descendants.some(d => !isDone(d));
}

function normaliseIssue(issue) {
  const priorityName = issue.priority?.name || 'Unprioritised';
  return {
    key: issue.key,
    summary: issue.summary || '',
    assignee: issue.assignee?.displayName || 'Unassigned',
    status: issue.status?.name || '',
    statusCategory: issue.status?.statusCategory?.key || '',
    priority: priorityName,
    priorityOrder: PRIORITY_ORDER[priorityName] ?? 5,
    fixVersions: Array.isArray(issue.fixVersions)
      ? issue.fixVersions.map(v => v.name).join(', ')
      : (issue.fixVersions || ''),
    issuetype: issue.issuetype?.name || '',
    age: ageInDays(issue.created),
    created: issue.created,
    parentKey: issue.parent?.key || null,
  };
}

/**
 * Flatten all payload issues into a normalised outstanding list (non-done only).
 * Note: runSearchByJql spreads JIRA fields directly onto the issue object.
 */
function buildOutstandingList(payload) {
  const allIssues = [
    ...payload.topLevelProjects,
    ...payload.portfolioChildren,
    ...payload.epicChildren,
    ...payload.standaloneEpics,
    ...payload.standaloneEpicChildren,
    ...payload.directTickets,
  ];

  const seen = new Set();
  return allIssues
    .filter(issue => {
      if (seen.has(issue.key)) return false;
      seen.add(issue.key);
      return !isDone(issue);
    })
    .map(normaliseIssue)
    .sort((a, b) => {
      if (a.priorityOrder !== b.priorityOrder) return a.priorityOrder - b.priorityOrder;
      return b.age - a.age;
    });
}

/**
 * Build Widget 4 project breakdown.
 *
 * Returns:
 *   { byRelease, releaseOrder }  — active rows grouped by fixVersion (for Section A/B)
 *   staleProjects                — closed/cancelled rows that have outstanding children (for Cleanup section)
 *
 * Active = row is not in a done state (statusCategory != done)
 * Stale  = row IS done but has ≥1 outstanding descendant → orphaned open work
 *
 * directTickets: outstanding-only (JQL already filters statusCategory != Done).
 * Each direct ticket counts itself in its work-type column.
 */
function buildProjectBreakdown(payload) {
  // ── Parent→children map (all children, no status filter at this layer) ─────
  // Parent key resolution depends on JIRA hierarchy level:
  //   portfolioChildren (Epics under Features)  → customfield_20363 (Parent Link)
  //   epicChildren / standaloneEpicChildren      → customfield_10361 (Epic Link, Nutanix field ID)
  //   sub-tasks                                  → parent.key (standard field)
  const childrenOf = {};
  const addChild = (issue, parentKey) => {
    if (!parentKey) return;
    if (!childrenOf[parentKey]) childrenOf[parentKey] = [];
    childrenOf[parentKey].push(issue);
  };

  payload.portfolioChildren.forEach(issue => {
    // customfield_20363 (Parent Link) is a string "ERA-XXXX" for epics under features
    const parentLink = issue.customfield_20363;
    const pk = typeof parentLink === 'string' ? parentLink : parentLink?.key;
    addChild(issue, pk);
  });

  payload.epicChildren.forEach(issue => {
    // Epic Link is customfield_10361 in Nutanix JIRA. Fall back to parent.key
    // when the field isn't included in the fetch (e.g. lightweight payloads).
    const epicLinkRaw = issue.customfield_10361 ?? issue.fields?.customfield_10361;
    const epicLink = typeof epicLinkRaw === 'string' ? epicLinkRaw : epicLinkRaw?.key ?? null;
    addChild(issue, epicLink || issue.parent?.key || issue.fields?.parent?.key);
  });

  payload.standaloneEpicChildren.forEach(issue => {
    addChild(issue, issue.parent?.key);
  });

  function collectDescendants(key, visited = new Set()) {
    if (visited.has(key)) return [];
    visited.add(key);
    const direct = childrenOf[key] || [];
    const deeper = direct.flatMap(c => collectDescendants(c.key, visited));
    return [...direct, ...deeper];
  }

  // ── Compute work-type breakdown (outstanding + done counts) ───────────────
  function computeBreakdown(issues) {
    const counts = {};
    WORK_TYPES.forEach(t => { counts[t] = { outstanding: 0, done: 0, p0: 0, p1: 0 }; });
    counts.Bug.assignees = {};

    issues.forEach(issue => {
      const t = classifyIssueType(issue.issuetype?.name || issue.issuetype || '');
      const done = isDone(issue);
      if (done) {
        counts[t].done++;
      } else {
        counts[t].outstanding++;
        const prio = issue.priority?.name || '';
        if (prio === 'Blocker - P0') counts[t].p0++;
        else if (prio === 'Critical - P1') counts[t].p1++;
        if (t === 'Bug') {
          const name = issue.assignee?.displayName || 'Unassigned';
          counts.Bug.assignees[name] = (counts.Bug.assignees[name] || 0) + 1;
        }
      }
    });

    const topBugAssignees = Object.entries(counts.Bug.assignees || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    return { counts, topBugAssignees };
  }

  function totalOutstanding(breakdown) {
    return WORK_TYPES.reduce((s, t) => s + (breakdown.counts[t]?.outstanding || 0), 0);
  }

  // ── Map a project/epic row ─────────────────────────────────────────────────
  function mapRow(issue, descendants, rowType) {
    const fv = primaryFixVersion(issue);
    const breakdown = computeBreakdown(descendants);
    const p0Total = WORK_TYPES.reduce((s, t) => s + breakdown.counts[t].p0, 0);
    const p0Bugs = breakdown.counts.Bug?.p0 || 0;
    const p1Bugs = breakdown.counts.Bug?.p1 || 0;
    let health = 'green';
    if (p0Bugs > 3 || p0Total > 5) health = 'red';
    else if (p0Bugs > 0 || p1Bugs > 5) health = 'yellow';

    return {
      key: issue.key,
      summary: issue.summary || '',
      issuetype: issue.issuetype?.name || issue.issuetype || '',
      status: issue.status?.name || issue.status || '',
      statusCategory: issue.status?.statusCategory?.key || '',
      fixVersion: fv,
      fixVersions: Array.isArray(issue.fixVersions)
        ? issue.fixVersions.map(v => v.name).join(', ')
        : (issue.fixVersions || ''),
      health,
      rowType,
      mismatch: hasMismatch(fv, descendants),
      affectedVersionAnomaly: hasAffectedVersionAnomaly(issue),
      breakdown,
      openChildCount: totalOutstanding(breakdown),
    };
  }

  // ── Map a direct ticket (counts itself) ───────────────────────────────────
  // directTickets are already filtered to outstanding-only by JQL
  function mapDirectRow(issue) {
    const fv = primaryFixVersion(issue);
    // Only show direct tickets with a meaningful fixVersion (NDB-* or master)
    // Tickets with ancient/ambiguous versions (Era 1.0 etc.) are noise
    const isRelevantFV = /^NDB-\d/.test(fv) || fv.toLowerCase() === 'master';
    if (!isRelevantFV) return null;

    const t = classifyIssueType(issue.issuetype?.name || issue.issuetype || '');
    const prio = issue.priority?.name || '';
    const counts = {};
    WORK_TYPES.forEach(wt => { counts[wt] = { outstanding: 0, done: 0, p0: 0, p1: 0 }; });
    counts.Bug.assignees = {};
    counts[t].outstanding++;
    if (prio === 'Blocker - P0') counts[t].p0++;
    else if (prio === 'Critical - P1') counts[t].p1++;
    if (t === 'Bug') {
      const name = issue.assignee?.displayName || 'Unassigned';
      counts.Bug.assignees[name] = 1;
    }
    const topBugAssignees = t === 'Bug'
      ? [{ name: issue.assignee?.displayName || 'Unassigned', count: 1 }]
      : [];

    return {
      key: issue.key,
      summary: issue.summary || '',
      issuetype: issue.issuetype?.name || issue.issuetype || '',
      status: issue.status?.name || issue.status || '',
      statusCategory: issue.status?.statusCategory?.key || '',
      fixVersion: fv,
      fixVersions: Array.isArray(issue.fixVersions)
        ? issue.fixVersions.map(v => v.name).join(', ')
        : (issue.fixVersions || ''),
      health: counts[t]?.p0 > 0 ? 'red' : 'green',
      rowType: 'direct',
      mismatch: false,
      affectedVersionAnomaly: hasAffectedVersionAnomaly(issue),
      breakdown: { counts, topBugAssignees },
      openChildCount: 1,
    };
  }

  // ── Build active rows (features + standalone epics + outstanding direct tickets) ─
  const activeRows = [
    ...payload.topLevelProjects.map(f => mapRow(f, collectDescendants(f.key), 'feature')),
    ...payload.standaloneEpics.map(e => mapRow(e, collectDescendants(e.key), 'epic')),
    ...payload.directTickets.map(d => mapDirectRow(d)).filter(Boolean),
  ];
  

  // ── Build stale rows (closed/cancelled with open children) ────────────────
  const staleRows = [
    ...( payload.staleTopLevel || []).map(f => {
      const desc = collectDescendants(f.key);
      return mapRow(f, desc, 'feature');
    }).filter(r => r.openChildCount > 0),
    ...( payload.staleEpics || []).map(e => {
      const desc = collectDescendants(e.key);
      return mapRow(e, desc, 'epic');
    }).filter(r => r.openChildCount > 0),
  ];

  // ── Group active rows by fixVersion ───────────────────────────────────────
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

  const byRelease = {};
  activeRows.forEach(row => {
    const fv = row.fixVersion;
    if (!byRelease[fv]) byRelease[fv] = { features: [], epics: [], directTickets: [] };
    if (row.rowType === 'feature') byRelease[fv].features.push(row);
    else if (row.rowType === 'epic') byRelease[fv].epics.push(row);
    else byRelease[fv].directTickets.push(row);
  });

  const releaseOrder = Object.keys(byRelease).sort(sortFV);

  return { byRelease, releaseOrder, staleProjects: staleRows };
}

/**
 * GET /api/component/data
 * Return full component data (issues, projects, metrics)
 */
router.get('/data', auth, async (req, res) => {
  try {
    const { component, releaseFilter = 'current' } = req.query;
    const jiraToken = req.jiraToken;

    if (!component) {
      return res.status(400).json({ error: 'component required' });
    }

    if (!jiraToken) {
      return res.status(401).json({ error: 'JIRA token required' });
    }

    console.log('[component route] Data requested for component:', component);
    const payload = await fetchComponentPayload(component, jiraToken);

    const outstanding = buildOutstandingList(payload);
    const { byRelease, releaseOrder, staleProjects } = buildProjectBreakdown(payload);
    const projectBreakdown = { byRelease, releaseOrder };

    // availableReleases: only NDB-X.Y and master — no ancient ERA versions or Triage/Future
    // Source: active issues only (outstanding list) to avoid pulling in historical versions from stale items
    const activeIssues = [
      ...payload.topLevelProjects,
      ...payload.portfolioChildren,
      ...payload.epicChildren,
      ...payload.standaloneEpics,
      ...payload.standaloneEpicChildren,
      ...payload.directTickets,
    ];
    const versionSet = new Set();
    activeIssues.forEach(issue => {
      const fvs = issue.fixVersions;
      const names = Array.isArray(fvs) ? fvs.map(v => v.name) : (fvs ? String(fvs).split(',').map(s => s.trim()) : []);
      names.forEach(n => {
        if (!n) return;
        // Only include NDB-X.Y (committed releases) and master (active funded work)
        if (/^NDB-\d/.test(n) || n.toLowerCase() === 'master') {
          versionSet.add(n);
        }
      });
    });

    const availableReleases = [...versionSet].sort((a, b) => {
      const ndbA = /^NDB-(\d+)\.(\d+)/.exec(a);
      const ndbB = /^NDB-(\d+)\.(\d+)/.exec(b);
      if (ndbA && ndbB) return parseInt(ndbB[1]) - parseInt(ndbA[1]) || parseInt(ndbB[2]) - parseInt(ndbA[2]);
      if (ndbA) return -1;
      if (ndbB) return 1;
      if (a.toLowerCase() === 'master') return -1;
      if (b.toLowerCase() === 'master') return 1;
      return a.localeCompare(b);
    });

    console.log('[component route] Active releases found:', availableReleases.join(', ') || '(none)');
    console.log('[component route] Active rows:', releaseOrder.map(fv => `${fv}:${(byRelease[fv]?.features?.length||0)+(byRelease[fv]?.epics?.length||0)+(byRelease[fv]?.directTickets?.length||0)}`).join(', '));
    console.log('[component route] Stale projects with open children:', staleProjects.length);

    res.json({ outstanding, projectBreakdown, staleProjects, availableReleases });
  } catch (err) {
    console.error('[component route] Error fetching data:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
