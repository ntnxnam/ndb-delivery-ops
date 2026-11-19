jest.mock('../../utils/teamConfig', () => ({
  loadKpiConfigSync: jest.fn(),
  getKpisForTeam: jest.fn(),
  getTeamBaseFilter: jest.fn(),
}));
jest.mock('../../utils/jiraRouteHelpers', () => ({
  getReleaseBaseFilter: jest.fn(),
  upstreamStatus: jest.fn((s) => s),
}));
jest.mock('../../services/kpiService', () => ({
  buildKpiCombinedJql: jest.fn(),
  buildReleaseKpiCombinedJql: jest.fn(),
  appendDeferredExclusion: jest.fn((jql) => jql),
  executeKpiQuery: jest.fn(),
}));

const { loadKpiConfigSync, getKpisForTeam } = require('../../utils/teamConfig');
const kpiService = require('../../services/kpiService');
const { getOverallKpis } = require('../../services/tpmOverallService');

describe('tpmOverallService — lifecyclePhase overall (generic)', () => {
  beforeEach(() => jest.clearAllMocks());

  const overallKpis = [
    { id: 'kpi_cve', name: 'CVE', baseQuery: 'type=CVE', displayType: 'count', order: 0, lifecyclePhase: 'overall' },
    { id: 'kpi_sla', name: 'Bugs Out of SLA', baseQuery: 'filter=NDB-Bugs-OutOfSLA', displayType: 'count', order: 1, lifecyclePhase: 'overall' },
    { id: 'kpi_def', name: 'Deferral', baseQuery: 'filter=ndb-deferred-tickets', displayType: 'count', order: 2, lifecyclePhase: 'overall' },
  ];
  const execKpi = { id: 'kpi_p0', name: 'P0', baseQuery: 'priority = Blocker', displayType: 'count', order: 0, lifecyclePhase: 'execution' };

  test('filters by lifecyclePhase overall only', async () => {
    loadKpiConfigSync.mockReturnValue({});
    getKpisForTeam.mockReturnValue({ normalizedTeamId: 'ndb', kpis: [...overallKpis, execKpi] });
    kpiService.buildKpiCombinedJql.mockResolvedValue('(base) AND (q)');
    kpiService.executeKpiQuery.mockResolvedValue({ total: 2, combinedJql: '(base) AND (q)' });

    const out = await getOverallKpis({ scope: { kind: 'team', teamId: 'ndb' }, token: 't' });
    expect(kpiService.buildKpiCombinedJql).toHaveBeenCalledTimes(3);
    expect(out.totals.total).toBe(6);
    expect(out.cited.length).toBe(3);
    expect(out.skill).toBe('tpm-overall');
  });

  test('release scope uses buildReleaseKpiCombinedJql', async () => {
    loadKpiConfigSync.mockReturnValue({});
    getKpisForTeam.mockReturnValue({ normalizedTeamId: 'ndb', kpis: overallKpis });
    kpiService.buildReleaseKpiCombinedJql.mockResolvedValue('filter=rel and (type=CVE)');
    kpiService.executeKpiQuery.mockResolvedValue({ total: 1, combinedJql: 'filter=rel and (type=CVE)' });

    const out = await getOverallKpis({ scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' }, token: 't' });
    expect(kpiService.buildReleaseKpiCombinedJql).toHaveBeenCalledTimes(3);
    expect(out.totals.total).toBe(3);
  });

  test('empty overall returns warning with zero totals', async () => {
    loadKpiConfigSync.mockReturnValue({});
    getKpisForTeam.mockReturnValue({ normalizedTeamId: 'ndb', kpis: [execKpi] });
    const out = await getOverallKpis({ scope: { kind: 'team', teamId: 'ndb' }, token: 't' });
    expect(out.totals.total).toBe(0);
    expect(out.warnings[0]).toMatch(/No KPIs tagged overall/);
    expect(out.cited.length).toBe(0);
  });

  test('future KPI tagged overall auto-included (generic)', async () => {
    const future = { id: 'kpi_future', name: 'Compliance', baseQuery: 'labels = compliance', displayType: 'count', order: 99, lifecyclePhase: 'overall' };
    loadKpiConfigSync.mockReturnValue({});
    getKpisForTeam.mockReturnValue({ normalizedTeamId: 'ndb', kpis: [...overallKpis, future] });
    kpiService.buildKpiCombinedJql.mockResolvedValue('(base) AND (q)');
    kpiService.executeKpiQuery.mockResolvedValue({ total: 1, combinedJql: 'x' });

    const out = await getOverallKpis({ scope: { kind: 'team', teamId: 'ndb' }, token: 't' });
    expect(kpiService.buildKpiCombinedJql).toHaveBeenCalledTimes(4);
    expect(out.cited.length).toBe(4);
  });

  test('cited entries have jql and ts', async () => {
    loadKpiConfigSync.mockReturnValue({});
    getKpisForTeam.mockReturnValue({ normalizedTeamId: 'ndb', kpis: [overallKpis[0]] });
    kpiService.buildKpiCombinedJql.mockResolvedValue('jql-1');
    kpiService.executeKpiQuery.mockResolvedValue({ total: 5, combinedJql: 'jql-1' });

    const out = await getOverallKpis({ scope: { kind: 'team', teamId: 'ndb' }, token: 't' });
    expect(out.cited[0].jql).toBe('jql-1');
    expect(out.cited[0].ts).toMatch(/T.*Z/);
  });
});
