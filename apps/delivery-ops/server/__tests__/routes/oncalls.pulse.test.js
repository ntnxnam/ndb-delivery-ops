/** Regression: pulse flatlined but route test mocked getDashboard, so 200 always passed even with empty series */
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
jest.mock('../../utils/jiraClient', () => ({
  getJira: jest.fn(),
  searchPages: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../utils/teamConfig', () => {
  const actual = jest.requireActual('../../utils/teamConfig');
  return {
    ...actual,
    getTeamBaseFilter: jest.fn(() => '(project in (ERA, NDBECO) OR (project in (ENG, FEAT, ONCALL) AND component in (NDB)))'),
    loadKpiConfigSync: jest.fn(() => ({
      ndb: [{ name: 'OnCalls', baseQuery: 'project = ONCALL', order: 4, locked: true }],
    })),
    getKpisForTeam: jest.fn((teams, teamId) => ({ kpis: teams[teamId] || [], normalizedTeamId: teamId })),
    normalizeTeamId: (s) => String(s || '').trim().toLowerCase(),
    loadTeamBoardConfig: jest.fn(() => ({
      teams: [{ id: 'ndb', components: ['NDB', 'Era'], leader_outlook_dls: ['Team-Karan-Singh-Org'], baseFilter: 'x' }],
      defaultTeamId: 'ndb',
    })),
    getTeamById: jest.fn(() => ({ id: 'ndb', components: ['NDB', 'Era'], leader_outlook_dls: ['Team-Karan-Singh-Org'] })),
  };
});

const request = require('supertest');
const app = require('../../index');
const { getJira } = require('../../utils/jiraClient');

const AUTH = { Authorization: 'Bearer fake-pat' };

function fakeJiraWithCounts() {
  return {
    searchCount: jest.fn((jql) => {
      if (/project\s*=\s*ONCALL/i.test(jql)) {
        if (/created\s*>=/i.test(jql)) return Promise.resolve(4);
        if (/resolved\s*>=/i.test(jql) || /resolved\s*<=/i.test(jql)) return Promise.resolve(3);
        if (/statusCategory\s*!=\s*Done/i.test(jql)) return Promise.resolve(10);
        if (/statusCategory\s*=\s*Done/i.test(jql)) return Promise.resolve(7);
        if (/status changed to/i.test(jql)) return Promise.resolve(0);
        return Promise.resolve(5);
      }
      return Promise.resolve(0);
    }),
  };
}

describe('GET /api/jira/oncalls pulse regression', () => {
  beforeEach(() => jest.clearAllMocks());

  test('200 and pulse.series not flatlined for 7d', async () => {
    getJira.mockResolvedValue(fakeJiraWithCounts());
    const res = await request(app).get('/api/jira/oncalls').set(AUTH).query({ teamId: 'ndb', timeframe: '7d' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pulse).toBeDefined();
    expect(Array.isArray(res.body.pulse.series)).toBe(true);
    const total = res.body.pulse.series.reduce((s, w) => s + (w.created?.count || 0) + (w.closed?.count || 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(res.body.pulse.seriesOutflowMode).toBe('resolutiondate');
    // baseScopeJql must be team-scoped without impossible project intersection
    expect(res.body.baseScopeJql).toMatch(/project\s*=\s*ONCALL/i);
    expect(res.body.baseScopeJql).not.toMatch(/project in \(ERA, NDBECO\) OR \(project in \(ENG, FEAT, ONCALL\)/);
  });

  test('Overall also returns non-flat pulse', async () => {
    getJira.mockResolvedValue(fakeJiraWithCounts());
    const res = await request(app).get('/api/jira/oncalls').set(AUTH).query({ teamId: 'ndb', timeframe: 'Overall' });
    expect(res.status).toBe(200);
    expect(res.body.pulse.series.length).toBeGreaterThan(2);
  });
});
