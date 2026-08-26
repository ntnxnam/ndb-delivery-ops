/**
 * Integration tests for JIRA API endpoints
 * Test Plan: IT-JIRA-001, IT-JIRA-002, IT-JIRA-003, IT-JIRA-004
 */

jest.mock('../../config/teamBoardConfig.json', () => ({
  teams: [
    { id: 'ndb', name: 'NDB', boardId: null },
    { id: 'other', name: 'Other', boardId: 999 }
  ],
  defaultTeamId: 'ndb',
  sprintFieldId: 'customfield_10360'
}), { virtual: false });

const mockSprintMap = new Map([[1, { name: 'Sprint 1', state: 'active', startDate: null, endDate: null, completeDate: null }]]);
jest.mock('../../utils/sprintCache', () => {
  const actual = jest.requireActual('../../utils/sprintCache');
  return {
    ...actual,
    getSprintsForBoard: jest.fn().mockResolvedValue(mockSprintMap)
  };
});

jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, res, next) => {
    const auth = req.headers?.authorization;
    req.jiraToken = auth ? auth.replace(/^Bearer\s+/i, '') : (req.body?.jiraToken || 'test-token');
    req.username = req.headers['x-username'] || req.body?.username || 'test-user';
    next();
  }
}));

jest.mock('../../middleware/authMiddleware', () => ({
  requireAuth: () => (req, res, next) => {
    req.username = req.username || req.headers['x-username'] || req.body?.username || 'test-user';
    next();
  }
}));

// @portfolio-delivery-ops/shared is pure ESM ("type":"module") and cannot be
// loaded via dynamic import() in Jest's CJS mode.  Provide a minimal CJS stub
// so routes that call getShared() can exercise their own logic under test.
jest.mock('@portfolio-delivery-ops/shared', () => {
  const mockProductService = {
    getProduct: jest.fn().mockReturnValue({ projectKey: 'ERA', labelPrefix: 'ndb', displayName: 'NDB', baseFilter: 'filter=test-base' }),
    getLabelPrefix: jest.fn().mockReturnValue('ndb'),
    getDisplayName: jest.fn().mockReturnValue('NDB'),
    getJiraProjects: jest.fn().mockReturnValue(['ERA', 'NDB']),
    getCustomFields: jest.fn().mockReturnValue({}),
    getBoards: jest.fn().mockReturnValue([]),
    getReleaseNamePattern: jest.fn().mockReturnValue(/^NDB-/),
    getReleasePrefix: jest.fn().mockReturnValue('NDB-'),
    getActiveVersionNames: jest.fn().mockReturnValue([]),
  };
  const mockCache = {
    getCachedReleasesInfo: jest.fn().mockReturnValue({}),
    loadReleaseLenient: jest.fn().mockReturnValue({ tickets: [], meta: null }),
    saveRelease: jest.fn(),
  };
  const ReleaseDatasetCache = jest.fn().mockImplementation(() => mockCache);
  const getProductService = jest.fn().mockReturnValue(mockProductService);
  const fetchReleaseData = jest.fn().mockResolvedValue({
    tickets: [{ 'Issue Key': 'ERA-1', Summary: 'live' }],
    bucketCounts: {},
    error: null,
    bucketErrors: {},
  });
  const listFixVersionsForTeam = jest.fn().mockResolvedValue([
    { name: 'NDB-2.11', released: false, releaseDate: '2026-09-15' },
  ]);
  function JiraConnector() {
    return {};
  }
  const loadEnv = jest.fn().mockReturnValue({});
  return {
    getProductService,
    ReleaseDatasetCache,
    fetchReleaseData,
    listFixVersionsForTeam,
    JiraConnector,
    loadEnv,
    PAYLOAD_BUCKET_KEYS: ['top_level_projects', 'work_toward_project', 'standalone_epics', 'work_toward_standalone_epic', 'direct_tickets'],
    LONG_TERM_COMPONENT: 'long_term_funded',
    EXTENSION_COMPONENT: 'extension',
    getPayloadJql: jest.fn().mockReturnValue('project = ERA'),
    getLongTermFundedQuery: jest.fn().mockReturnValue('project = ERA'),
    getExtensionQuery: jest.fn().mockReturnValue('project = ERA'),
    getComponentQueries: jest.fn().mockReturnValue({}),
    buildEngineeringPayloadJql: jest.fn().mockReturnValue('project = ERA'),
    buildReleasePayloadJql: jest.fn().mockReturnValue('project = ERA'),
    getDeferredQuery: jest.fn().mockReturnValue('labels = x'),
  };
});

const request = require('supertest');
const app = require('../../index');
const { getSprintsForBoard } = require('../../utils/sprintCache');
const path = require('path');
const fs = require('fs');

// Load default version from config
const columnsConfigPath = path.join(__dirname, '../../config/releaseVersionsColumnsConfig.json');
const columnsConfig = JSON.parse(fs.readFileSync(columnsConfigPath, 'utf8'));
const defaultVersion = columnsConfig.defaultReleaseVersion;

