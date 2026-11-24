const fs = require('fs');
const path = require('path');

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
jest.mock('../../services/oncallDashboardV2', () => ({
  getDashboard: jest.fn().mockResolvedValue({
    teamId: 'ndb',
    timeframe: '2Q',
    notConfigured: false,
    hero: { open: { count: 5, jql: 'project = OnCall' }, agedOpen: { count: 1, jql: 'aged' } },
    workflow: {},
    gapTaxonomy: { duds: { count: 0 }, ndbGaps: { count: 0 }, otherTeamGaps: { count: 0 } },
    health: {},
    asOf: new Date().toISOString(),
  }),
  TIMEFRAMES: { '7d': 7, '15d': 15, '1M': 30, '1Q': 90, '2Q': 180, '1Y': 365, '18M': 540, Overall: null },
  timeframeToDays: jest.fn(),
  timeframeClause: jest.fn(),
  buildTimeframeHeroQueries: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { getDashboard } = require('../../services/oncallDashboardV2');
const { checkKpiViewAuthorization } = require('../../services/userService');

const AUTH = { Authorization: 'Bearer fake-pat' };

describe('GET /api/jira/oncalls → v2 only', () => {
  beforeEach(() => jest.clearAllMocks());

  test('200 returns v2 dashboard success with hero counts', async () => {
    const fakeV2 = {
      teamId: 'ndb',
      timeframe: '2Q',
      hero: { open: { count: 12, jql: 'project = OnCall AND statusCategory != Done' }, agedOpen: { count: 3, jql: 'aged' }, closedInWindow: { count: 20, jql: 'closed' } },
      workflow: { needInfo: { count: 1 }, waiting: { count: 2 } },
      gapTaxonomy: { duds: { count: 1 }, ndbGaps: { count: 2 }, otherTeamGaps: { count: 0 } },
      health: { mttrMedian: 2 },
      asOf: new Date().toISOString(),
    };
    getDashboard.mockResolvedValueOnce(fakeV2);

    const res = await request(app).get('/api/jira/oncalls').set(AUTH).query({ teamId: 'ndb', timeframe: '2Q' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.teamId).toBe('ndb');
    expect(res.body.timeframe).toBe('2Q');
    expect(res.body.hero.open.count).toBe(12);
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'ndb', timeframe: '2Q' }));
  });

  test('defaults timeframe to 2Q when missing', async () => {
    const res = await request(app).get('/api/jira/oncalls').set(AUTH).query({ teamId: 'ndb' });
    expect(res.status).toBe(200);
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ timeframe: '2Q' }));
  });

  test('GET /api/jira/oncalls/v2 explicit route also goes to V2', async () => {
    const res = await request(app).get('/api/jira/oncalls/v2').set(AUTH).query({ teamId: 'ndb', timeframe: '7d' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ timeframe: '7d' }));
  });

  test('POST /api/jira/oncalls/refresh uses V2', async () => {
    const res = await request(app).post('/api/jira/oncalls/refresh').set(AUTH).send({ teamId: 'ndb', timeframe: '1Q' });
    expect(res.status).toBe(200);
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ timeframe: '1Q' }));
  });

  test('kpi_view gate applies to GET /api/jira/oncalls', async () => {
    checkKpiViewAuthorization.mockReturnValueOnce({ authorized: false });
    const res = await request(app).get('/api/jira/oncalls').set(AUTH).query({ teamId: 'ndb', timeframe: '7d' });
    expect(res.status).toBe(403);
    expect(getDashboard).not.toHaveBeenCalled();
  });
});

describe('V1 removal — legacy redirect check', () => {
  test('App.js has /oncalls-legacy → /oncalls redirect', () => {
    const appPath = path.join(__dirname, '../../..', 'client/src/App.js');
    const content = fs.readFileSync(appPath, 'utf8');
    expect(content).toContain('/oncalls-legacy');
    expect(content).toContain('Navigate to="/oncalls"');
    // ensure legacy is redirect, not a page component
    expect(content).not.toMatch(/\/oncalls-legacy[^]*OncallsPage/);
  });

  test('App.js canonical /oncalls route renders OncallsV2Page', () => {
    const appPath = path.join(__dirname, '../../..', 'client/src/App.js');
    const content = fs.readFileSync(appPath, 'utf8');
    expect(content).toContain('path="/oncalls"');
    expect(content).toContain('OncallsV2Page');
  });
});

describe('V1 removal — OncallsPage file not exists', () => {
  test('client/src/components/OncallsPage.js deleted', () => {
    const legacyPage = path.join(__dirname, '../../..', 'client/src/components/OncallsPage.js');
    expect(fs.existsSync(legacyPage)).toBe(false);
  });

  test('client/src/hooks/useOncalls.js deleted', () => {
    const legacyHook = path.join(__dirname, '../../..', 'client/src/hooks/useOncalls.js');
    expect(fs.existsSync(legacyHook)).toBe(false);
  });

  test('client/src/__tests__/components/OncallsPage.pulse.test.js deleted', () => {
    const legacyTest = path.join(__dirname, '../../..', 'client/src/__tests__/components/OncallsPage.pulse.test.js');
    expect(fs.existsSync(legacyTest)).toBe(false);
  });

  test('server routes/jira/oncalls.js does not import legacy oncallService', () => {
    const routePath = path.join(__dirname, '../../routes/jira/oncalls.js');
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).not.toMatch(/oncallService/);
    expect(content).toContain('oncallDashboardV2');
  });
});

describe('oncallBlurbService uses oncallConfigResolve', () => {
  test('imports oncallConfigResolve and not legacy oncallService', () => {
    const svcPath = path.join(__dirname, '../../services/oncallBlurbService.js');
    const content = fs.readFileSync(svcPath, 'utf8');
    expect(content).toContain('oncallConfigResolve');
    expect(content).toContain('resolveRuntimeConfig');
    // must not depend on legacy oncallService (would hardcode NDB filter)
    expect(content).not.toMatch(/require\(['"]\.\/oncallService['"]\)/);
    // ensure it actually calls resolveRuntimeConfig(teamId)
    expect(content).toMatch(/resolveRuntimeConfig\s*\(\s*teamId/);
  });

  test('oncallBlurbService buildOncallBlurbs resolves team config via oncallConfigResolve', () => {
    const svc = require('../../services/oncallBlurbService');
    expect(typeof svc.buildOncallBlurbs).toBe('function');
    // Verify module required oncallConfigResolve at load time (jest mock not overriding actual fs read check above)
    const src = fs.readFileSync(path.join(__dirname, '../../services/oncallBlurbService.js'), 'utf8');
    expect(src).toMatch(/const\s*\{\s*resolveRuntimeConfig\s*\}\s*=\s*require\(['"]\.\/oncallConfigResolve['"]\)/);
  });
});
