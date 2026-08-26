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
  }),
  getLabelPrefix: jest.fn().mockReturnValue('ndb'),
  getDisplayName: jest.fn().mockReturnValue('NDB'),
  getJiraProjects: jest.fn().mockReturnValue(['ERA', 'NDB']),
  getCustomFields: jest.fn().mockReturnValue({}),
  getBoards: jest.fn().mockReturnValue([]),
  getReleaseNamePattern: jest.fn().mockReturnValue(/^NDB-/),
};

const mockCache = {
  getCachedReleasesInfo: jest.fn().mockReturnValue({}),
  loadReleaseLenient: jest.fn().mockReturnValue({ tickets: [], meta: null }),
  saveRelease: jest.fn(),
  computeReleaseJqlHash: jest.fn().mockReturnValue('test-hash'),
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
  fetchReleaseData: jest.fn().mockResolvedValue([]),
};
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
    phase: 'Unknown',
    criticalRisks: [],
    assignee: 'Unassigned',
    tpmOwner: null,
    statusUpdateAgeDays: null,
    dates: { codeComplete: null, commitGate: null, promotionGate: null },
    buckets: ['watching'],
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

function countSelfReportedRisk() {
  return { red: 0, yellow: 0, green: 0, notSet: 0 };
}

function computeReleaseHealthVerdict() {
  return { verdict: 'GREEN', rule: 6, reason: 'test stub' };
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
  classifyFeature,
  buildFeatureRecord,
  assembleReleaseIntelligence,
  getSprintMetrics,
  countSelfReportedRisk,
  computeReleaseHealthVerdict,
};
