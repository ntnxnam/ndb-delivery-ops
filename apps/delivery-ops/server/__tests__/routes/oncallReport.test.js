jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, _res, next) => {
    req.jiraToken = 'test-token';
    req.username = 'test.user';
    next();
  },
}));
jest.mock('../../services/userService', () => ({
  checkKpiViewAuthorization: jest.fn().mockReturnValue({ authorized: true }),
}));
jest.mock('../../services/emailService', () => ({
  sendEmailDirect: jest.fn().mockResolvedValue({ messageId: '<msg-1>', accepted: ['a@nutanix.com'], rejected: [] }),
}));
jest.mock('../../services/oncallDashboardV2', () => ({
  TIMEFRAMES: { '7d': 7, '15d': 15, '1M': 30, '1Q': 90, '2Q': 180, '1Y': 365, '18M': 540, Overall: null },
  getDashboard: jest.fn(),
  timeframeToDays: jest.fn((tf) => ({ Overall: null, '7d': 7 }[tf] ?? 7)),
  timeframeClause: jest.fn((field, tf) => (tf === 'Overall' ? null : `${field} >= -7d`)),
}));
jest.mock('../../services/oncallConfigResolve', () => ({
  resolveRuntimeConfig: jest.fn((teamId) => ({ teamId: teamId || 'ndb', baseScopeJql: 'filter = NDB-OnCalls' })),
  loadConfig: jest.fn(() => ({})),
}));

const request = require('supertest');
const app = require('../../index');
const { sendEmailDirect } = require('../../services/emailService');
const { getDashboard } = require('../../services/oncallDashboardV2');

const AUTH = { Authorization: 'Bearer fake-pat' };

function fakeDashboard(overrides = {}) {
  return {
    teamId: 'ndb',
    timeframe: '7d',
    hero: { open: { count: 5, jql: 'project=OnCall' }, agedOpen: { count: 2, jql: 'project=OnCall AND aged' } },
    health: { mttrMedian: 3, p90: 10, throughput: 8, net: 1 },
    gapTaxonomy: { duds: { count: 1, jql: 'duds' }, ndbGaps: { count: 2 }, otherTeamGaps: { count: 1 } },
    openTickets: [{ key: 'ONCALL-1', summary: 's', status: 'Open', priority: 'Major', assignee: 'Alice', ageDays: 5 }],
    closedStacksPreview: [],
    rag: { level: 'YELLOW', why: '2 aged' },
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

describe('POST /api/jira/oncalls/report', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDashboard.mockResolvedValue(fakeDashboard());
  });

  test('preview returns html with hero counts and JQL links (dashboard passthrough)', async () => {
    const dash = fakeDashboard();
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: dash });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preview).toBe(true);
    expect(res.body.data.html).toContain('OnCalls — ndb');
    expect(res.body.data.html).toContain('Heroes');
    expect(res.body.data.subject).toMatch(/\[OnCalls 7d\]/);
    expect(sendEmailDirect).not.toHaveBeenCalled();
    expect(getDashboard).not.toHaveBeenCalled();
  });

  test('send calls sendEmailDirect and returns messageId (mocked)', async () => {
    const dash = fakeDashboard();
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: '7d', previewOnly: false, dashboard: dash });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.messageId).toBe('<msg-1>');
    expect(sendEmailDirect).toHaveBeenCalledTimes(1);
  });

  test('when dashboard missing, server re-fetches via getDashboard', async () => {
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: '7d', previewOnly: true });
    expect(res.status).toBe(200);
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'ndb', timeframe: '7d' }));
    expect(res.body.data.html).toContain('OnCalls');
  });

  test('Overall timeframe does not include resolved >= clause — Overall normalized and hero.open.jql has no date', async () => {
    const dashOverall = fakeDashboard({ timeframe: 'Overall', hero: { open: { count: 10, jql: 'project = OnCall AND statusCategory != Done' }, agedOpen: { count: 3 }, closedInWindow: { count: 50, jql: 'project = OnCall AND statusCategory = Done' } } });
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: 'Overall', previewOnly: true, dashboard: dashOverall });
    expect(res.status).toBe(200);
    expect(res.body.data.timeframe).toBe('Overall');
    // open hero JQL must not contain resolved >= (Overall has no date clause)
    expect(res.body.data.html).not.toMatch(/resolved\s*>=/i);
    // hero open JQL proof is present
    expect(dashOverall.hero.open.jql).not.toMatch(/resolved\s*>=/i);
  });

  test('lowercase overall normalizes to Overall', async () => {
    const dash = fakeDashboard({ timeframe: 'Overall' });
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: 'overall', previewOnly: true, dashboard: dash });
    expect(res.status).toBe(200);
    expect(res.body.data.timeframe).toBe('Overall');
  });

  test('notConfigured dashboard renders banner', async () => {
    const dash = fakeDashboard({ notConfigured: true, hero: { open: { count: 0 }, agedOpen: { count: 0 } } });
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'unknown-team', timeframe: '7d', previewOnly: true, dashboard: dash });
    expect(res.status).toBe(200);
    expect(res.body.data.html).toContain('OnCalls not configured for team unknown-team');
    expect(res.body.data.html).toContain('Add OnCalls KPI in Admin');
  });

  test('413 when dashboard payload too large', async () => {
    const big = fakeDashboard();
    big.openTickets = Array.from({ length: 5000 }, (_, i) => ({ key: `ONCALL-${i}`, summary: 'x'.repeat(200) }));
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: big });
    expect(res.status).toBe(413);
  });

  test('413 when aiConcern too long', async () => {
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: fakeDashboard(), aiConcern: 'x'.repeat(5001) });
    expect(res.status).toBe(413);
  });
});
