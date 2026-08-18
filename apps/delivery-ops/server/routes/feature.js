const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware, extractToken } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');
const { getFieldId, getFieldValue } = require('../utils/jiraFieldsConfig');

const PRODUCT_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'teamBoardConfig.json');
const RELEASE_GATE_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'releaseVersionsEmailConfig.json'
);
const REPARENT_AUDIT_PATH = path.resolve(
  __dirname,
  '..',
  'audit',
  'parent-link-changes.log'
);

const auth = [apiLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions')];

let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

function buildFeatureListJql(release) {
  return `fixVersion = "${release}" AND issuetype in (Feature, Initiative) AND status not in (Cancelled, Backlog) ORDER BY summary ASC`;
}

function buildCanonicalPayloadJql(featureKey) {
  return `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf(\\"issue = ${featureKey}\\")") OR issueFunction in portfolioChildrenOf("issue = ${featureKey}") OR issue = ${featureKey}`;
}

function buildFeatIdMentionJql(featureKey) {
  return `cf[40468] ~ "${featureKey}"`;
}

function buildFeatNumberMentionJql(featureKey) {
  return `cf[14262] = "${featureKey}"`;
}

// All JIRA fields fetched for feature dashboard issues.
// Add new fields here — one place, not buried in the route handler.
function buildDashboardFields(getFieldIdFn) {
  return [
    'summary', 'issuetype', 'status', 'assignee', 'priority',
    'created', 'updated', 'resolutiondate',
    'labels',                        // bug-by-phase analytics
    getFieldIdFn('parentLink'),      // Parent Link (customfield_20363) — Epic → FEAT/Initiative
    getFieldIdFn('epicLink'),        // Epic Link (customfield_10361) — Task/Bug/Test → Epic
    'issuelinks',
    getFieldIdFn('riskIndicator'),
    getFieldIdFn('statusUpdate'),
    getFieldIdFn('statusUpdateDate'),
    getFieldIdFn('commitGate'),
    getFieldIdFn('promotionGate'),
    getFieldIdFn('codeComplete'),
    'customfield_40468', // Feat ID
    'customfield_14262', // FEAT Number
    getFieldIdFn('assigneeManager'), // Assignee Manager (customfield_19262)
  ].filter(Boolean).join(',');
}

function issueFromJira(issue) {
  const fields = issue?.fields || {};
  return {
    key: issue.key,
    summary: String(fields.summary || ''),
    issueType: (fields.issuetype?.name || '').trim(),
    status: (fields.status?.name || '').trim(),
    assignee: fields.assignee?.displayName || null,
    assigneeEmail: fields.assignee?.emailAddress || null,
    assigneeManager: fields.customfield_19262?.displayName || null,
    assigneeManagerEmail: fields.customfield_19262?.emailAddress || null,
    created: typeof fields.created === 'string' ? fields.created.slice(0, 10) : null,
    resolved: typeof fields.resolutiondate === 'string' ? fields.resolutiondate.slice(0, 10) : null,
    updated: typeof fields.updated === 'string' ? fields.updated.slice(0, 10) : null,
    priority: fields.priority?.name || null,
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    // customfield_10361 = Epic Link (Task/Bug/Test → their Epic).
    // customfield_20363 = Parent Link (Epic → FEAT/Initiative) — a different field.
    epicLink: typeof fields.customfield_10361 === 'string' ? fields.customfield_10361 :
              (fields.customfield_10361 != null && typeof fields.customfield_10361?.key === 'string'
                ? fields.customfield_10361.key : null),
  };
}

function toFeatureListItem(issue) {
  return {
    key: issue.key,
    summary: issue.summary,
    issueType: issue.issueType,
    status: issue.status,
    assignee: issue.assignee,
  };
}

/**
 * 3-tier actual gate date resolution:
 *   1. Last resolved date among canonical issues matching types (+ optional priority filter)
 *   2. Custom field value from the feature/initiative ticket
 *   3. 'not-provided' sentinel (client renders as "not provided", no delta)
 *
 * @param {object[]} issues - canonicalIssues (already mapped via issueFromJira)
 * @param {string[]} types  - issue types to include (lowercase)
 * @param {string|null} customFieldValue - raw value from the feature ticket custom field
 * @param {string[]|null} priorities - if set, only include issues with these priorities (lowercase)
 */
function resolveActualGateDate(issues, types, customFieldValue, priorities = null) {
  const typeSet = new Set(types.map((t) => t.toLowerCase()));
  const priSet = priorities ? new Set(priorities.map((p) => p.toLowerCase())) : null;

  const relevant = issues.filter((i) => {
    if (!typeSet.has(i.issueType.toLowerCase())) return false;
    if (priSet && !priSet.has((i.priority || '').toLowerCase())) return false;
    return true;
  });

  // If any relevant issue is still open, the gate has not been met — return null.
  const hasOpenItems = relevant.some((i) => !i.resolved);
  if (hasOpenItems) return null;

  // All relevant issues are resolved: the gate date is the latest closure date.
  const dates = relevant.map((i) => i.resolved).filter(Boolean).sort();
  if (dates.length > 0) return dates[dates.length - 1];

  // No relevant issues exist; fall back to the JIRA custom field value.
  if (typeof customFieldValue === 'string' && customFieldValue) return customFieldValue.slice(0, 10);
  return 'not-provided';
}

function diffByKey(source, minus) {
  const minusSet = new Set((minus || []).map((i) => i.key));
  return (source || []).filter((i) => !minusSet.has(i.key));
}

function buildFlowSeries(issues, startIso, endIso) {
  const rows = [];
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
    const day = cursor.toISOString().slice(0, 10);
    const created = issues.filter((i) => i.created === day).length;
    const resolved = issues.filter((i) => i.resolved === day).length;
    const open = issues.filter((i) => (i.created || '') <= day && (!i.resolved || i.resolved > day)).length;
    rows.push({ day, created, resolved, open });
  }
  return rows;
}

