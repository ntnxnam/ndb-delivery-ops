/**
 * CJS stub for @portfolio-delivery-ops/shared.
 *
 * Used by Jest (CJS mode) because the real package uses "type":"module" (pure ESM)
 * and cannot be loaded via dynamic import() in a Jest CJS test environment.
 *
 * Provides only the interface consumed by server/routes/*.js:
 *   - getProductService   → productService
 *   - ReleaseDatasetCache → disk cache reader (no-op in tests)
 *   - payloadJqlService exports (used by synopsis / gate endpoints)
 */

const mockProductService = {
  getProduct: jest.fn().mockReturnValue({
    projectKey: 'ERA',
    labelPrefix: 'ndb',
    displayName: 'NDB',
    baseFilter: 'filter=test-base',
  }),
  getLabelPrefix: jest.fn().mockReturnValue('ndb'),
  getDisplayName: jest.fn().mockReturnValue('NDB'),
  getJiraProjects: jest.fn().mockReturnValue(['ERA', 'NDB']),
  getCustomFields: jest.fn().mockReturnValue({}),
  getBoards: jest.fn().mockReturnValue([]),
  getReleaseNamePattern: jest.fn().mockReturnValue(/^NDB-/),
  getReleasePrefix: jest.fn().mockReturnValue('NDB-'),
  getActiveVersionNames: jest.fn().mockReturnValue([]),
  getSprintCalendar: jest.fn().mockReturnValue({
    s1StartIso: '2024-10-23',
    sprintDays: 21,
  }),
};

const mockCache = {
  getCachedReleasesInfo: jest.fn().mockReturnValue({}),
  loadReleaseLenient: jest.fn().mockReturnValue({ tickets: [], meta: null }),
  saveRelease: jest.fn(),
  computeReleaseJqlHash: jest.fn().mockReturnValue('test-hash'),
  loadBundleLenient: jest.fn().mockReturnValue({ meta: null }),
  isSyncInProgress: jest.fn().mockReturnValue(false),
};

const ReleaseDatasetCache = jest.fn().mockImplementation(() => mockCache);

const getProductService = jest.fn().mockReturnValue(mockProductService);

// payloadJqlService stubs
const PAYLOAD_BUCKET_KEYS = [
  'top_level_projects',
  'work_toward_project',
  'standalone_epics',
  'work_toward_standalone_epic',
  'direct_tickets',
];
const LONG_TERM_COMPONENT = 'long_term_funded';
const EXTENSION_COMPONENT = 'extension';

const getPayloadJql = jest.fn().mockReturnValue('project = ERA');
const getLongTermFundedQuery = jest.fn().mockReturnValue('project = ERA AND component = long_term_funded');
const getExtensionQuery = jest.fn().mockReturnValue('project = ERA AND component = extension');

// Other commonly used exports
const releaseDatasetService = {
  fetchReleaseData: jest.fn().mockResolvedValue({
    tickets: [],
    bucketCounts: {},
    error: null,
    bucketErrors: {},
  }),
};

function fetchReleaseData() {
  return Promise.resolve({
    tickets: [{ 'Issue Key': 'ERA-1' }],
    bucketCounts: {},
    error: null,
    bucketErrors: {},
  });
}

function listFixVersionsForTeam() {
  return Promise.resolve([]);
}

class JiraConnector {
  constructor(env) {
    this.env = env || {};
  }

  get(path, options = {}) {
    const axios = require('axios');
    return axios.get(path, options);
  }

  post(path, body, options = {}) {
    const axios = require('axios');
    return axios.post(path, body, options);
  }

  put(path, body, options = {}) {
    const axios = require('axios');
    return axios.put(path, body, options);
  }

  request(method, path, options = {}) {
    const axios = require('axios');
    return axios({ method, url: path, ...options });
  }

  async searchAll(jql, fields, options = {}) {
    const res = await this.get('/rest/api/2/search', {
      params: {
        jql,
        fields,
        maxResults: options.pageSize || 1000,
        startAt: 0,
      },
      timeout: options.perPageTimeoutMs,
    });
    return res.data?.issues || [];
  }

  async searchCount(jql) {
    const res = await this.get('/rest/api/2/search', {
      params: { jql, maxResults: 0 },
    });
    return res.data?.total ?? 0;
  }

  async getSprintsForBoard() {
    return [];
  }

  static wrapError(err) {
    return err;
  }
}

class ConfluenceConnector {
  constructor(env) {
    this.env = env || {};
  }

  get(path, options = {}) {
    const axios = require('axios');
    return axios.get(path, options);
  }
}

