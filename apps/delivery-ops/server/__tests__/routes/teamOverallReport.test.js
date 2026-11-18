jest.mock('@portfolio-delivery-ops/shared', () => require('../../__mocks__/@portfolio-delivery-ops/shared.js'));

const request = require('supertest');
const app = require('../../index');

jest.mock('../../utils/jiraClient', () => ({
  getJira: jest.fn(),
}));

jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, _res, next) => {
    req.jiraToken = 'test-token';
    req.username = 'test.user';
    next();
  },
}));

jest.mock('../../services/authService', () => ({
  checkFeatureAccess: jest.fn().mockReturnValue({ authorized: true }),
  checkAuthorization: jest.fn().mockReturnValue({ authorized: true }),
}));

const { getJira } = require('../../utils/jiraClient');

function fakeJira(issues = []) {
  const get = jest.fn(async (url, opts = {}) => {
    if (url === '/rest/api/2/search') {
      return { data: { total: issues.length, issues } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  return { get };
}

const AUTH = { Authorization: 'Bearer fake-pat', 'X-Username': 'test.user' };

const SAMPLE_ISSUES = [
  { key: 'ERA-1', fields: { summary: 'Test issue 1', issuetype: { name: 'Story' }, status: { name: 'Closed' }, priority: { name: 'Major' }, assignee: { displayName: 'Alice' }, created: '2025-04-01T00:00:00Z', updated: '2025-05-01T00:00:00Z', resolved: '2025-05-01T00:00:00Z', storyPoints: 5, fixVersions: [{ name: 'NDB-2.12' }], project: { key: 'ERA' } } },
  { key: 'ERA-2', fields: { summary: 'Test issue 2', issuetype: { name: 'Bug' }, status: { name: 'Closed' }, priority: { name: 'Minor' }, assignee: { displayName: 'Bob' }, created: '2025-04-15T00:00:00Z', updated: '2025-05-15T00:00:00Z', resolved: '2025-05-15T00:00:00Z', storyPoints: 3, fixVersions: [{ name: 'NDB-2.12' }], project: { key: 'ERA' } } },
];

describe('GET /api/reports/team-overall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const svc = require('../../services/teamOverallReportService');
    svc.clearCache();
  });

  test('200 returns DTO with count>0 for valid params', async () => {
    getJira.mockResolvedValue(fakeJira(SAMPLE_ISSUES));
    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.issueCount).toBe(2);
    expect(res.body.meta.teamId).toBe('ndb');
    expect(res.body.aggregation.totalGroups).toBeGreaterThan(0);
    expect(res.body.kpis.totalIssues).toBe(2);
  });

  test('400 for invalid teamId', async () => {
    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'nonexistent', periodType: 'quarter', quarter: '2025-Q2' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('400 for missing period params', async () => {
    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('cache: second call returns isCached true', async () => {
    getJira.mockResolvedValue(fakeJira(SAMPLE_ISSUES));
    const res1 = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false' });
    expect(res1.status).toBe(200);
    expect(res1.body.meta.isCached).toBe(false);

    const res2 = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false' });
    expect(res2.status).toBe(200);
    expect(res2.body.meta.isCached).toBe(true);
  });

  test('forceRefresh bypasses cache', async () => {
    getJira.mockResolvedValue(fakeJira(SAMPLE_ISSUES));
    await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false' });

    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false', forceRefresh: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.meta.isCached).toBe(false);
  });

  test('issuesSample includes sourceProject', async () => {
    getJira.mockResolvedValue(fakeJira(SAMPLE_ISSUES));
    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false', forceRefresh: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.issuesSample).toHaveLength(2);
    expect(res.body.issuesSample[0]).toHaveProperty('sourceProject');
    expect(res.body.issuesSample[0]).toHaveProperty('url');
    expect(res.body.issuesSample[0].url).toContain('jira.nutanix.com');
  });

  test('companionProjects present in meta', async () => {
    getJira.mockResolvedValue(fakeJira(SAMPLE_ISSUES));
    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false', forceRefresh: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.meta.companionProjects).toBeDefined();
    expect(Array.isArray(res.body.meta.companionProjects)).toBe(true);
  });

  test('JQL uses issuetype not type', async () => {
    getJira.mockResolvedValue(fakeJira(SAMPLE_ISSUES));
    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false', forceRefresh: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.meta.jqlExecuted).toContain('issuetype');
    expect(res.body.meta.jqlExecuted).not.toMatch(/\btype\s*=/);
  });

  test('no hardcoded NDB-2. version strings in JQL', async () => {
    getJira.mockResolvedValue(fakeJira(SAMPLE_ISSUES));
    const res = await request(app)
      .get('/api/reports/team-overall')
      .set(AUTH)
      .query({ teamId: 'ndb', periodType: 'quarter', quarter: '2025-Q2', inclusionMode: 'closed', groupBy: 'issuetype', includeCompanions: 'false', forceRefresh: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.meta.jqlExecuted).not.toMatch(/NDB-2\./);
  });
});

describe('POST /api/reports/team-overall/invalidate', () => {
  test('returns success', async () => {
    const res = await request(app)
      .post('/api/reports/team-overall/invalidate')
      .set(AUTH)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