function buildFeatureKpis(issues, canonicalJql) {
  const done = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);
  const withScope = (extra) => `(${canonicalJql}) AND (${extra})`;
  const bugsOpen = issues.filter(
    (i) => i.issueType.toLowerCase() === 'bug' && !done.has(i.status.toLowerCase())
  ).length;
  const unassigned = issues.filter((i) => !i.assignee && !done.has(i.status.toLowerCase())).length;
  const qaBacklog = issues.filter(
    (i) => i.issueType.toLowerCase() === 'bug' && i.status.toLowerCase() === 'resolved'
  ).length;
  const stalled = issues.filter((i) => {
    if (!i.updated) return false;
    const deltaDays = Math.floor((Date.now() - new Date(`${i.updated}T00:00:00.000Z`).getTime()) / 86400000);
    return deltaDays > 14 && !done.has(i.status.toLowerCase());
  }).length;
  const p1p0 = issues.filter((i) => ['p0', 'p1'].includes((i.priority || '').toLowerCase())).length;

  return [
    {
      key: 'bugs_open',
      label: 'Open Bugs',
      count: bugsOpen,
      jql: withScope('issuetype = Bug AND status not in (Done, Closed, Resolved)'),
      severity: bugsOpen > 20 ? 'red' : bugsOpen > 0 ? 'amber' : 'green',
    },
    {
      key: 'unassigned',
      label: 'Unassigned',
      count: unassigned,
      jql: withScope('assignee is EMPTY'),
      severity: unassigned > 0 ? 'amber' : 'green',
    },
    {
      key: 'qa_verification_backlog',
      label: 'QA Verification Backlog',
      count: qaBacklog,
      jql: withScope('issuetype = Bug AND status = Resolved'),
      severity: qaBacklog > 0 ? 'amber' : 'green',
    },
    {
      key: 'stalled_14d',
      label: 'Stalled >14d',
      count: stalled,
      jql: withScope('status not in (Done, Closed, Resolved) AND updated <= -14d'),
      severity: stalled > 0 ? 'red' : 'green',
    },
    {
      key: 'high_priority',
      label: 'P0/P1 Tickets',
      count: p1p0,
      jql: withScope('priority in (P0, P1)'),
      severity: p1p0 > 0 ? 'red' : 'green',
    },
  ];
}

function parseStatusUpdate20(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const heads = [
    '1. Requirements', '2. UX', '3. Tech Design', '4. Milestones / Project Plan',
    '5. Test Plan', '6. Reach out to DBE', '7. Coding', '7a. Dev Testing', '8. Testing',
    '8a. Manual Testing', '8b. Automation', '8c. Framework Changes', '8d. Integration Testing',
    '8e. System Testing', '8f. Longevity & Performance', '9. Telemetry', '10. FMEA',
    '11. Threat Modelling', '12. RBAC', '13. Backward Compatibility',
    '14. CPBR (Control Plane Backward/Forward Compatibility Review)', '15. APIs Auditing',
    '16. Compliance', '16a. ACP', '16b. Legal', '16c. a11y', '16d. TechPubs',
    '16e. Serviceability', '17. Security', '17a. Security Review', '17b. Pen Testing',
    '18. Bug Fixing', '19. Commit Gate Readiness', '20. Promotion Gate Readiness',
  ];
  const lines = raw.split('\n').map((l) => l.trim());
  return heads
    .map((title) => {
      const line = lines.find((l) => l.startsWith(title));
      if (!line) return null;
      return {
        id: title.split(' ')[0].toLowerCase().replace('.', ''),
        title,
        value: line.slice(title.length).replace(/^[:\-\s]+/, '').trim() || 'N/A',
      };
    })
    .filter(Boolean);
}

