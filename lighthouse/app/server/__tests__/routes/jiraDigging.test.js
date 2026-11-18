/*** Slice 2 FT — POST /api/jira-digging/prepare — read-only, per-request PAT ***/
jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Missing token' });
    req.username = 'test.user';
    next();
  },
}));
const request = require('supertest');
const app = require('../../index');

jest.mock('@portfolio-delivery-ops/shared', () => {
  const actual = jest.requireActual('@portfolio-delivery-ops/shared');
  return {
    ...actual,
    JiraConnector: jest.fn().mockImplementation(() => ({
      searchCount: jest.fn(),
      searchAll: jest.fn(),
    })),
  };
});

const { JiraConnector } = require('@portfolio-delivery-ops/shared');

function mockJira({ total = 5, issues = [{ key: 'ERA-1' }, { key: 'ERA-2' }] } = {}) {
  const inst = new JiraConnector();
  inst.searchCount.mockResolvedValue(total);
  inst.searchAll.mockResolvedValue(issues);
  JiraConnector.mockImplementation(() => inst);
  return inst;
}

const AUTH = { Authorization: 'Bearer fake-pat' };

describe('POST /api/jira-digging/prepare', () => {
  beforeEach(() => jest.clearAllMocks());

  test('200 returns ticketCount + sampleKeys for valid JQL', async () => {
    mockJira({ total: 2, issues: [{ key: 'ERA-1' }, { key: 'ERA-2' }] });
    const res = await request(app).post('/api/jira-digging/prepare').set(AUTH).send({ jql: 'project = ERA and status != Closed' });
    expect(res.status).toBe(200);
    expect(res.body.ticketCount).toBe(2);
    expect(res.body.sampleKeys).toEqual(['ERA-1', 'ERA-2']);
    expect(res.body.datasetId).toMatch(/^dig_/);
    expect(res.body.mode).toBe('cached-full');
    expect(res.body.cachedDir).toBeTruthy();
    expect(res.body.jqlHash).toMatch(/^[a-f0-9]{12}$/);
  });

  test('400 when jql missing', async () => {
    const res = await request(app).post('/api/jira-digging/prepare').set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/jql is required/i);
  });

  test('400 when result over cap 10000', async () => {
    mockJira({ total: 12000, issues: [] });
    const res = await request(app).post('/api/jira-digging/prepare').set(AUTH).send({ jql: 'project = ERA' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  test('401 when no Bearer PAT', async () => {
    const res = await request(app).post('/api/jira-digging/prepare').send({ jql: 'project = ERA' });
    expect(res.status).toBe(401);
  });

  test('500 surfaces JIRA failure message', async () => {
    const inst = new JiraConnector();
    const err = new Error('JQL invalid');
    err.statusCode = 400;
    inst.searchCount.mockRejectedValue(err);
    JiraConnector.mockImplementation(() => inst);
    const res = await request(app).post('/api/jira-digging/prepare').set(AUTH).send({ jql: 'bogus =' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
