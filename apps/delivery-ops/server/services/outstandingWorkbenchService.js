/**
 * Release Outstanding Work — post-PG buckets for a selected release.
 * Universe: ({release}-All) AND status != Closed
 * Projects rollup: (All OR fixVersion) AND statusCategory != Done (chips dynamic by project).
 */
const fs = require('fs');
const path = require('path');
const { getJira } = require('../utils/jiraClient');
const { getTeamById, loadTeamBoardConfig, normalizeTeamId } = require('../utils/teamConfig');
const { getReleaseBaseFilter } = require('../utils/jiraRouteHelpers');
const { getFieldId } = require('../utils/jiraFieldsConfig');
const { mapExtraTicketFields, withExtraTicketFields } = require('../utils/ticketRowFields');
const {
  mustFixJql,
  mustFixLabel,
  deferredLabel,
  deferredLabelVariants: centralDeferredVariants,
  mustFixLabelVariants: centralMustFixVariants,
  candidatesJql,
  awaitingDeferralJql,
  nextExistingMajor,
  nextExistingDot,
  enrichCfdCfiCategories,
  buildCfdCfiStrip,
} = require('./releaseOutstandingDeferralService');
const { sendEmailDirect } = require('./emailService');

/** Fixed CC for outstanding / must-fix mail. Override via mustFixLeadershipCC in CC config. */
const DEFAULT_LEADERSHIP_CC = [
  'ndb-tech-leads@nutanix.com',
  'ndb-managers@nutanix.com',
];

const CC_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsCCConfig.json');
const RELEASE_EMAIL_CONFIG_PATH = path.join(
  __dirname,
  '../config/releaseVersionsEmailConfig.json'
);
const SAMPLE_LIMIT = 80;
const PROJECT_PAGE_SIZE = 100;
const PROJECT_MAX_PAGES = 50; // up to 5k for project discovery
const QA_CONTACT_FIELD = getFieldId('qaContact') || getFieldId('qaContact');
const OUTSTANDING_FIELDS = withExtraTicketFields(
  [
    'summary',
    'status',
    'issuetype',
    'priority',
    'fixVersions',
    'versions',
    'labels',
    'assignee',
    QA_CONTACT_FIELD,
    'updated',
  ].join(',')
);

/** Friendly chip labels when we already know the project. */
const PROJECT_LABELS = {
  TECHPUBS: 'TechPubs / Docs',
  SDL: 'Security (SDL)',
  LEG: 'Legal',
  SR: 'Security Review',
  NDBQUAL: 'NDB Quality',
  OSS: 'OSS / Third-party',
};

/** Companion / horizontal projects — always excluded from Dev & Test-open tiles. */
const DEFAULT_COMPANION_PROJECTS = ['TECHPUBS', 'SDL', 'LEG', 'SR', 'NDBQUAL', 'OSS'];

/** Portfolio keys never shown as By-project chips (ERA home + FEAT). */
const BY_PROJECT_EXCLUDE = ['FEAT'];

const DEFAULT_REPORT_TO = 'ndb-exec-updates@nutanix.com';

/** Tile labels = what the bucket means (not jargon leftovers). */
const BUCKET_LABELS = {
  notClosed: 'Not Closed',
  toBeResolved: 'Awaiting Verification',
  dev: 'Dev open',
  devTasks: 'Task / Unit Test',
  devBugs: 'Bug / Improvement',
  devCve: 'CVE',
  devOther: 'Dev other',
  qa: 'Test open',
  disciplines: 'Companion / cross functional teams',
  mustFix: 'Must-fix',
  regressionProduct: 'Regression – Product',
  regressionTest: 'Regression – Test',
  systemTest: 'System-Test',
  hyDeferredOnRelease: 'Deferred, still on this FV',
  hyOnMaster: 'On master',
  hyDeferredWrongTarget: 'Deferred, wrong target FV',
  hyMustFixWrongFv: 'Must-fix, FV ≠ release',
};

const PORTFOLIO_TYPES = 'Feature, Initiative, Epic, X-FEAT, Capability, Test';
const DEV_GROUP_TYPES = {
  tasks: 'Task, "Unit Test"',
  bugs: 'Bug, Improvement',
  cve: 'CVE',
};
const MASTER_FIX_VERSION = 'master';