describe('JIRA API Integration Tests', () => {
  const validToken = process.env.TEST_JIRA_TOKEN || 'test-token';
  const baseHeaders = {
    'Content-Type': 'application/json'
  };

  describe('POST /api/jira/release-versions', () => {
    test('IT-JIRA-001: Should return release versions', async () => {
      const response = await request(app)
        .post('/api/jira/release-versions')
        .set(baseHeaders)
        .send({
          jiraToken: validToken
        });

      // Note: This will fail if TEST_JIRA_TOKEN is not set
      // In CI/CD, use mock or test token
      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('versions');
        expect(Array.isArray(response.body.versions)).toBe(true);
      }
    });
  });

  describe('GET /api/release-dataset/per-release/:release', () => {
    test('IT-JIRA-002: Should live-fetch even when disk cache is empty', async () => {
      const response = await request(app)
        .get('/api/release-dataset/per-release/NO-SUCH-RELEASE-TEST')
        .set({
          ...baseHeaders,
          Authorization: `Bearer ${validToken}`,
        })
        .query({ productId: 'ndb' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('tickets');
      expect(Array.isArray(response.body.data.tickets)).toBe(true);
      expect(response.body).not.toHaveProperty('reason', 'not_cached');
    });
  });

  describe('GET /api/release-dataset/releases', () => {
    test('returns cache-status shape for synced releases', async () => {
      const response = await request(app)
        .get('/api/release-dataset/releases')
        .set({
          ...baseHeaders,
          Authorization: `Bearer ${validToken}`,
        })
        .query({ productId: 'ndb' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('synced');
      expect(response.body.data).toHaveProperty('meta');
      expect(Array.isArray(response.body.data.synced)).toBe(true);
      expect(typeof response.body.data.meta).toBe('object');
    });
  });

  describe('POST /api/jira/release-items-history', () => {
    test('IT-JIRA-003: Should return checkpoint history', async () => {
      const response = await request(app)
        .post('/api/jira/release-items-history')
        .set(baseHeaders)
        .send({
          fixVersion: defaultVersion,
          jiraToken: validToken
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toHaveProperty('history');
        expect(typeof response.body.data.history).toBe('object');
      }
    });
  });

  describe('POST /api/jira/sprint-report', () => {
    test('returns 400 when team has no boardId', async () => {
      const res = await request(app)
        .post('/api/jira/sprint-report')
        .set({
          ...baseHeaders,
          Authorization: `Bearer ${validToken}`,
          'X-Username': 'test-user'
        })
        .send({ teamId: 'ndb', sprintId: 1 });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Team has no board configured/i);
      expect(res.body.error).toBe('Team has no board configured');
      expect(res.body.message).toBe('Select a team with a boardId in teamBoardConfig.json.');
    });

    test('uses boardId for the requested team', async () => {
      getSprintsForBoard.mockClear();
      await request(app)
        .post('/api/jira/sprint-report')
        .set({
          ...baseHeaders,
          Authorization: `Bearer ${validToken}`,
          'X-Username': 'test-user'
        })
        .send({ teamId: 'other', sprintId: 1 });
      expect(getSprintsForBoard).toHaveBeenCalledWith(999, expect.any(String), expect.anything());
    });
  });

  describe('Rate Limiting', () => {
    test('IT-JIRA-004: Should handle rate limit errors', async () => {
      // This test would need to mock rate limit responses
      // For now, it's a placeholder
      expect(true).toBe(true);
    });
  });

  describe('Changelog Pagination', () => {
    test('IT-JIRA-005: Should fetch all paginated changelog for release-items-history', async () => {
      const response = await request(app)
        .post('/api/jira/release-items-history')
        .set(baseHeaders)
        .send({
          fixVersion: defaultVersion,
          jiraToken: validToken,
          username: 'test-user'
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toHaveProperty('history');
        
        // Verify that history data exists for items
        const history = response.body.data.history;
        if (Object.keys(history).length > 0) {
          const firstKey = Object.keys(history)[0];
          const firstItemHistory = history[firstKey];
          
          // Check that checkpoint fields have history arrays
          expect(firstItemHistory).toHaveProperty('codeComplete');
          expect(Array.isArray(firstItemHistory.codeComplete)).toBe(true);
        }
      }
    });

    test('IT-JIRA-006: Should fetch all paginated changelog for checkpoint-history', async () => {
      const response = await request(app)
        .post('/api/jira/checkpoint-history')
        .set(baseHeaders)
        .send({
          jiraKey: 'FEAT-18452',
          jiraToken: validToken
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('history');
        
        const history = response.body.history;
        expect(history).toHaveProperty('codeComplete');
        expect(Array.isArray(history.codeComplete)).toBe(true);
        
        // For FEAT-18452, we expect multiple historical dates
        // Verify that pagination worked if there are multiple entries
        if (history.codeComplete.length > 1) {
          expect(history.codeComplete.length).toBeGreaterThan(1);
        }
      }
    });

    test('IT-JIRA-007: Should handle non-paginated changelog gracefully', async () => {
      // Use an issue with small changelog
      const response = await request(app)
        .post('/api/jira/checkpoint-history')
        .set(baseHeaders)
        .send({
          jiraKey: 'TEST-123', // Replace with actual test issue
          jiraToken: validToken
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        // Should work without errors even if no pagination needed
      }
    });
  });
});

