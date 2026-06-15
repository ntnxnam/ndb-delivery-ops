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
};
