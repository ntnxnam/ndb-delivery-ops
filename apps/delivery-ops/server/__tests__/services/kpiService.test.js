jest.mock('axios');
jest.mock('../../utils/teamConfig', () => ({
  loadKpiConfigSync: jest.fn(),
  getKpisForTeam: jest.fn(),
  getTeamBaseFilter: jest.fn()
}));
jest.mock('../../utils/jiraRouteHelpers', () => ({
  getReleaseBaseFilter: jest.fn(),
  upstreamStatus: jest.fn((s) => s)
}));
jest.mock('@portfolio-delivery-ops/shared', () => ({
  buildWorkItemsJql: jest.fn(() => 'MOCK_JQL'),
  buildWorkItemsUrl: jest.fn(() => 'https://jira/mock/work-items'),
  buildAllTicketsUrl: jest.fn(() => 'https://jira/mock/all-tickets'),
  isValidProjectKey: jest.fn(() => true),
  loadEnv: () => ({ jiraPat: '', jiraTimeoutMs: 30000 }),
  JiraConnector: class {
    get(path, options = {}) {
      return require('axios').get(path, options);
    }
    async searchCount(jql) {
      const res = await this.get('/rest/api/2/search', { params: { jql, maxResults: 0 } });
      return res.data?.total ?? 0;
    }
  },
}));
jest.mock('../../utils/logger', () => ({
  jira: { fetch: jest.fn(), issueBreakdown: jest.fn() }
}));

const axios = require('axios');
const { loadKpiConfigSync, getKpisForTeam, getTeamBaseFilter } = require('../../utils/teamConfig');
const { getReleaseBaseFilter } = require('../../utils/jiraRouteHelpers');
const {
  resolveKpiJql,
  buildKpiCombinedJql,
  appendDeferredExclusion,
  buildReleaseKpiCombinedJql,
  categorizeStatus,
  getKpiResult,
  getIssueBreakdown
} = require('../../services/kpiService');

describe('kpiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('UT-KPI-001: resolveKpiJql normalizes type= to issuetype=', async () => {
    const jql = await resolveKpiJql('type = Bug AND status = Open', 'token', {});
    expect(jql).toBe('issuetype= Bug AND status = Open');
  });

  test('UT-KPI-002: buildKpiCombinedJql combines team base and KPI query', async () => {
    getTeamBaseFilter.mockReturnValue('project = ERA');
    const jql = await buildKpiCombinedJql('ndb', 'type = Bug', 'token', {});
    expect(jql).toBe('(project = ERA) AND (issuetype= Bug)');
  });

  test('UT-KPI-003: appendDeferredExclusion appends release deferred clause', () => {
    const out = appendDeferredExclusion('project = ERA', 'NDB-2.11');
    expect(out).toContain('labels != "ndb-2.11-deferred"');
  });

  test('UT-KPI-004: buildReleaseKpiCombinedJql uses release base filter', async () => {
    getReleaseBaseFilter.mockReturnValue('filter = Release-Base');
    const out = await buildReleaseKpiCombinedJql('NDB-2.11', 'type = Bug', 'token', {}, 'ndb');
    expect(out).toBe('filter = Release-Base and (issuetype= Bug) and status != Closed');
  });

  test('UT-KPI-005: categorizeStatus maps known statuses', () => {
    expect(categorizeStatus('Done')).toBe('Done');
    expect(categorizeStatus('Resolved')).toBe('To Be Verified');
    expect(categorizeStatus('Blocked')).toBe('Blocked');
    expect(categorizeStatus('Some New Status')).toBe('Other');
  });

  test('UT-KPI-006: getKpiResult returns count KPI result', async () => {
    loadKpiConfigSync.mockReturnValue({});
    getKpisForTeam.mockReturnValue({
      normalizedTeamId: 'ndb',
      kpis: [{ id: 'kpi1', baseQuery: 'type = Bug', displayType: 'count' }]
    });
    getTeamBaseFilter.mockReturnValue('project = ERA');
    axios.get.mockResolvedValue({ data: { total: 7 } });

    const out = await getKpiResult({ token: 'token', teamId: 'ndb', kpiId: 'kpi1' });
    expect(out.total).toBe(7);
    expect(out.combinedJql).toContain('project = ERA');
  });

  test('UT-KPI-007: getKpiResult returns list KPI result', async () => {
    loadKpiConfigSync.mockReturnValue({});
    getKpisForTeam.mockReturnValue({
      normalizedTeamId: 'ndb',
      kpis: [{ id: 'kpi2', baseQuery: 'type = Bug', displayType: 'list' }]
    });
    getTeamBaseFilter.mockReturnValue(null);
    axios.get.mockResolvedValue({
      data: {
        total: 1,
        issues: [{ key: 'ERA-1', fields: { summary: 'S', priority: { name: 'P1' }, assignee: { displayName: 'A' }, status: { name: 'Open' } } }]
      }
    });

    const out = await getKpiResult({ token: 'token', teamId: 'ndb', kpiId: 'kpi2' });
    expect(out.total).toBe(1);
    expect(out.issues[0]).toEqual({ key: 'ERA-1', summary: 'S', priority: 'P1', assignee: 'A', status: 'Open' });
  });

  test('UT-KPI-008: getIssueBreakdown returns client-processing shape for single key', async () => {
    const { isValidProjectKey } = require('@portfolio-delivery-ops/shared');
    isValidProjectKey.mockReturnValue(true);
    axios.get.mockResolvedValue({
      data: { issues: [{ key: 'ERA-1', fields: { issuetype: { name: 'Bug' }, status: { name: 'Open' }, summary: 'S' } }] }
    });

    const out = await getIssueBreakdown({ token: 'token', jiraKey: 'FEAT-1' });
    expect(out.success).toBe(true);
    expect(out.clientProcessing).toBe(true);
    expect(out.total).toBe(1);
  });
});