class GithubConnector {
  constructor(env) {
    this.env = env || {};
  }

  async listCommits(repo, params = {}) {
    const axios = require('axios');
    const res = await axios.get(`https://api.github.com/repos/${repo}/commits`, {
      params: { page: params.page, per_page: params.perPage },
    });
    return { status: res.status || 200, commits: res.data || [] };
  }
}

class EmailConnector {
  constructor(options) {
    const nodemailer = require('nodemailer');
    this.transporter = nodemailer.createTransport(options);
  }

  send(mail) {
    return this.transporter.sendMail(mail);
  }
}

async function completeChat() {
  const axios = require('axios');
  const res = await axios.post('/chat/completions', {});
  return {
    content: res.data?.choices?.[0]?.message?.content || '',
    toolCalls: [],
    finishReason: 'stop',
  };
}

function loadEnv() {
  return {
    jiraBaseUrl: 'https://jira.example.com',
    jiraPat: '',
    jiraTimeoutMs: 30000,
    httpsProxy: null,
    githubToken: '',
  };
}

function wrapTeamScope(baseFilter, jql) {
  const filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  const inner = typeof jql === 'string' ? jql.trim() : '';
  if (!inner) return filter;
  if (!filter) return inner;
  const orderMatch = inner.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const clause = orderMatch ? inner.slice(0, orderMatch.index).trim() : inner;
  const orderBy = orderMatch ? orderMatch[1].trim() : '';
  const wrapped = `(${filter}) AND (${clause})`;
  return orderBy ? `${wrapped} ${orderBy}` : wrapped;
}
const releaseDatasetSync = {
  syncRelease: jest.fn().mockResolvedValue({ tickets: [], meta: {} }),
};

function classifyFeature() {
  return ['watching'];
}

function buildFeatureRecord(item) {
  return {
    key: item.key,
    summary: '',
    status: 'Unknown',
    jiraRisk: 'not set',
    riskAssessment: null,
    pathToGreen: null,
    pathToGreenMissing: false,
    phase: 'Unknown',
    criticalRisks: [],
    assignee: 'Unassigned',
    tpmOwner: null,
    statusUpdateAgeDays: null,
    dates: { codeComplete: null, commitGate: null, promotionGate: null },
    buckets: ['watching'],
  };
}

function evaluateTeamRiskContext() {
  return {
    indicator: 'not_set',
    assessment: '',
    pathToGreen: '',
    assessmentMissing: true,
    pathToGreenMissing: true,
    gaps: [],
    verdictFloor: null,
  };
}

function assembleReleaseIntelligence(input) {
  return {
    version: input.version,
    totalFeatures: (input.featureRecords || []).length,
    p0BugsCount: (input.p0Bugs || []).length,
    p0Bugs: input.p0Bugs || [],
    mustFixTickets: input.mustFixTickets || [],
    phaseDist: {},
    selfReportedRisk: { red: 0, yellow: 0, green: 0, notSet: 0 },
    dateMetrics: input.dateMetrics || null,
    buckets: {
      'gate-lagging': [],
      compliance: [],
      blocked: [],
      dark: [],
      watching: input.featureRecords || [],
      clear: [],
    },
    health: { verdict: 'GREEN', rule: 6, reason: 'test stub' },
    generatedAt: input.generatedAt || new Date().toISOString(),
  };
}

function getSprintMetrics(input) {
  return { ...input, completionRate: 0, pendingQARate: 0, carryoverRate: 0, scopeCreepRate: 0, open: 0 };
}

