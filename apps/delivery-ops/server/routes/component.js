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

const router = express.Router();

const auth = [apiLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions')];

/**
 * GET /api/component/list
 * Return list of components from ERA project
 * Caches in session to avoid repeated JIRA calls
 */
router.get('/list', auth, async (req, res) => {
  try {
    const { team = 'ndb', refresh = false } = req.query;
    const jiraToken = req.jiraToken;

    if (!jiraToken) {
      return res.status(401).json({ error: 'JIRA token required' });
    }

    // Check session cache first (skip if refresh=true)
    const shouldRefresh = refresh === 'true' || refresh === true;
    if (!shouldRefresh && req.session && req.session.componentList) {
      const cacheAge = Date.now() - req.session.componentListTime;
      if (cacheAge < 3600000) { // 1 hour cache
        return res.json(req.session.componentList);
      }
    }

    // Clear stale cache if refreshing
    if (shouldRefresh && req.session) {
      delete req.session.componentList;
      delete req.session.componentListTime;
    }

    // Fetch from JIRA
    const result = await fetchComponentsFromERA(jiraToken);
    console.log('[component route] Fetched', result.count, 'components from JIRA');

    // Cache in session
    if (req.session) {
      req.session.componentList = result;
      req.session.componentListTime = Date.now();
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

const WORK_TYPES = ['Bug', 'Improvement', 'Task', 'Test', 'Other'];

function classifyIssueType(issuetype) {
  const t = (issuetype || '').toLowerCase();
  if (t === 'bug') return 'Bug';
  if (t === 'improvement') return 'Improvement';
  if (t === 'task' || t === 'unit test') return 'Task';
  if (t === 'test') return 'Test';
  return 'Other';
}

function isDone(issue) {
  return issue.status?.statusCategory?.key === 'done';
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
 * Build per-project breakdown for Widget 4.
 * Uses parent field (now fetched by STANDARD_FIELD_NAMES) for 2-hop traversal.
 */
function buildProjectBreakdown(payload) {
  // Map: parentKey → [child issues]
  const childrenOf = {};
  const addChildren = (issues) => {
    issues.forEach(issue => {
      const pk = issue.parent?.key;
      if (pk) {
        if (!childrenOf[pk]) childrenOf[pk] = [];
        childrenOf[pk].push(issue);
      }
    });
  };
  addChildren(payload.portfolioChildren);     // epics → Feature
  addChildren(payload.epicChildren);           // work items → epic
  addChildren(payload.standaloneEpicChildren); // work items → standalone epic

  function collectDescendants(key, visited = new Set()) {
    if (visited.has(key)) return [];
    visited.add(key);
    const direct = childrenOf[key] || [];
    const deeper = direct.flatMap(c => collectDescendants(c.key, visited));
    return [...direct, ...deeper];
  }

  function computeBreakdown(issues) {
    const counts = {};
    WORK_TYPES.forEach(t => {
      counts[t] = { outstanding: 0, done: 0, p0: 0, p1: 0 };
    });
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

    const topAssignees = Object.entries(counts.Bug.assignees || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, c]) => ({ name: n, count: c }));

    return { counts, topBugAssignees: topAssignees };
  }

  const mapProject = (project, descendants) => {
    const breakdown = computeBreakdown(descendants);
    const p0Bugs = breakdown.counts.Bug.p0;
    const p1Bugs = breakdown.counts.Bug.p1;
    const p0Total = WORK_TYPES.reduce((s, t) => s + breakdown.counts[t].p0, 0);
    let health = 'green';
    if (p0Bugs > 3 || p0Total > 5) health = 'red';
    else if (p0Bugs > 0 || p1Bugs > 5) health = 'yellow';

    return {
      key: project.key,
      summary: project.summary || '',
      issuetype: project.issuetype?.name || project.issuetype || '',
      status: project.status?.name || project.status || '',
      statusCategory: project.status?.statusCategory?.key || project.statusCategory || '',
      fixVersions: Array.isArray(project.fixVersions)
        ? project.fixVersions.map(v => v.name).join(', ')
        : (project.fixVersions || ''),
      assignee: project.assignee?.displayName || project.assignee || 'Unassigned',
      health,
      breakdown,
    };
  };

  const features = payload.topLevelProjects.map(feature => {
    const descendants = collectDescendants(feature.key);
    return mapProject(feature, descendants);
  });

  const epics = payload.standaloneEpics.map(epic => {
    const descendants = collectDescendants(epic.key);
    return mapProject(epic, descendants);
  });

  // Direct tickets (no epic, no project) — group as a flat list
  const directTickets = payload.directTickets.map(issue => ({
    key: issue.key,
    summary: issue.summary || '',
    issuetype: issue.issuetype?.name || issue.issuetype || '',
    status: issue.status?.name || issue.status || '',
    statusCategory: issue.status?.statusCategory?.key || issue.statusCategory || '',
    priority: issue.priority?.name || 'Unprioritised',
    priorityOrder: PRIORITY_ORDER[issue.priority?.name] ?? 5,
    fixVersions: Array.isArray(issue.fixVersions)
      ? issue.fixVersions.map(v => v.name).join(', ')
      : (issue.fixVersions || ''),
    assignee: issue.assignee?.displayName || issue.assignee || 'Unassigned',
    age: ageInDays(issue.created),
  }));

  return { features, epics, directTickets };
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
    const projectBreakdown = buildProjectBreakdown(payload);

    // Collect all unique fixVersion names across the entire payload
    const allIssuesForVersions = [
      ...payload.topLevelProjects,
      ...payload.portfolioChildren,
      ...payload.epicChildren,
      ...payload.standaloneEpics,
      ...payload.standaloneEpicChildren,
      ...payload.directTickets,
    ];
    const versionSet = new Set();
    allIssuesForVersions.forEach(issue => {
      const fvs = issue.fixVersions;
      if (Array.isArray(fvs)) {
        fvs.forEach(v => { if (v?.name) versionSet.add(v.name); });
      } else if (typeof fvs === 'string' && fvs) {
        fvs.split(',').forEach(v => { const t = v.trim(); if (t) versionSet.add(t); });
      }
    });
    // Sort: NDB-X.Y versions numerically desc, then master, then others
    const availableReleases = [...versionSet].sort((a, b) => {
      const ndbA = /^NDB-(\d+)\.(\d+)/.exec(a);
      const ndbB = /^NDB-(\d+)\.(\d+)/.exec(b);
      if (ndbA && ndbB) {
        const diff = parseInt(ndbB[1]) - parseInt(ndbA[1]) || parseInt(ndbB[2]) - parseInt(ndbA[2]);
        return diff;
      }
      if (ndbA) return -1;
      if (ndbB) return 1;
      if (a.toLowerCase() === 'master') return -1;
      if (b.toLowerCase() === 'master') return 1;
      return a.localeCompare(b);
    });

    res.json({ outstanding, projectBreakdown, availableReleases });
  } catch (err) {
    console.error('[component route] Error fetching data:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
