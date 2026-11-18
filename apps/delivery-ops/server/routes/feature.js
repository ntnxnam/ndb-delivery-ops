const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware, extractToken } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');
const { getFieldId, getFieldValue } = require('../utils/jiraFieldsConfig');
const { loadKpiConfigSync, getKpisForTeam } = require('../utils/teamConfig');

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
    'summary', 'issuetype', 'status', 'resolution', 'assignee', 'priority',
    'created', 'updated', 'resolutiondate', 'duedate',
    'labels',                        // bug-by-phase analytics
    'fixVersions',                  // soft hygiene vs selected release
    getFieldIdFn('parentLink'),      // Parent Link (customfield_20363) — Epic → FEAT/Initiative
    getFieldIdFn('epicLink'),        // Epic Link (customfield_10361) — Task/Bug/Test → Epic
    getFieldIdFn('qaContact'),       // QA Contact — Status Sender epic table
    'issuelinks',
    getFieldIdFn('riskIndicator'),
    getFieldIdFn('riskAssessment'),
    getFieldIdFn('pathToGreen'),
    getFieldIdFn('cgChecklistLink'),
    getFieldIdFn('pgChecklistLink'),
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

/** Extract JIRA issue-link key from string or { key } object. */
function linkKey(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'object' && typeof value.key === 'string' && value.key.trim()) {
    return value.key.trim();
  }
  return null;
}

/** Display name from a JIRA user field (assignee / QA Contact). */
function userDisplayName(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  return value.displayName || value.name || null;
}

function extractFixVersionNames(fields) {
  const raw = fields?.fixVersions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter((n) => typeof n === 'string' && n);
}

const COMPANION_PROJECT_PREFIXES = new Set(['TECHPUBS', 'SDL', 'LEG', 'SR', 'NDBQUAL']);

function isCompanionKey(key) {
  const prefix = String(key || '').split('-')[0].toUpperCase();
  return COMPANION_PROJECT_PREFIXES.has(prefix);
}

function isDoneStatus(status) {
  return ['done', 'resolved', 'closed', 'complete', 'fixed'].includes(
    String(status || '').toLowerCase()
  );
}

/**
 * For each work-item key, fetch changelog once and return:
 *   - firstInProgressIso — real-start signal
 *   - closedIso — last status → Closed (QA verification for Bug/Improvement)
 * Concurrency capped to avoid JIRA 429s.
 */