function buildStatusCategoryByName(statuses) {
  const map = new Map();
  for (const s of statuses || []) {
    const name = (s.name || '').trim();
    if (!name) continue;
    const key = (s.statusCategory?.key || '').toLowerCase();
    const catName = (s.statusCategory?.name || '').toLowerCase();
    if (key) map.set(name.toLowerCase(), key);
    else if (catName.includes('progress')) map.set(name.toLowerCase(), 'indeterminate');
    else if (catName === 'done' || catName === 'complete') map.set(name.toLowerCase(), 'done');
    else map.set(name.toLowerCase(), 'new');
  }
  return map;
}
function extractFirstInProgressIso(issue, statusCategoryByName) {
  const histories = issue?.changelog?.histories;
  if (!histories?.length) return null;
  let earliest = null;
  for (const h of histories) {
    for (const item of h.items || []) {
      if (item.field !== 'status') continue;
      const cat = statusCategoryByName.get((item.toString || '').toLowerCase());
      if (cat === 'indeterminate') {
        const d = h.created?.slice(0, 10);
        if (!earliest || d < earliest) earliest = d;
      }
    }
  }
  return earliest;
}
function computeFeatureTiming(ecDate, seeds) {
  let realStartKey = null, realStartIso = null;
  for (const s of seeds || []) {
    if (!s.firstInProgressIso) continue;
    if (!realStartIso || s.firstInProgressIso < realStartIso) { realStartIso = s.firstInProgressIso; realStartKey = s.key; }
  }
  const deltaDaysVsEc = realStartIso && ecDate ? Math.round((new Date(realStartIso) - new Date(ecDate)) / 86400000) : null;
  return { realStartKey, realStartIso, deltaDaysVsEc };
}
function computeFixVersionHygiene(tickets, release, baseJql) {
  const wrong = (tickets || []).filter(t => !(t.fixVersions || []).includes(release));
  const jql = wrong.length ? `${baseJql} AND key in (${wrong.map(t=>t.key).join(',')})` : baseJql;
  return { wrongFixVersionCount: wrong.length, jql, missingKeys: wrong.map(t=>t.key) };
}

function countSelfReportedRisk() {
  return { red: 0, yellow: 0, green: 0, notSet: 0 };
}

function computeReleaseHealthVerdict() {
  return { verdict: 'GREEN', rule: 6, reason: 'test stub' };
}

function loadAgentPack() {
  return { identity: { orchestrator: { body: '' }, specialists: [] }, skills: new Map(), constitutionalRules: [], manifest: { name: 'test', version: '0' } };
}

function runAgentTurn() {
  return Promise.resolve({
    reply: 'ok',
    trace: [],
    runtime: 'agent',
    pendingApprovals: [],
  });
}

function createAgentRuntimeStores() {
  return {
    memory: {
      load: (keys) => ({
        tier: keys.tier,
        userId: keys.userId,
        productId: keys.productId,
        sessionId: keys.sessionId,
        updatedAt: new Date().toISOString(),
        entities: {},
        corrections: [],
      }),
      save: jest.fn(),
    },
    provenance: {
      append: (row) => ({ id: 'prov-test', ...row }),
    },
    hitl: {
      enqueue: (row) => ({ id: 'appr-test', status: 'pending', ...row }),
      list: () => [],
      decide: (id) => ({ id, status: 'blocked_d26' }),
    },
  };
}

function mergeEntities(current, incoming) {
  return { ...(current || {}), ...(incoming || {}) };
}

function appendCorrection(record, correction) {
  return { ...record, corrections: [...(record.corrections || []), correction] };
}

function provenanceFromTurn(input) {
  return input;
}

function safeMemoryId(value, fallback) {
  return String(value || fallback || 's_test');
}

module.exports = {
  getProductService,
  ReleaseDatasetCache,
  PAYLOAD_BUCKET_KEYS,
  LONG_TERM_COMPONENT,
  EXTENSION_COMPONENT,
  getPayloadJql,
  getLongTermFundedQuery,
  getExtensionQuery,
  releaseDatasetService,
  releaseDatasetSync,
  fetchReleaseData,
  listFixVersionsForTeam,
  JiraConnector,
  ConfluenceConnector,
  GithubConnector,
  EmailConnector,
  completeChat,
  loadEnv,
  wrapTeamScope,
  getComponentQueries: jest.fn().mockReturnValue({}),
  buildEngineeringPayloadJql: jest.fn().mockReturnValue('project = ERA'),
  buildReleasePayloadJql: jest.fn().mockReturnValue('project = ERA'),
  getDeferredQuery: jest.fn().mockReturnValue('labels = x'),
  classifyFeature,
  buildFeatureRecord,
  assembleReleaseIntelligence,
  getSprintMetrics,
  buildStatusCategoryByName,
  extractFirstInProgressIso,
  computeFeatureTiming,
  computeFixVersionHygiene,
  countSelfReportedRisk,
  computeReleaseHealthVerdict,
  evaluateTeamRiskContext,
  computeRecentSprintVelocity: jest.fn().mockResolvedValue([]),
  computeRecentSprintVelocityFromTickets: jest.fn().mockReturnValue([]),
  computeLandingForecast: jest.fn().mockResolvedValue({}),
  computeLandingForecastFromTickets: jest.fn().mockReturnValue({}),
  loadAgentPack,
  runAgentTurn,
  createAgentRuntimeStores,
  mergeEntities,
  appendCorrection,
  provenanceFromTurn,
  safeMemoryId,
};