function loadReleaseGateConfig() {
  try {
    const raw = fs.readFileSync(RELEASE_GATE_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.releaseGateDates || {};
  } catch (_e) {
    return {};
  }
}

router.get('/list', auth, async (req, res) => {
  try {
    const release = String(req.query.release || '').trim();
    if (!release) {
      return res.status(400).json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res.status(401).json({ success: false, error: 'JIRA Bearer token required' });
    }

    const shared = await getShared();
    const { JiraConnector, loadEnv } = shared;
    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const jql = buildFeatureListJql(release);
    const issues = await jira.searchAll(jql, 'summary,issuetype,status,assignee', {
      pageSize: 200,
      perPageDelayMs: 100,
    });
    const features = issues.map(issueFromJira).map(toFeatureListItem);

    return res.json({ success: true, data: { release, jql, features } });
  } catch (e) {
    console.error('[feature] /list error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error:
        e?.response?.data?.errorMessages?.[0] ||
        (typeof e?.response?.data === 'string' ? e.response.data : null) ||
        e?.message ||
        'Failed to load features',
    });
  }
});

router.get('/dashboard', auth, async (req, res) => {
  try {
    const release = String(req.query.release || '').trim();
    const featureKey = String(req.query.featureKey || '').trim().toUpperCase();
    if (!release || !featureKey) {
      return res
        .status(400)
        .json({ success: false, error: 'release and featureKey are required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res.status(401).json({ success: false, error: 'JIRA Bearer token required' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      parseReleaseGateTimeline,
      
    } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    const product = productService.getProduct('ndb');
    const projectKey = product.projectKey;
    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const canonicalJql = buildCanonicalPayloadJql(featureKey);
    const featIdJql = buildFeatIdMentionJql(featureKey);
    const featNumberJql = buildFeatNumberMentionJql(featureKey);
    const fields = buildDashboardFields(getFieldId);

    const [canonicalRaw, featIdRaw, featNumberRaw, featureRoot] = await Promise.all([
      jira.searchAll(canonicalJql, fields, { pageSize: 500 }),
      jira.searchAll(`project = ${projectKey} AND (${featIdJql})`, fields, { pageSize: 500 }),
      jira.searchAll(`project = ${projectKey} AND (${featNumberJql})`, fields, { pageSize: 500 }),
      jira.getIssue(featureKey, {
        fields: [
          'summary',
          'issuetype',
          'status',
          'assignee',
          getFieldId('riskIndicator'),
          getFieldId('statusUpdate'),
          getFieldId('statusUpdateDate'),
          getFieldId('codeComplete'),
          getFieldId('commitGate'),
          getFieldId('promotionGate'),
        ].filter(Boolean),
      }),
    ]);

    const canonicalIssues = canonicalRaw.map(issueFromJira);
    const featIdIssues = featIdRaw.map(issueFromJira);
    const featNumberIssues = featNumberRaw.map(issueFromJira);
    const featIdOnly = diffByKey(featIdIssues, canonicalIssues);
    const featNumberOnly = diffByKey(featNumberIssues, canonicalIssues);

    const gateConfig = loadReleaseGateConfig();
    const versionConfig = gateConfig[release] || null;
    const timeline = parseReleaseGateTimeline(release, { versionConfig });
    const ecGate = timeline.gates.find((g) => g.kind === 'EC');
    const gaGate = [...timeline.gates].reverse().find((g) => g.kind === 'GA');
    const allCcmGates = timeline.gates.filter((g) => g.kind === 'CCM');
    // First CCM = original deadline; last CCM = effective deadline (may be a mgmt-approved exception).
    const ccmGate = allCcmGates[0] || null;
    const ccmExceptionGate = allCcmGates.length > 1 ? allCcmGates[allCcmGates.length - 1] : null;
    const cgGate = timeline.gates.find((g) => g.kind === 'CG');
    const pgGate = timeline.gates.find((g) => g.kind === 'PG');
    const todayIso = new Date().toISOString().slice(0, 10);
    const startIso = ecGate?.iso || canonicalIssues.map((i) => i.created).filter(Boolean).sort()[0] || todayIso;
    const endIso = gaGate?.iso || todayIso;

    // Work items only — exclude portfolio hierarchy tickets (Feature, Initiative, Epic, X-FEAT, Capability)
    // so KPI counts and Created vs Resolved chart reflect actual dev/QA work, not structural tickets.
    const PORTFOLIO_TYPES = new Set(['feature', 'initiative', 'epic', 'x-feat', 'capability']);
    const workItems = canonicalIssues.filter((i) => !PORTFOLIO_TYPES.has(i.issueType.toLowerCase()));
    const workItemsJql = `(${canonicalJql}) AND issuetype not in (Feature, Initiative, Epic, "X-FEAT", Capability)`;

    const flow = buildFlowSeries(workItems, startIso, endIso);
    const allKpis = buildFeatureKpis(workItems, workItemsJql);
    const kpis = allKpis.filter((k) => k.count > 0);

    const rootFields = featureRoot.fields || {};
    const statusUpdate = getFieldValue(rootFields, 'statusUpdate');
    const statusUpdateDate = getFieldValue(rootFields, 'statusUpdateDate');

    return res.json({
      success: true,
      data: {
        release,
        featureKey,
        jql: {
          canonical: canonicalJql,
          featId: `project = ${projectKey} AND (${featIdJql})`,
          featNumber: `project = ${projectKey} AND (${featNumberJql})`,
        },
        header: {
          key: featureKey,
          summary: String(rootFields.summary || ''),
          issueType: rootFields.issuetype?.name || '',
          status: rootFields.status?.name || '',
          assignee: rootFields.assignee?.displayName || null,
          riskIndicator: getFieldValue(rootFields, 'riskIndicator'),
          statusUpdateDate: statusUpdateDate || null,
        },
        gates: {
          ec: ecGate?.iso || null,
          // ccm = original planned CC date; ccmException = mgmt-approved extension (null if no extension).
          ccm: ccmGate?.iso || null,
          ccmException: ccmExceptionGate?.iso || null,
          ccmExceptionLabel: ccmExceptionGate?.label || null,
          cg: cgGate?.iso || null,
          pg: pgGate?.iso || null,
          ga: gaGate?.iso || null,
          events: timeline.gates,
          // Raw JIRA custom field values ("called out in JIRA")
          jiraCcm: (() => { const v = getFieldValue(rootFields, 'codeComplete');   return typeof v === 'string' && v ? v.slice(0, 10) : null; })(),
          jiraCg:  (() => { const v = getFieldValue(rootFields, 'commitGate');     return typeof v === 'string' && v ? v.slice(0, 10) : null; })(),
          jiraPg:  (() => { const v = getFieldValue(rootFields, 'promotionGate');  return typeof v === 'string' && v ? v.slice(0, 10) : null; })(),
          // Computed actual: last relevant ticket closure → JIRA field → 'not-provided'
          actualCcm: resolveActualGateDate(canonicalIssues, ['task', 'unit test'], getFieldValue(rootFields, 'codeComplete')),
          actualCg:  resolveActualGateDate(canonicalIssues, ['bug', 'improvement'], getFieldValue(rootFields, 'commitGate'), ['p0', 'p1']),
          actualPg:  resolveActualGateDate(canonicalIssues, ['test', 'bug'],        getFieldValue(rootFields, 'promotionGate')),
        },
        payload: {
          canonical: canonicalIssues,
          featIdOnly,
          featNumberOnly,
        },
        flow: {
          startIso,
          endIso,
          points: flow,
          markers: {
            ccm: ccmGate?.iso || null,
            ccmException: ccmExceptionGate?.iso || null,
            cg: cgGate?.iso || null,
            pg: pgGate?.iso || null,
          },
        },
        kpis,
        statusUpdate20: parseStatusUpdate20(typeof statusUpdate === 'string' ? statusUpdate : ''),
      },
    });
  } catch (e) {
    console.error('[feature] /dashboard error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error:
        e?.response?.data?.errorMessages?.[0] ||
        (typeof e?.response?.data === 'string' ? e.response.data : null) ||
        e?.message ||
        'Failed to load dashboard',
    });
  }
});

router.post('/reparent', auth, async (req, res) => {
  try {
    const { ticketKey, newParent, reason } = req.body || {};
    if (!ticketKey || !newParent || !reason) {
      return res
        .status(400)
        .json({ success: false, error: 'ticketKey, newParent, and reason are required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res.status(401).json({ success: false, error: 'JIRA Bearer token required' });
    }

    const shared = await getShared();
    const { JiraConnector, loadEnv } = shared;
    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const parentLinkField = getFieldId('parentLink') || 'customfield_20363';
    await jira.updateIssue(ticketKey, { [parentLinkField]: newParent });

    fs.mkdirSync(path.dirname(REPARENT_AUDIT_PATH), { recursive: true });
    const event = {
      at: new Date().toISOString(),
      actor: req.username || req.userEmail || 'unknown',
      ticketKey,
      newParent,
      reason,
    };
    fs.appendFileSync(REPARENT_AUDIT_PATH, `${JSON.stringify(event)}\n`, 'utf8');

    return res.json({ success: true, data: event });
  } catch (e) {
    const status = e?.statusCode || e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Failed to re-parent ticket',
    });
  }
});

module.exports = router;