function quote(v) {
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

function releaseAllClause(release) {
  const base = getReleaseBaseFilter(release) || `filter=${String(release || '').trim()}-All`;
  return `(${base})`;
}

function companionProjectKeys(team) {
  const fromTeam = Array.isArray(team?.companionDisciplines)
    ? team.companionDisciplines.map((d) => d.projectKey || d).filter(Boolean)
    : [];
  // Union defaults with team list so OSS/TECHPUBS/… stay out of Dev even if config is partial.
  return [...new Set([...DEFAULT_COMPANION_PROJECTS, ...fromTeam])];
}

function resolveTeam(teamId) {
  const board = loadTeamBoardConfig();
  const requested = normalizeTeamId(teamId) || normalizeTeamId(board.defaultTeamId) || 'ndb';
  const team = getTeamById(requested) || getTeamById(board.defaultTeamId);
  return {
    teamId: (team && team.id) || requested,
    projectKey: team?.projectKey || 'ERA',
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://jira.nutanix.com',
    companionProjects: companionProjectKeys(team),
  };
}

function loadCcConfig() {
  try {
    return JSON.parse(fs.readFileSync(CC_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function loadReleaseGateEntry(release) {
  try {
    const cfg = JSON.parse(fs.readFileSync(RELEASE_EMAIL_CONFIG_PATH, 'utf8'));
    return cfg.releaseGateDates?.[release] || null;
  } catch {
    return null;
  }
}

/** Username or email → lowercase @nutanix.com address. */
function toEmail(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();
  return `${s}@nutanix.com`.toLowerCase();
}

function uniqEmails(list) {
  return [...new Set((list || []).map(toEmail).filter(Boolean))];
}

// Central taxonomy: variants re-exported from releaseOutstandingDeferralService
// (which delegates to jiraFieldsConfig.js getLabelPattern). Kept here as
// thin re-exports for backwards compat; do not re-derive locally.
function deferredLabelVariants(release) {
  return centralDeferredVariants ? centralDeferredVariants(release) : [...new Set([deferredLabel(release), `${String(release || '').trim()}-deferred`])];
}
function mustFixLabelVariants(release) {
  return centralMustFixVariants ? centralMustFixVariants(release) : [...new Set([mustFixLabel(release), `${String(release || '').trim()}-mustfix`])];
}

function deferredExcludedClause(release) {
  const demo = `${String(release || '').trim().toLowerCase()}-demo-site-test`;
  const labels = [...new Set([...deferredLabelVariants(release), demo])];
  return `(labels is EMPTY OR labels not in (${labels.map(quote).join(', ')}))`;
}

function deferredPresentClause(release) {
  const labels = deferredLabelVariants(release);
  return labels.length === 1
    ? `labels = ${quote(labels[0])}`
    : `labels in (${labels.map(quote).join(', ')})`;
}

/**
 * Outstanding JQL builders.
 * Actionable Dev/Test: exclude portfolio, companions, and deferred labels.
 * Must-fix actionable: label + fixVersion = release.
 * Hygiene: deferred/mustfix/master inconsistencies (separate strip).
 */
function buildOutstandingJqls(
  release,
  companionProjects = DEFAULT_COMPANION_PROJECTS,
  primaryProject = 'ERA'
) {
  const all = releaseAllClause(release);
  const companions = (companionProjects || DEFAULT_COMPANION_PROJECTS).filter(Boolean);
  const notCompanion =
    companions.length > 0 ? ` AND project not in (${companions.join(', ')})` : '';
  const primary = String(primaryProject || 'ERA').trim() || 'ERA';
  const notDeferred = ` AND ${deferredExcludedClause(release)}`;
  const openDevQa = `status not in (Resolved, Closed)`;

  const notClosed = `${all} AND status != Closed`;
  const toBeResolved = `${all} AND status = Resolved`;

  const devBase = `${all} AND ${openDevQa} AND issuetype not in (${PORTFOLIO_TYPES})${notCompanion}${notDeferred}`;
  const dev = devBase;
  const devTasks = `${devBase} AND issuetype in (${DEV_GROUP_TYPES.tasks})`;
  const devBugs = `${devBase} AND issuetype in (${DEV_GROUP_TYPES.bugs})`;
  const devCve = `${devBase} AND issuetype = ${DEV_GROUP_TYPES.cve}`;
  const devOther = `${devBase} AND issuetype not in (${DEV_GROUP_TYPES.tasks}, ${DEV_GROUP_TYPES.bugs}, ${DEV_GROUP_TYPES.cve})`;
  const qa = `${all} AND ${openDevQa} AND issuetype = Test${notCompanion}${notDeferred}`;

  const mustFix = mustFixJql(release);
  const mfLabel = quote(mustFixLabel(release));
  // Of-which must-fix inside each Dev group (same open bar + mustfix ∧ FV=release).
  const mustFixIn = (groupJql) =>
    `${groupJql} AND labels = ${mfLabel} AND fixVersion = ${quote(release)}`;
  const mustFixDevTasks = mustFixIn(devTasks);
  const mustFixDevBugs = mustFixIn(devBugs);
  const mustFixDevCve = mustFixIn(devCve);
  const mustFixDevOther = mustFixIn(devOther);

  // Regression / System-Test cards: open (statusCategory != Done) on the release-All universe.
  const regressionProduct = `${all} AND filter=ndb-product-regressions AND statusCategory != Done`;
  const regressionTest = `${all} AND filter=ndb-test-regressions AND statusCategory != Done`;
  const systemTest = `${all} AND filter=NDB-System-Test AND statusCategory != Done`;
  const mustFixRegressionProduct = mustFixIn(regressionProduct);
  const mustFixRegressionTest = mustFixIn(regressionTest);
  const mustFixSystemTest = mustFixIn(systemTest);
  // Hygiene: same companion exclusion as Dev so docs/security noise stays out.
  const hyMustFixWrongFv = `${all} AND labels = ${mfLabel} AND fixVersion != ${quote(release)} AND statusCategory != Done${notCompanion}`;

  const deferredOn = deferredPresentClause(release);
  const hyDeferredOnRelease = `${all} AND ${deferredOn} AND fixVersion = ${quote(release)} AND statusCategory != Done${notCompanion}`;
  const hyOnMaster = `${all} AND fixVersion = ${quote(MASTER_FIX_VERSION)} AND statusCategory != Done${notCompanion}`;

  const nextDot = nextExistingDot(release, []);
  const nextMajor = nextExistingMajor(release, []);
  const okTargets = [release, nextDot, nextMajor, MASTER_FIX_VERSION].filter(Boolean);
  const hyDeferredWrongTarget = `${all} AND ${deferredOn} AND statusCategory != Done AND fixVersion not in (${okTargets.map(quote).join(', ')})${notCompanion}`;

  // Move + Defer/Justification pool (existing deferral builders; disjoint on FV).
  const movePending = candidatesJql(release);
  const deferPending = awaitingDeferralJql(release);
  const moveDeferPending = `((${movePending}) OR (${deferPending}))`;

  // Non-ERA / non-FEAT projects still open (statusCategory != Done).
  const excludeKeys = [...new Set([primary, ...BY_PROJECT_EXCLUDE])].filter(Boolean);
  const notHome =
    excludeKeys.length === 1
      ? ` AND project != ${excludeKeys[0]}`
      : ` AND project not in (${excludeKeys.join(', ')})`;
  const disciplines = `(${all} OR fixVersion = ${quote(release)}) AND statusCategory != Done${notHome}`;

  return {
    notClosed,
    toBeResolved,
    dev,
    devTasks,
    devBugs,
    devCve,
    devOther,
    qa,
    disciplines,
    mustFix,
    mustFixDevTasks,
    mustFixDevBugs,
    mustFixDevCve,
    mustFixDevOther,
    regressionProduct,
    regressionTest,
    systemTest,
    mustFixRegressionProduct,
    mustFixRegressionTest,
    mustFixSystemTest,
    hyDeferredOnRelease,
    hyOnMaster,
    hyDeferredWrongTarget,
    hyMustFixWrongFv,
    movePending,
    deferPending,
    moveDeferPending,
    nextDot,
    nextMajor,
  };
}

/** Count-only fetch (no sample) for of-which / hygiene sub-counts. */
async function fetchCountOnly(jira, jql) {
  try {
    return {
      count: Number(await jira.searchCount(jql)) || 0,
      jql,
    };
  } catch (e) {
    console.warn('[outstanding-workbench] count failed:', e.message, jql.slice(0, 120));
    return { count: 0, jql, error: e.message || 'Search failed' };
  }
}

function projectChipJql(release, projectKey, allClause) {
  const all = allClause || releaseAllClause(release);
  return `project = ${projectKey} AND (${all} OR fixVersion = ${quote(release)}) AND statusCategory != Done`;
}

function userName(user) {
  if (!user || typeof user !== 'object') return '';
  return String(user.displayName || user.name || user.key || '').trim();
}

function versionNames(list) {
  return Array.isArray(list) ? list.map((v) => v?.name).filter(Boolean) : [];
}

function mapSampleIssue(issue, release) {
  const f = issue.fields || {};
  const labels = Array.isArray(f.labels) ? f.labels.filter(Boolean) : [];
  const fixVersions = versionNames(f.fixVersions);
  // Chip flags are label-based (any casing). FV match is for bucket JQL, not chip visibility —
  // hygiene "Must-fix, FV ≠ release" still shows the Must-fix chip.
  const isMustFix =
    !!release && mustFixLabelVariants(release).some((l) => labels.includes(l));
  const isDeferred =
    !!release && deferredLabelVariants(release).some((l) => labels.includes(l));
  return {
    key: issue.key,
    summary: f.summary || '',
    status: f.status?.name || '',
    issueType: f.issuetype?.name || '',
    priority: f.priority?.name || '',
    assignee: userName(f.assignee),
    qaContact: userName(f[QA_CONTACT_FIELD]),
    affectedVersions: versionNames(f.versions),
    fixVersions,
    labels,
    isMustFix,
    isDeferred,
    cfdCfiCategory: null,
    updated: f.updated || null,
    ...mapExtraTicketFields(f),
  };
}

async function fetchBucketSample(jira, jql) {
  // One page only — do not use searchAll (it throws when total > maxIssues).
  const res = await jira.get('/rest/api/2/search', {
    params: {
      jql,
      fields: OUTSTANDING_FIELDS,
      maxResults: SAMPLE_LIMIT,
      startAt: 0,
    },
  });
  return res.data?.issues || [];
}

async function fetchBucket(jira, jql, release) {
  try {
    const count = Number(await jira.searchCount(jql)) || 0;
    let sample = [];
    let sampleError;
    try {
      sample = (await fetchBucketSample(jira, jql)).map((i) => mapSampleIssue(i, release));
    } catch (e) {
      sampleError = e.message || 'Sample fetch failed';
      console.warn('[outstanding-workbench] sample failed:', sampleError, jql.slice(0, 120));
    }
    return {
      count,
      sample,
      jql,
      truncated: count > sample.length,
      ...(sampleError ? { error: sampleError } : {}),
    };
  } catch (e) {
    console.warn('[outstanding-workbench] bucket failed:', e.message, jql.slice(0, 120));
    return {
      count: 0,
      sample: [],
      jql,
      error: e.message || 'Search failed',
      truncated: false,
    };
  }
}

/**
 * Every non-home project still open on the release → dynamic chips (count > 0).
 * Universe: (All-filter OR fixVersion) ∧ statusCategory != Done ∧ project not in (ERA, FEAT).
 * Chip label = project key (TECHPUBS, OSS, …).
 */
async function fetchOpenByProject(jira, release, primaryProject = 'ERA') {
  const primary = String(primaryProject || 'ERA').trim() || 'ERA';
  const exclude = new Set([primary, ...BY_PROJECT_EXCLUDE]);
  const excludeKeys = [...exclude].filter(Boolean);
  const all = releaseAllClause(release);
  const notHome =
    excludeKeys.length === 1
      ? ` AND project != ${excludeKeys[0]}`
      : ` AND project not in (${excludeKeys.join(', ')})`;
  const jql = `(${all} OR fixVersion = ${quote(release)}) AND statusCategory != Done${notHome}`;
  const rollup = await fetchBucket(jira, jql, release);
  const tallies = new Map(); // key -> { count, name }
  let startAt = 0;
  let total = rollup.count;
  let fetched = 0;

  try {
    for (let page = 0; page < PROJECT_MAX_PAGES; page++) {
      if (startAt >= total && page > 0) break;
      const res = await jira.get('/rest/api/2/search', {
        params: {
          jql,
          fields: 'project',
          maxResults: PROJECT_PAGE_SIZE,
          startAt,
        },
      });
      const issues = res.data?.issues || [];
      total = Number(res.data?.total) || total;
      if (!issues.length) break;
      for (const issue of issues) {
        const p = issue.fields?.project;
        const key = p?.key;
        if (!key || exclude.has(key)) continue;
        const cur = tallies.get(key) || { count: 0, name: p?.name || key };
        cur.count += 1;
        if (p?.name) cur.name = p.name;
        tallies.set(key, cur);
      }
      fetched += issues.length;
      startAt += issues.length;
      if (issues.length < PROJECT_PAGE_SIZE) break;
    }
  } catch (e) {
    console.warn('[outstanding-workbench] project discovery failed:', e.message);
  }

  const truncated = fetched < total;
  // Prefer exact searchCount per project whenever we truncated OR always for honesty.
  const entries = [...tallies.entries()].sort((a, b) => b[1].count - a[1].count);

  const byDiscipline = {};
  await Promise.all(
    entries.map(async ([key, meta]) => {
      const chipJql = projectChipJql(release, key, all);
      let count = meta.count;
      try {
        // Always re-count — in-memory tallies miss issues past the page walk.
        count = Number(await jira.searchCount(chipJql)) || 0;
      } catch (e) {
        console.warn('[outstanding-workbench] chip count failed:', key, e.message);
        if (truncated) count = meta.count;
      }
      if (count <= 0) return;
      byDiscipline[key] = {
        projectKey: key,
        label: key,
        name: meta.name || key,
        jql: chipJql,
        count,
        sample: [],
        truncated: count > SAMPLE_LIMIT,
      };
    })
  );

  console.info(
    '[outstanding-workbench] by-project chips:',
    Object.keys(byDiscipline).sort().join(', ') || '(none)',
    `rollup=${rollup.count}`
  );

  // Real per-project samples for the drill table.
  const chipKeys = Object.keys(byDiscipline);
  await Promise.all(
    chipKeys.map(async (key) => {
      try {
        const sample = (await fetchBucketSample(jira, byDiscipline[key].jql)).map((i) =>
          mapSampleIssue(i, release)
        );
        byDiscipline[key].sample = sample;
        byDiscipline[key].truncated = byDiscipline[key].count > sample.length;
      } catch (e) {
        console.warn('[outstanding-workbench] chip sample failed:', key, e.message);
      }
    })
  );

  return { rollup, byDiscipline };
}

function packBucket(id, label, data) {
  return { id, label, ...data };
}

async function getOutstandingBuckets({ token, teamId, release }) {
  if (!release) {
    const err = new Error('release is required');
    err.statusCode = 400;
    throw err;
  }

  const { teamId: tid, jiraBaseUrl, companionProjects, projectKey } = resolveTeam(teamId);
  const jira = await getJira(token);
  const jqls = buildOutstandingJqls(release, companionProjects, projectKey);

  const [
    notClosed,
    toBeResolved,
    dev,
    devTasks,
    devBugs,
    devCve,
    devOther,
    qa,
    mustFix,
    mfDevTasks,
    mfDevBugs,
    mfDevCve,
    mfDevOther,
    regressionProduct,
    regressionTest,
    systemTest,
    mfRegressionProduct,
    mfRegressionTest,
    mfSystemTest,
    hyDeferredOnRelease,
    hyOnMaster,
    hyDeferredWrongTarget,
    hyMustFixWrongFv,
    movePending,
    deferPending,
    projectPack,
  ] = await Promise.all([
    fetchBucket(jira, jqls.notClosed, release),
    fetchBucket(jira, jqls.toBeResolved, release),
    fetchBucket(jira, jqls.dev, release),
    fetchBucket(jira, jqls.devTasks, release),
    fetchBucket(jira, jqls.devBugs, release),
    fetchBucket(jira, jqls.devCve, release),
    fetchBucket(jira, jqls.devOther, release),
    fetchBucket(jira, jqls.qa, release),
    fetchBucket(jira, jqls.mustFix, release),
    fetchBucket(jira, jqls.mustFixDevTasks, release),
    fetchBucket(jira, jqls.mustFixDevBugs, release),
    fetchBucket(jira, jqls.mustFixDevCve, release),
    fetchBucket(jira, jqls.mustFixDevOther, release),
    fetchBucket(jira, jqls.regressionProduct, release),
    fetchBucket(jira, jqls.regressionTest, release),
    fetchBucket(jira, jqls.systemTest, release),
    fetchBucket(jira, jqls.mustFixRegressionProduct, release),
    fetchBucket(jira, jqls.mustFixRegressionTest, release),
    fetchBucket(jira, jqls.mustFixSystemTest, release),
    fetchBucket(jira, jqls.hyDeferredOnRelease, release),
    fetchBucket(jira, jqls.hyOnMaster, release),
    fetchBucket(jira, jqls.hyDeferredWrongTarget, release),
    fetchBucket(jira, jqls.hyMustFixWrongFv, release),
    fetchCountOnly(jira, jqls.movePending),
    fetchCountOnly(jira, jqls.deferPending),
    fetchOpenByProject(jira, release, projectKey),
  ]);

  const cfdCfiScope = `${releaseAllClause(release)} AND statusCategory != Done`;
  const [, cfdCfi] = await Promise.all([
    enrichCfdCfiCategories(jira, tid, [
      notClosed.sample,
      toBeResolved.sample,
      dev.sample,
      devTasks.sample,
      devBugs.sample,
      devCve.sample,
      devOther.sample,
      qa.sample,
      mustFix.sample,
      mfDevTasks.sample,
      mfDevBugs.sample,
      mfDevCve.sample,
      mfDevOther.sample,
      regressionProduct.sample,
      regressionTest.sample,
      systemTest.sample,
      mfRegressionProduct.sample,
      mfRegressionTest.sample,
      mfSystemTest.sample,
      hyDeferredOnRelease.sample,
      hyOnMaster.sample,
      hyDeferredWrongTarget.sample,
      hyMustFixWrongFv.sample,
      projectPack.rollup?.sample,
      ...Object.values(projectPack.byDiscipline || {}).map((d) => d.sample),
    ]),
    buildCfdCfiStrip(jira, tid, cfdCfiScope),
  ]);

  const withMustFix = (bucket, mf) => ({
    ...bucket,
    mustFixCount: mf.count,
    mustFixJql: mf.jql,
  });

  const byDiscipline = projectPack.byDiscipline;
  const hygiene = {
    hyDeferredOnRelease: packBucket(
      'hyDeferredOnRelease',
      BUCKET_LABELS.hyDeferredOnRelease,
      hyDeferredOnRelease
    ),
    hyOnMaster: packBucket('hyOnMaster', BUCKET_LABELS.hyOnMaster, hyOnMaster),
    hyDeferredWrongTarget: packBucket(
      'hyDeferredWrongTarget',
      BUCKET_LABELS.hyDeferredWrongTarget,
      hyDeferredWrongTarget
    ),
    hyMustFixWrongFv: packBucket(
      'hyMustFixWrongFv',
      BUCKET_LABELS.hyMustFixWrongFv,
      hyMustFixWrongFv
    ),
  };
  const hygieneTotal = Object.values(hygiene).reduce((n, b) => n + (Number(b.count) || 0), 0);
  const moveDeferCount =
    (Number(movePending.count) || 0) + (Number(deferPending.count) || 0);
  const moveDeferPending = {
    count: moveDeferCount,
    moveCount: Number(movePending.count) || 0,
    deferCount: Number(deferPending.count) || 0,
    jql: jqls.moveDeferPending,
    moveJql: jqls.movePending,
    deferJql: jqls.deferPending,
    label: 'still on the Move/Defer queue',
  };

  const recipients = defaultRecipients(release);
  // Capacity story only — Move/Defer is a separate linked signal for execs.
  const storyParts = [
    `${dev.count} Dev open (${mustFix.count} must-fix)`,
    `${toBeResolved.count} awaiting verification`,
    `${qa.count} Test open`,
  ];
  if (hygieneTotal) storyParts.push(`${hygieneTotal} hygiene`);
  const story = storyParts.join(' · ');

  return {
    teamId: tid,
    release,
    jiraBaseUrl,
    story,
    moveDeferPending,
    buckets: {
      notClosed: packBucket('notClosed', BUCKET_LABELS.notClosed, notClosed),
      toBeResolved: packBucket('toBeResolved', BUCKET_LABELS.toBeResolved, toBeResolved),
      dev: packBucket('dev', BUCKET_LABELS.dev, {
        ...dev,
        mustFixCount: mustFix.count,
        mustFixJql: jqls.mustFix,
      }),
      devTasks: packBucket(
        'devTasks',
        BUCKET_LABELS.devTasks,
        withMustFix(devTasks, mfDevTasks)
      ),
      devBugs: packBucket(
        'devBugs',
        BUCKET_LABELS.devBugs,
        withMustFix(devBugs, mfDevBugs)
      ),
      devCve: packBucket('devCve', BUCKET_LABELS.devCve, withMustFix(devCve, mfDevCve)),
      devOther: packBucket(
        'devOther',
        BUCKET_LABELS.devOther,
        withMustFix(devOther, mfDevOther)
      ),
      mustFixDevTasks: packBucket(
        'mustFixDevTasks',
        `${BUCKET_LABELS.devTasks} · must-fix`,
        mfDevTasks
      ),
      mustFixDevBugs: packBucket(
        'mustFixDevBugs',
        `${BUCKET_LABELS.devBugs} · must-fix`,
        mfDevBugs
      ),
      mustFixDevCve: packBucket(
        'mustFixDevCve',
        `${BUCKET_LABELS.devCve} · must-fix`,
        mfDevCve
      ),
      mustFixDevOther: packBucket(
        'mustFixDevOther',
        `${BUCKET_LABELS.devOther} · must-fix`,
        mfDevOther
      ),
      regressionProduct: packBucket(
        'regressionProduct',
        BUCKET_LABELS.regressionProduct,
        withMustFix(regressionProduct, mfRegressionProduct)
      ),
      regressionTest: packBucket(
        'regressionTest',
        BUCKET_LABELS.regressionTest,
        withMustFix(regressionTest, mfRegressionTest)
      ),
      systemTest: packBucket(
        'systemTest',
        BUCKET_LABELS.systemTest,
        withMustFix(systemTest, mfSystemTest)
      ),
      mustFixRegressionProduct: packBucket(
        'mustFixRegressionProduct',
        `${BUCKET_LABELS.regressionProduct} · must-fix`,
        mfRegressionProduct
      ),
      mustFixRegressionTest: packBucket(
        'mustFixRegressionTest',
        `${BUCKET_LABELS.regressionTest} · must-fix`,
        mfRegressionTest
      ),
      mustFixSystemTest: packBucket(
        'mustFixSystemTest',
        `${BUCKET_LABELS.systemTest} · must-fix`,
        mfSystemTest
      ),
      qa: packBucket('qa', BUCKET_LABELS.qa, qa),
      mustFix: packBucket('mustFix', BUCKET_LABELS.mustFix, mustFix),
      disciplines: packBucket('disciplines', BUCKET_LABELS.disciplines, projectPack.rollup),
    },
    hygiene,
    byDiscipline,
    cfdCfi: cfdCfi || { total: 0, jql: '', categories: [] },
    reportRecipients: recipients,
    meta: {
      nextDot: jqls.nextDot,
      nextMajor: jqls.nextMajor,
      hygieneTotal,
      moveDeferCount,
      cfdCfiTotal: Number(cfdCfi?.total) || 0,
    },
    jql: {
      notClosed: jqls.notClosed,
      toBeResolved: jqls.toBeResolved,
      dev: jqls.dev,
      devTasks: jqls.devTasks,
      devBugs: jqls.devBugs,
      devCve: jqls.devCve,
      devOther: jqls.devOther,
      qa: jqls.qa,
      mustFix: jqls.mustFix,
      mustFixDevTasks: jqls.mustFixDevTasks,
      mustFixDevBugs: jqls.mustFixDevBugs,
      mustFixDevCve: jqls.mustFixDevCve,
      mustFixDevOther: jqls.mustFixDevOther,
      regressionProduct: jqls.regressionProduct,
      regressionTest: jqls.regressionTest,
      systemTest: jqls.systemTest,
      mustFixRegressionProduct: jqls.mustFixRegressionProduct,
      mustFixRegressionTest: jqls.mustFixRegressionTest,
      mustFixSystemTest: jqls.mustFixSystemTest,
      disciplines: jqls.disciplines,
      hyDeferredOnRelease: jqls.hyDeferredOnRelease,
      hyOnMaster: jqls.hyOnMaster,
      hyDeferredWrongTarget: jqls.hyDeferredWrongTarget,
      hyMustFixWrongFv: jqls.hyMustFixWrongFv,
      movePending: jqls.movePending,
      deferPending: jqls.deferPending,
      moveDeferPending: jqls.moveDeferPending,
      byDiscipline: Object.fromEntries(
        Object.entries(byDiscipline).map(([k, v]) => [k, v.jql])
      ),
    },
  };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jiraIssuesUrl(jiraBaseUrl, jql) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/$/, '');
  return `${base}/issues/?jql=${encodeURIComponent(jql || '')}`;
}

const TD =
  'padding:6px 8px;border:1px solid #e4e4e7;vertical-align:top;font-size:12px;word-break:break-word;overflow-wrap:anywhere;';
const TH =
  'padding:6px 8px;border:1px solid #e4e4e7;background:#f4f4f5;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;color:#52525b;white-space:nowrap;';
const TICKET_COLUMNS = [
  'Key',
  'Summary',
  'Status',
  'Affected Version',
  'Fix Version',
  'Assignee',
  'QA Contact',
  'Priority',
  'Issue Type',
  'Component',
  'Due Date',
  'Created',
  'Updated',
];

function joinOrDash(list) {
  return Array.isArray(list) && list.length ? list.join(', ') : '—';
}

function fmtDate(iso) {
  return iso ? String(iso).slice(0, 10) : '—';
}

function chipSortRank(row) {
  let n = 0;
  if (row?.isMustFix) n += 4;
  if (row?.isDeferred) n += 2;
  if (row?.cfdCfiCategory) n += 1;
  return n;
}

function mustFixFirst(rows) {
  return [...(rows || [])].sort((a, b) => {
    const d = chipSortRank(b) - chipSortRank(a);
    return d || String(a.key).localeCompare(String(b.key));
  });
}

function cfdCfiBucketFromStrip(cfdCfi) {
  const categories = Array.isArray(cfdCfi?.categories) ? cfdCfi.categories : [];
  const byKey = new Map();
  for (const cat of categories) {
    for (const row of cat.sample || []) {
      if (!row?.key || byKey.has(row.key)) continue;
      byKey.set(row.key, {
        ...row,
        cfdCfiCategory: row.cfdCfiCategory || cat.name || null,
      });
    }
  }
  return {
    count: Number(cfdCfi?.total) || byKey.size,
    jql: cfdCfi?.jql || '',
    sample: [...byKey.values()],
    truncated: Number(cfdCfi?.total) > byKey.size,
  };
}

function ticketRowHtml(row, jiraBaseUrl, showChip) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/$/, '');
  const href = `${base}/browse/${encodeURIComponent(row.key)}`;
  const mustFixChip =
    showChip && row.isMustFix
      ? ' <span style="display:inline-block;padding:1px 6px;border-radius:8px;background:#fee2e2;color:#b91c1c;font-size:10px;font-weight:700;">Must-fix</span>'
      : '';
  const deferredChip =
    showChip && row.isDeferred
      ? ' <span style="display:inline-block;padding:1px 6px;border-radius:8px;background:#ffedd5;color:#c2410c;font-size:10px;font-weight:700;">Allowed deferral</span>'
      : '';
  const cfdCfiChip =
    showChip && row.cfdCfiCategory
      ? ` <span style="display:inline-block;padding:1px 6px;border-radius:8px;background:#dbeafe;color:#1e40af;font-size:10px;font-weight:700;">${escapeHtml(row.cfdCfiCategory)}</span>`
      : '';
  const chip = `${mustFixChip}${deferredChip}${cfdCfiChip}`;
  return `<tr>
    <td style="${TD}white-space:nowrap;"><a href="${escapeHtml(href)}" style="color:#2563eb;text-decoration:none;font-weight:600;">${escapeHtml(row.key)}</a>${chip}</td>
    <td style="${TD}">${escapeHtml(row.summary || '—')}</td>
    <td style="${TD}">${escapeHtml(row.status || '—')}</td>
    <td style="${TD}">${escapeHtml(joinOrDash(row.affectedVersions))}</td>
    <td style="${TD}">${escapeHtml(joinOrDash(row.fixVersions))}</td>
    <td style="${TD}">${escapeHtml(row.assignee || '—')}</td>
    <td style="${TD}">${escapeHtml(row.qaContact || '—')}</td>
    <td style="${TD}">${escapeHtml(row.priority || '—')}</td>
    <td style="${TD}">${escapeHtml(row.issueType || '—')}</td>
    <td style="${TD}">${escapeHtml(joinOrDash(row.components))}</td>
    <td style="${TD}white-space:nowrap;">${escapeHtml(fmtDate(row.dueDate))}</td>
    <td style="${TD}white-space:nowrap;">${escapeHtml(fmtDate(row.created))}</td>
    <td style="${TD}white-space:nowrap;">${escapeHtml(fmtDate(row.updated))}</td>
  </tr>`;
}

/** Ticket table with count + Open in JIRA header; must-fix-first when chips are shown. */
function ticketTableHtml(title, bucket, jiraBaseUrl, { showChip = true, level = 3 } = {}) {
  const count = Number(bucket?.count) || 0;
  if (!bucket || count <= 0) return '';
  const rows = showChip ? mustFixFirst(bucket.sample) : [...(bucket.sample || [])];
  const url = jiraIssuesUrl(jiraBaseUrl, bucket.jql);
  const shown = rows.length;
  const note =
    count > shown
      ? `<span style="font-size:12px;color:#71717a;font-weight:400;"> · Showing ${shown} of ${count}</span>`
      : '';
  const fs = level === 3 ? 15 : 13;
  return `
  <div style="margin:0 0 18px;width:100%;">
    <div style="margin:0 0 6px;font-size:${fs}px;font-weight:650;">
      ${escapeHtml(title)} — ${count}${note}
      <a href="${escapeHtml(url)}" style="font-size:12px;font-weight:400;color:#2563eb;margin-left:8px;">Open in JIRA ↗</a>
    </div>
    <div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table style="width:100%;min-width:640px;border-collapse:collapse;table-layout:auto;">
        <thead><tr>${TICKET_COLUMNS.map((c) => `<th style="${TH}">${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => ticketRowHtml(r, jiraBaseUrl, showChip)).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

function ticketSectionsHtml(buckets, jiraBaseUrl, cfdCfi) {
  // Same chip set as UI drill: Must-fix · Allowed deferral · CFI/CFD category.
  const mustFix = ticketTableHtml('MUST FIX', buckets.mustFix, jiraBaseUrl, { showChip: true });
  const cve = ticketTableHtml('CVE', buckets.devCve, jiraBaseUrl, { showChip: true });
  const regProduct = ticketTableHtml('Product', buckets.regressionProduct, jiraBaseUrl, {
    level: 4,
    showChip: true,
  });
  const regTest = ticketTableHtml('Test', buckets.regressionTest, jiraBaseUrl, {
    level: 4,
    showChip: true,
  });
  const regression =
    regProduct || regTest
      ? `<h2 style="font-size:16px;margin:18px 0 8px;">REGRESSION</h2>${regProduct}${regTest}`
      : '';
  const systemTest = ticketTableHtml('SYSTEM TEST', buckets.systemTest, jiraBaseUrl, {
    showChip: true,
  });
  const cfdCfiTable = ticketTableHtml(
    'CFI / CFD',
    cfdCfiBucketFromStrip(cfdCfi),
    jiraBaseUrl,
    { showChip: true }
  );
  return [mustFix, cve, regression, systemTest, cfdCfiTable].filter(Boolean).join('\n');
}

function buildOutstandingReportHtml(data) {
  const {
    release,
    story: storyIn,
    buckets = {},
    moveDeferPending = null,
    jiraBaseUrl,
    cfdCfi = null,
  } = data || {};
  if (!release) {
    throw Object.assign(new Error('release is required for report HTML'), { statusCode: 400 });
  }
  const cfdCfiTile =
    cfdCfi && (Number(cfdCfi.total) > 0 || cfdCfi.jql)
      ? {
          label: cfdCfi.label || 'CFI / CFD',
          count: Number(cfdCfi.total) || 0,
          jql: cfdCfi.jql || '',
        }
      : { label: 'CFI / CFD', count: 0, jql: cfdCfi?.jql || '' };

  // Always render a cell (match UI empty tiles) — never drop a hero card.
  const tile = (b, ofWhich, fallbackLabel = '—') => {
    const label = b?.label || fallbackLabel;
    const count = Number(b?.count) || 0;
    const jql = b?.jql || '';
    const url = jql ? jiraIssuesUrl(jiraBaseUrl, jql) : '';
    const mfN = Number(ofWhich?.count) || 0;
    const mfUrl = ofWhich?.jql ? jiraIssuesUrl(jiraBaseUrl, ofWhich.jql) : '';
    const hintHtml =
      mfN > 0 && mfUrl
        ? `<div style="font-size:11px;color:#52525b;margin-top:2px;">of which <a href="${escapeHtml(mfUrl)}" style="color:#2563eb;text-decoration:none;font-weight:600;">${mfN} must-fix</a></div>`
        : '';
    const countHtml = url
      ? `<a href="${escapeHtml(url)}" style="font-size:clamp(20px,2.5vw,26px);font-weight:650;color:#18181b;text-decoration:none;">${count}</a>`
      : `<span style="font-size:clamp(20px,2.5vw,26px);font-weight:650;color:#18181b;">${count}</span>`;
    const jiraLink = url
      ? `<div style="margin-top:4px;"><a href="${escapeHtml(url)}" style="font-size:12px;color:#2563eb;">Open in JIRA ↗</a></div>`
      : '';
    return `
      <td style="width:25%;padding:10px 12px;border:1px solid #e4e4e7;vertical-align:top;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;">${escapeHtml(label)}</div>
        ${countHtml}
        ${hintHtml}
        ${jiraLink}
      </td>`;
  };

  const mustFix = buckets.mustFix || {};
  const mustFixN = Number(mustFix.count) || 0;
  const ofWhich = (b) => {
    const n = Number(b?.mustFixCount) || 0;
    if (n <= 0) return null;
    return { count: n, jql: b.mustFixJql || buckets.mustFix?.jql };
  };
  const story =
    storyIn ||
    `${Number(buckets.dev?.count) || 0} Dev open (${mustFixN} must-fix) on ${release}`;

  const mdCount = Number(moveDeferPending?.count) || 0;
  const mdUrl = moveDeferPending?.jql
    ? jiraIssuesUrl(jiraBaseUrl, moveDeferPending.jql)
    : '';
  const moveDeferLine =
    mdCount > 0 && mdUrl
      ? `<p style="margin:0 0 16px;font-size:14px;"><a href="${escapeHtml(mdUrl)}" style="color:#18181b;font-weight:650;text-decoration:underline;">${mdCount}</a> still on the Move/Defer queue</p>`
      : '';

  // Hero rows match Outstanding UI: headline (Dev open · Must-fix) · Dev · Test · KPI.
  // Tables: MUST FIX · CVE · REGRESSION · SYSTEM TEST · CFI/CFD — chips on every row.
  // Width: 99% of body; ticket tables scroll horizontally on narrow viewports.
  const groupHeading = (label) =>
    `<p style="margin:12px 0 6px;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;">${escapeHtml(label)}</p>`;

  return `<!-- Outstanding | ${escapeHtml(release)} | ${new Date().toISOString().slice(0, 10)} -->
<!-- audience: team-exec -->
<div style="box-sizing:border-box;width:99%;max-width:99%;margin:0 auto;padding:0 0.5%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;font-size:14px;line-height:1.4;">
  <h1 style="font-size:clamp(18px,2.2vw,22px);margin:0 0 6px;">${escapeHtml(release)} — Outstanding work</h1>
  <p style="margin:0 0 8px;font-size:14px;">${escapeHtml(story)}</p>
  ${moveDeferLine}

  <div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 8px;">
    <table style="width:100%;max-width:480px;border-collapse:collapse;">
      <tr>
        ${tile(buckets.dev, ofWhich(buckets.dev) || (mustFixN ? { count: mustFixN, jql: mustFix.jql } : null), 'Dev open')}
        ${tile(buckets.mustFix, null, 'Must-fix')}
      </tr>
    </table>
  </div>

  ${groupHeading('Dev')}
  <div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 8px;">
    <table style="width:100%;min-width:560px;border-collapse:collapse;">
      <tr>
        ${tile(buckets.devTasks, ofWhich(buckets.devTasks), 'Task / Unit Test')}
        ${tile(buckets.devBugs, ofWhich(buckets.devBugs), 'Bug / Improvement')}
        ${tile(buckets.devCve, ofWhich(buckets.devCve), 'CVE')}
        ${tile(buckets.devOther, ofWhich(buckets.devOther), 'Dev other')}
      </tr>
    </table>
  </div>

  ${groupHeading('Test')}
  <div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 8px;">
    <table style="width:100%;max-width:480px;border-collapse:collapse;">
      <tr>
        ${tile(buckets.toBeResolved, null, 'Awaiting Verification')}
        ${tile(buckets.qa, null, 'Test open')}
      </tr>
    </table>
  </div>

  ${groupHeading('KPI')}
  <div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 20px;">
    <table style="width:100%;min-width:560px;border-collapse:collapse;">
      <tr>
        ${tile(buckets.regressionProduct, ofWhich(buckets.regressionProduct), 'Regression – Product')}
        ${tile(buckets.regressionTest, ofWhich(buckets.regressionTest), 'Regression – Test')}
        ${tile(buckets.systemTest, ofWhich(buckets.systemTest), 'System-Test')}
        ${tile(cfdCfiTile, null, 'CFI / CFD')}
      </tr>
    </table>
  </div>

  ${ticketSectionsHtml(buckets, jiraBaseUrl, cfdCfi)}

  <p style="font-size:13px;margin-top:20px;word-break:break-word;">
    For live data, please use
    <a href="http://ndb-qa.dev.nutanix.com:8899/release-outstanding-work" style="color:#2563eb;">http://ndb-qa.dev.nutanix.com:8899/release-outstanding-work</a>
  </p>
</div>
<div style="display:none;">${escapeHtml(story)}</div>`;
}

function leadershipCc() {
  const cfg = loadCcConfig();
  if (Array.isArray(cfg.mustFixLeadershipCC) && cfg.mustFixLeadershipCC.length) {
    return uniqEmails(cfg.mustFixLeadershipCC);
  }
  return uniqEmails(DEFAULT_LEADERSHIP_CC);
}

/** Current release Dev + QA DRIs from gate config (and versionDRIs emails). */
function currentReleaseDriCc(release) {
  if (!release) return [];
  const gate = loadReleaseGateEntry(release);
  const cfg = loadCcConfig();
  return uniqEmails([
    ...(Array.isArray(gate?.devDRIs) ? gate.devDRIs : []),
    ...(Array.isArray(gate?.qaDRIs) ? gate.qaDRIs : []),
    ...(Array.isArray(cfg.versionDRIs?.[release]) ? cfg.versionDRIs[release] : []),
  ]);
}

/**
 * To = ndb-exec-updates@
 * CC = current release DRIs + ndb-tech-leads@ + ndb-managers@
 */
function defaultRecipients(release) {
  return {
    to: [DEFAULT_REPORT_TO],
    cc: uniqEmails([...currentReleaseDriCc(release), ...leadershipCc()]),
  };
}

async function previewOrSendOutstandingReport({
  token,
  teamId,
  release,
  to,
  cc,
  previewOnly,
  outstandingData,
}) {
  if (!release) {
    const err = new Error('release is required');
    err.statusCode = 400;
    throw err;
  }

  const data =
    outstandingData ||
    (await getOutstandingBuckets({ token, teamId, release }));

  const defaults = defaultRecipients(release);
  const toList = Array.isArray(to) && to.length ? uniqEmails(to) : defaults.to;
  // CC is server-owned — ignore client cc.
  const ccList = defaults.cc;
  const dateStr = new Date().toISOString().slice(0, 10);
  const subject = `${release} - outstanding work - post PG gate report - ${dateStr}`;
  const html = buildOutstandingReportHtml(data);

  if (previewOnly) {
    return {
      preview: true,
      subject,
      to: toList,
      cc: ccList,
      html,
      story: data.story,
      buckets: data.buckets,
    };
  }

  if (!toList.length) {
    const err = new Error('At least one To recipient is required');
    err.statusCode = 400;
    throw err;
  }

  const info = await sendEmailDirect({
    to: toList.join(', '),
    cc: ccList.length ? ccList.join(', ') : undefined,
    subject,
    html,
  });

  return {
    preview: false,
    sent: true,
    subject,
    to: toList,
    cc: ccList,
    messageId: info.messageId,
    story: data.story,
  };
}

module.exports = {
  getOutstandingBuckets,
  previewOrSendOutstandingReport,
  buildOutstandingJqls,
  buildOutstandingReportHtml,
  defaultRecipients,
  DEFAULT_REPORT_TO,
};
