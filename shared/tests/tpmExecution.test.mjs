/**
 * tpm-execution / tpmKpiService tests — run via: npx tsc -p shared/tsconfig.json && node --experimental-strip-types --test shared/tests/tpmExecution.test.mjs
 * Generic: lifecyclePhase filter, JQL scoping, releaseScoped/E-W, citation, product-agnostic, type normalization.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// We test the compiled JS in dist/ so imports resolve; build first.
import { filterKpisByPhase, getKpisForTeamAndPhase, buildScopedJql, fetchKpisForPhase } from '../dist/services/tpmKpiService.js';
import { fetchExecutionKpis, TPM_EXECUTION_PHASE } from '../dist/services/tpmExecutionService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeKpis() {
  return [
    { id: 'kpi_p0', name: 'P0 Blockers', baseQuery: 'project=ERA and priority = "Blocker - P0" and type=Bug', displayType: 'count', order: 0, lifecyclePhase: 'execution' },
    { id: 'kpi_p1', name: 'P1 Criticals', baseQuery: 'project=ERA and priority = "Critical - P1" and type=Bug', displayType: 'count', order: 1, lifecyclePhase: 'execution' },
    { id: 'kpi_ew', name: 'E-W Projects', baseQuery: 'labels in (ndb-ew, global-ew, nutanix-ew)', displayType: 'count', order: 2, lifecyclePhase: 'execution', releaseScoped: true },
    { id: 'kpi_cfd', name: 'Top-CFD', baseQuery: 'filter=142537', displayType: 'count', order: 3, lifecyclePhase: 'postRelease' },
    { id: 'kpi_sla', name: 'CVE', baseQuery: 'type=CVE', displayType: 'count', order: 4, lifecyclePhase: 'overall' },
  ];
}

function makeTeamsMap(kpis) {
  return { ndb: kpis, datalens: [] };
}

function makeTeamConfig() {
  return {
    teams: [
      { id: 'ndb', name: 'NDB', baseFilter: 'filter=NDB-All-Base-Filter and statusCategory!=Done', releasePrefix: 'NDB-' },
      { id: 'datalens', name: 'DataLens', baseFilter: 'filter=DL-All', releasePrefix: 'DL-' },
    ],
    defaultTeamId: 'ndb',
  };
}

function fakeEnv() {
  return { jiraBaseUrl: 'https://jira.example.com', jiraPat: 'fake-pat', jiraTimeoutMs: 5000, httpsProxy: null, defaultProductId: 'ndb' };
}

function fakeJiraConnector(countMap = {}, filterJqlMap = {}) {
  // countMap: jql substring -> count
  // filterJqlMap: filterId or filterName -> jql
  return {
    searchCount: async (jql) => {
      // return mapped count or 0; tests assert JQL shape separately
      for (const [key, val] of Object.entries(countMap)) {
        if (jql.includes(key)) return val;
      }
      return 0;
    },
    get: async (path, opts) => {
      // filter resolution
      if (path.includes('/rest/api/2/filter/') && !path.includes('/search') && !path.includes('/favourite')) {
        const id = path.split('/').pop();
        const jql = filterJqlMap[id] ?? filterJqlMap[path];
        if (jql) return { data: { jql } };
        throw Object.assign(new Error('filter not found'), { response: { status: 404 } });
      }
      if (path.includes('/filter/search')) {
        const name = opts?.params?.filterName;
        if (name && filterJqlMap[name]) return { data: { values: [{ id: '999', name, jql: filterJqlMap[name] }] } };
        return { data: { values: [] } };
      }
      if (path.includes('/filter/favourite')) {
        return { data: [] };
      }
      return { data: {} };
    },
  };
}

// ---------------------------------------------------------------------------
// filterKpisByPhase — generic inclusion
// ---------------------------------------------------------------------------

describe('filterKpisByPhase', () => {
  it('returns only execution KPIs', () => {
    const kpis = makeKpis();
    const out = filterKpisByPhase(kpis, 'execution');
    assert.equal(out.length, 3);
    assert.ok(out.every((k) => k.lifecyclePhase === 'execution'));
  });
  it('new KPI tagged execution auto-includes', () => {
    const kpis = [...makeKpis(), { id: 'kpi_new', name: 'Future Dev Work', baseQuery: 'labels = dev-work', displayType: 'count', order: 10, lifecyclePhase: 'execution' }];
    const out = filterKpisByPhase(kpis, 'execution');
    assert.equal(out.length, 4);
    assert.ok(out.some((k) => k.id === 'kpi_new'));
  });
  it('other phases unaffected', () => {
    const kpis = makeKpis();
    assert.equal(filterKpisByPhase(kpis, 'postRelease').length, 1);
    assert.equal(filterKpisByPhase(kpis, 'overall').length, 1);
    assert.equal(filterKpisByPhase(kpis, 'release').length, 0);
  });
});

describe('getKpisForTeamAndPhase', () => {
  it('returns sorted by order', () => {
    const kpis = makeKpis();
    const map = makeTeamsMap(kpis);
    const { kpis: out } = getKpisForTeamAndPhase(map, 'ndb', 'execution');
    assert.equal(out.length, 3);
    assert.equal(out[0].id, 'kpi_p0');
    assert.equal(out[1].id, 'kpi_p1');
    assert.equal(out[2].id, 'kpi_ew');
  });
  it('case-insensitive teamId', () => {
    const map = makeTeamsMap(makeKpis());
    const a = getKpisForTeamAndPhase(map, 'NDB', 'execution');
    const b = getKpisForTeamAndPhase(map, 'ndb', 'execution');
    assert.deepEqual(a, b);
  });
  it('unknown team returns empty', () => {
    const map = makeTeamsMap(makeKpis());
    const { kpis: out } = getKpisForTeamAndPhase(map, 'unknown', 'execution');
    assert.equal(out.length, 0);
  });
});

// ---------------------------------------------------------------------------
// buildScopedJql — scoping + type normalization + releaseScoped
// ---------------------------------------------------------------------------

describe('buildScopedJql — release scope', () => {
  it('E-W with releaseScoped uses releaseBaseFilter (D36)', async () => {
    const kpi = { id: 'kpi_ew', name: 'E-W', baseQuery: 'labels in (ndb-ew, global-ew, nutanix-ew)', displayType: 'count', order: 2, lifecyclePhase: 'execution', releaseScoped: true };
    const jql = await buildScopedJql({
      scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
      kpi,
      teamConfig: makeTeamConfig(),
      jiraConnector: fakeJiraConnector(),
    });
    assert.ok(jql.includes('filter=NDB-2.12-All'), 'should contain releaseBaseFilter filter=NDB-2.12-All');
    assert.ok(jql.includes('labels in (ndb-ew'), 'should contain E-W labels clause');
    assert.ok(jql.includes('status != Closed'), 'should exclude closed');
  });

  it('P0 in release scope uses releaseBaseFilter', async () => {
    const kpi = makeKpis()[0];
    const jql = await buildScopedJql({
      scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
      kpi,
      teamConfig: makeTeamConfig(),
      jiraConnector: fakeJiraConnector(),
    });
    assert.ok(jql.includes('filter=NDB-2.12-All'), 'P0 release JQL should be release-scoped');
    assert.ok(!jql.includes('filter=NDB-All-Base-Filter'), 'should not contain team base filter when release filter present');
  });

  it('release override from columnsConfig wins', async () => {
    const kpi = { id: 'kpi_ew', name: 'E-W', baseQuery: 'labels in (ndb-ew)', displayType: 'count', order: 2, lifecyclePhase: 'execution', releaseScoped: true };
    const jql = await buildScopedJql({
      scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
      kpi,
      teamConfig: makeTeamConfig(),
      jiraConnector: fakeJiraConnector(),
      columnsConfig: { 'NDB-2.12': 'filter=99999' },
    });
    assert.ok(jql.includes('filter=99999'), 'columnsConfig override should win over default');
  });
});

describe('buildScopedJql — team scope', () => {
  it('uses teamBaseFilter', async () => {
    const kpi = makeKpis()[0];
    const jql = await buildScopedJql({
      scope: { kind: 'team', teamId: 'ndb' },
      kpi,
      teamConfig: makeTeamConfig(),
      jiraConnector: fakeJiraConnector(),
    });
    assert.ok(jql.includes('filter=NDB-All-Base-Filter'), 'team JQL should contain teamBaseFilter');
  });
});

describe('buildScopedJql — me scope', () => {
  it('adds assignee clause', async () => {
    const kpi = makeKpis()[0];
    const jql = await buildScopedJql({
      scope: { kind: 'me', teamId: 'ndb', principal: 'alice@example.com' },
      kpi,
      teamConfig: makeTeamConfig(),
      jiraConnector: fakeJiraConnector(),
    });
    assert.ok(jql.includes('assignee = "alice@example.com"'), 'me scope should filter by principal');
  });
});

describe('buildScopedJql — type normalization', () => {
  it('normalizes type= to issuetype= in KPI baseQuery', async () => {
    const kpi = { id: 'kpi_x', name: 'X', baseQuery: 'project=ERA and type=Bug and priority = "Blocker - P0"', displayType: 'count', order: 0, lifecyclePhase: 'execution' };
    const jql = await buildScopedJql({
      scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
      kpi,
      teamConfig: makeTeamConfig(),
      jiraConnector: fakeJiraConnector(),
    });
    assert.ok(!/\btype\s*=/i.test(jql) || jql.includes('issuetype='), 'should not contain bare type= outside filter');
    // The baseQuery was not a filter= so type= should be normalized
    assert.ok(jql.includes('issuetype=Bug'), 'type=Bug should become issuetype=Bug');
  });
});

describe('buildScopedJql — product-agnostic (D1)', () => {
  it('no hard-coded project keys in generated JQL shape', async () => {
    // Build with a synthetic team that has no ERA reference
    const teamConfig = {
      teams: [{ id: 'myteam', name: 'My Team', baseFilter: 'filter=MYTEAM-Base and statusCategory!=Done' }],
      defaultTeamId: 'myteam',
    };
    const kpi = { id: 'k', name: 'K', baseQuery: 'priority = "Blocker - P0"', displayType: 'count', order: 0, lifecyclePhase: 'execution' };
    const jql = await buildScopedJql({
      scope: { kind: 'team', teamId: 'myteam' },
      kpi,
      teamConfig,
      jiraConnector: fakeJiraConnector(),
    });
    assert.ok(jql.includes('filter=MYTEAM-Base'), 'should use injected team baseFilter');
    assert.ok(!jql.includes('project = ERA'), 'should not inject ERA when baseQuery has no project clause');
  });
});

// ---------------------------------------------------------------------------
// fetchKpisForPhase / fetchExecutionKpis — integration
// ---------------------------------------------------------------------------

describe('fetchKpisForPhase — totals + cited', () => {
  it('aggregates counts and cites every JQL + ts', async () => {
    const kpis = makeKpis();
    const teamsMap = makeTeamsMap(kpis);
    const jira = fakeJiraConnector({ 'Blocker - P0': 5, 'Critical - P1': 3, 'ndb-ew': 7 });
    const { result, details } = await fetchKpisForPhase({
      phase: 'execution',
      scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
      jiraConnector: jira,
      env: fakeEnv(),
      kpiConfig: teamsMap,
      teamConfig: makeTeamConfig(),
    });
    assert.equal(result.skill, 'tpm-execution');
    // details has 3 execution KPIs
    assert.equal(details.length, 3);
    // cited has 3 entries, each with jql + ts
    assert.equal(result.cited.length, 3);
    for (const c of result.cited) {
      assert.ok(c.jql.length > 0, 'cited jql non-empty');
      assert.ok(c.ts, 'cited ts present');
      assert.ok(!isNaN(Date.parse(c.ts)), 'ts is valid ISO');
    }
    // totals match sum
    assert.equal(result.totals.total, details.reduce((s, d) => s + d.count, 0));
    // combined JQL non-empty, jiraSearchUrl valid
    assert.ok(result.links.combinedJql.length > 0);
    assert.ok(result.links.jiraSearchUrl.includes('jira.example.com'));
    assert.ok(result.links.jiraSearchUrl.includes('jql='));
  });

  it('fetchExecutionKpis is alias with phase=execution', async () => {
    const teamsMap = makeTeamsMap(makeKpis());
    const jira = fakeJiraConnector();
    const { result } = await fetchExecutionKpis({
      scope: { kind: 'team', teamId: 'ndb' },
      jiraConnector: jira,
      env: fakeEnv(),
      kpiConfig: teamsMap,
      teamConfig: makeTeamConfig(),
    });
    assert.equal(result.skill, 'tpm-execution');
    assert.equal(result.cited.length, 3); // 3 execution KPIs for ndb
  });

  it('org scope fans out across teamIds', async () => {
    const teamsMap = { ndb: makeKpis().filter((k) => k.lifecyclePhase === 'execution'), datalens: [{ id: 'k_dl', name: 'DL', baseQuery: 'project=DL and priority = "Blocker - P0"', displayType: 'count', order: 0, lifecyclePhase: 'execution' }] };
    const jira = fakeJiraConnector();
    const { details } = await fetchKpisForPhase({
      phase: 'execution',
      scope: { kind: 'org', orgId: 'my-org', teamIds: ['ndb', 'datalens'] },
      jiraConnector: jira,
      env: fakeEnv(),
      kpiConfig: teamsMap,
      teamConfig: makeTeamConfig(),
    });
    // 3 from ndb + 1 from datalens = 4
    assert.equal(details.length, 4);
  });

  it('empty phase returns empty cited but valid envelope', async () => {
    const teamsMap = makeTeamsMap(makeKpis());
    const { result, details } = await fetchKpisForPhase({
      phase: 'nonexistent-phase',
      scope: { kind: 'team', teamId: 'ndb' },
      jiraConnector: fakeJiraConnector(),
      env: fakeEnv(),
      kpiConfig: teamsMap,
      teamConfig: makeTeamConfig(),
    });
    assert.equal(details.length, 0);
    assert.equal(result.cited.length, 0);
    assert.equal(result.totals.total, 0);
  });

  it('TPM_EXECUTION_PHASE constant is execution', () => {
    assert.equal(TPM_EXECUTION_PHASE, 'execution');
  });
});

describe('fetchKpisForPhase — jqlExtra passthrough', () => {
  it('appends jqlExtra when provided', async () => {
    const kpis = makeKpis();
    const jira = fakeJiraConnector();
    const { details } = await fetchKpisForPhase({
      phase: 'execution',
      scope: { kind: 'team', teamId: 'ndb' },
      jiraConnector: jira,
      env: fakeEnv(),
      jqlExtra: 'assignee = currentUser()',
      kpiConfig: makeTeamsMap(kpis),
      teamConfig: makeTeamConfig(),
    });
    for (const d of details) {
      assert.ok(d.jql.includes('assignee = currentUser()'), `jqlExtra should appear in ${d.kpiName}`);
    }
  });
});