async function collectChangelogSignals(jira, keys, statusCategoryByName, sharedHelpers) {
  const { extractFirstInProgressIso, extractClosedDate } = sharedHelpers;
  const concurrency = Math.min(3, Math.max(1, keys.length));
  const results = new Array(keys.length);
  let nextIdx = 0;

  async function worker() {
    for (;;) {
      const i = nextIdx++;
      if (i >= keys.length) return;
      const key = keys[i];
      try {
        const issue = await jira.getIssue(key, {
          fields: ['status'],
          expand: 'changelog',
        });
        const closedRaw = extractClosedDate(issue);
        results[i] = {
          key,
          firstInProgressIso: extractFirstInProgressIso(issue, statusCategoryByName),
          closedIso: typeof closedRaw === 'string' && closedRaw ? closedRaw.slice(0, 10) : null,
        };
      } catch (_e) {
        results[i] = { key, firstInProgressIso: null, closedIso: null };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function issueFromJira(issue) {
  const fields = issue?.fields || {};
  const qaField = getFieldId('qaContact') || 'customfield_10860';
  const parentLinkField = getFieldId('parentLink') || 'customfield_20363';
  const epicLinkField = getFieldId('epicLink') || 'customfield_10361';
  const managerField = getFieldId('assigneeManager') || 'customfield_19262';
  return {
    key: issue.key,
    summary: String(fields.summary || ''),
    issueType: (fields.issuetype?.name || '').trim(),
    status: (fields.status?.name || '').trim(),
    resolution: fields.resolution?.name || null,
    assignee: userDisplayName(fields.assignee),
    assigneeEmail: fields.assignee?.emailAddress || null,
    assigneeManager: userDisplayName(fields[managerField]),
    assigneeManagerEmail: fields[managerField]?.emailAddress || null,
    qaContact: userDisplayName(fields[qaField]),
    created: typeof fields.created === 'string' ? fields.created.slice(0, 10) : null,
    resolved: typeof fields.resolutiondate === 'string' ? fields.resolutiondate.slice(0, 10) : null,
    updated: typeof fields.updated === 'string' ? fields.updated.slice(0, 10) : null,
    duedate: typeof fields.duedate === 'string' ? fields.duedate.slice(0, 10) : null,
    priority: fields.priority?.name || null,
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    fixVersions: extractFixVersionNames(fields),
    // Epic Link (Task/Bug/Test → their Epic) vs Parent Link (Epic → FEAT/Initiative).
    epicLink: linkKey(fields[epicLinkField]),
    parentLink: linkKey(fields[parentLinkField]),
  };
}

function asIsoDay(value) {
  return typeof value === 'string' && value ? value.slice(0, 10) : null;
}

function asTextOrLink(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.value || value.url || value.name || null;
  return String(value);
}

function asRisk(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.value || value.name || null;
  return null;
}

function toFeatureListItem(issue) {
  const mapped = issueFromJira(issue);
  const fields = issue?.fields || {};
  return {
    key: mapped.key,
    summary: mapped.summary,
    issueType: mapped.issueType,
    status: mapped.status,
    assignee: mapped.assignee,
    ccDate: asIsoDay(getFieldValue(fields, 'codeComplete')),
    cgDate: asIsoDay(getFieldValue(fields, 'commitGate')),
    pgDate: asIsoDay(getFieldValue(fields, 'promotionGate')),
    risk: asRisk(getFieldValue(fields, 'riskIndicator')),
  };
}

function pickReleaseGates(release, parseReleaseGateTimeline) {
  const gateConfig = loadReleaseGateConfig();
  const timeline = parseReleaseGateTimeline(release, {
    versionConfig: gateConfig[release] || null,
  });
  const lastOf = (kind) => {
    const ofKind = timeline.gates.filter((g) => g.kind === kind);
    const solid = ofKind.filter((g) => g.style === 'solid');
    const pool = solid.length ? solid : ofKind;
    return pool.length ? pool[pool.length - 1].iso : null;
  };
  return {
    ec: lastOf('EC'),
    cc: lastOf('CCM'),
    cg: lastOf('CG'),
    pg: lastOf('PG'),
    ga: lastOf('GA'),
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
    const { JiraConnector, loadEnv, parseReleaseGateTimeline } = shared;
    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const jql = buildFeatureListJql(release);
    const fields = [
      'summary',
      'issuetype',
      'status',
      'assignee',
      getFieldId('codeComplete'),
      getFieldId('commitGate'),
      getFieldId('promotionGate'),
      getFieldId('riskIndicator'),
    ]
      .filter(Boolean)
      .join(',');
    const issues = await jira.searchAll(jql, fields, {
      pageSize: 200,
      perPageDelayMs: 100,
    });
    const features = issues.map(toFeatureListItem);
    const gates = pickReleaseGates(release, parseReleaseGateTimeline);

    return res.json({ success: true, data: { release, jql, features, gates } });
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
      buildStatusCategoryByName,
      extractFirstInProgressIso,
      computeFeatureTiming,
      computeFixVersionHygiene,
      buildEnrichedFlowSeries,
      findKickoffEpic,
      evaluateKickoff,
      inferFeatureConfidence,
      extractClosedDate,
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

    const [canonicalRaw, featIdRaw, featNumberRaw, featureRoot, statusList] = await Promise.all([
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
          getFieldId('riskAssessment'),
          getFieldId('pathToGreen'),
          getFieldId('cgChecklistLink'),
          getFieldId('pgChecklistLink'),
          getFieldId('statusUpdate'),
          getFieldId('statusUpdateDate'),
          getFieldId('codeComplete'),
          getFieldId('commitGate'),
          getFieldId('promotionGate'),
        ].filter(Boolean),
      }),
      jira.get('/rest/api/2/status').then((r) => r.data).catch(() => []),
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

    const plannedStart = ecGate?.iso || null;
    const statusCategoryByName = buildStatusCategoryByName(
      Array.isArray(statusList) ? statusList : []
    );
    // One changelog pass: real start (In Progress) + QA closed date (→ Closed).
    const changelogSignals = await collectChangelogSignals(
      jira,
      workItems.map((i) => i.key),
      statusCategoryByName,
      { extractFirstInProgressIso, extractClosedDate }
    );
    const closedByKey = new Map(
      changelogSignals.map((s) => [s.key, s.closedIso || null])
    );
    const workItemsWithClosed = workItems.map((i) => ({
      ...i,
      closed: closedByKey.get(i.key) || null,
    }));

    // Legacy daily series kept for back-compat; enriched series powers Spec C/E toggles.
    // Verified line uses changelog → Closed (QA), not resolutiondate (dev).
    const flow = buildFlowSeries(workItemsWithClosed, startIso, endIso);
    const flowDaily = buildEnrichedFlowSeries(workItemsWithClosed, startIso, endIso);
    const allKpis = buildFeatureKpis(workItemsWithClosed, workItemsJql);
    const kpis = allKpis.filter((k) => k.count > 0);

    const timing = computeFeatureTiming(plannedStart, changelogSignals);
    const hygiene = computeFixVersionHygiene(workItemsWithClosed, release, workItemsJql);

    // Spec B — kick-off epic (children = Epic Link to that epic)
    const kickoffEpic = findKickoffEpic(canonicalIssues);
    const kickoffChildren = workItemsWithClosed.filter(
      (i) => kickoffEpic && i.epicLink === kickoffEpic.key
    );
    const kickoff = evaluateKickoff({
      epic: kickoffEpic,
      children: kickoffChildren,
      ecDate: ecGate?.iso || null,
      featureKey,
    });
    if (kickoffEpic && kickoffChildren.length === 0) {
      kickoff.message = `Kick-off epic ${kickoffEpic.key} found but no children linked via Epic Link.`;
      if (!isDoneStatus(kickoffEpic.status) && kickoff.pastEc) {
        kickoff.status = 'incomplete';
        kickoff.message += ` Past EC ${kickoff.ecDate}.`;
      } else if (isDoneStatus(kickoffEpic.status)) {
        kickoff.status = 'hygiene';
        kickoff.message = `Kick-off epic ${kickoffEpic.key} is ${kickoffEpic.status} but has no Epic Link children to verify.`;
      }
    }

    // Spec D — team KPI open counts scoped to this feature (count-only JIRA calls).
    // Full list from getKpisForTeam (kpiConfig.json) — never slice or hard-code names.
    const kpiTeamId = String(req.query.teamId || 'ndb').trim() || 'ndb';
    const kpiTeams = loadKpiConfigSync();
    const { kpis: teamKpiDefs } = getKpisForTeam(kpiTeams, kpiTeamId);
    const keyClause =
      workItemsWithClosed.length > 0 && workItemsWithClosed.length <= 80
        ? `key in (${workItemsWithClosed.map((i) => i.key).join(',')})`
        : workItemsJql;
    const teamKpiBoxes = [];
    if (Array.isArray(teamKpiDefs) && teamKpiDefs.length > 0) {
      const boxes = await Promise.all(
        teamKpiDefs.map(async (kpi) => {
          const base = String(kpi.baseQuery || '').trim();
          if (!base) return null;
          const openJql = `(${base}) AND (${keyClause}) AND statusCategory != Done`;
          try {
            const count = await jira.searchCount(openJql);
            return { id: kpi.id, name: kpi.name, count, jql: openJql, order: kpi.order ?? 0 };
          } catch (_e) {
            return { id: kpi.id, name: kpi.name, count: null, jql: openJql, order: kpi.order ?? 0, error: true };
          }
        })
      );
      // Preserve getKpisForTeam order (already sorted by config `order`).
      teamKpiBoxes.push(...boxes.filter(Boolean));
    }

    // Spec F — deterministic inference (coding by PG, companion/spoke by GA)
    const inferenceItems = [
      ...workItemsWithClosed,
      ...canonicalIssues.filter(
        (i) =>
          isCompanionKey(i.key) &&
          !workItemsWithClosed.some((w) => w.key === i.key)
      ),
    ];
    const inference = inferFeatureConfidence({
      timing,
      kickoff,
      workItems: inferenceItems,
      gates: {
        ec: ecGate?.iso || null,
        pg: pgGate?.iso || null,
        ga: gaGate?.iso || null,
      },
      hygieneWrongFixVersionCount: hygiene.wrongFixVersionCount,
      hygieneJql: hygiene.jql || '',
      workItemsScopeJql: workItemsJql || '',
    });

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
          riskAssessment: asTextOrLink(getFieldValue(rootFields, 'riskAssessment')),
          pathToGreen: asTextOrLink(getFieldValue(rootFields, 'pathToGreen')),
          cgChecklistLink: asTextOrLink(getFieldValue(rootFields, 'cgChecklistLink')),
          pgChecklistLink: asTextOrLink(getFieldValue(rootFields, 'pgChecklistLink')),
          statusUpdateDate: statusUpdateDate || null,
        },
        timing,
        hygiene: {
          wrongFixVersionCount: hygiene.wrongFixVersionCount,
          jql: hygiene.jql,
        },
        kickoff,
        inference,
        teamKpiBoxes,
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
          daily: flowDaily,
          markers: {
            ec: ecGate?.iso || null,
            ccm: ccmGate?.iso || null,
            ccmException: ccmExceptionGate?.iso || null,
            cg: cgGate?.iso || null,
            pg: pgGate?.iso || null,
            ga: gaGate?.iso || null,
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
