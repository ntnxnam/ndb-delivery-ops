/**
 * Regression: oncall pulse flatlined because teamBaseFilter AND project=ONCALL
 * created an impossible `project in (ERA,NDBECO) AND project=ONCALL` intersection.
 * Fix: ONCALL scope uses ownership clause only (component/assignee/issuetype).
 */
const fs = require('fs');
const path = require('path');

const TEAM_CONFIG_PATH = path.join(__dirname, '../../config/teamBoardConfig.json');
const KPI_CONFIG_PATH = path.join(__dirname, '../../config/kpiConfig.json');

describe('oncallConfigResolve — flatline regression', () => {
  let originalTeamBoard;
  let originalKpi;
  beforeAll(() => {
    originalTeamBoard = fs.readFileSync(TEAM_CONFIG_PATH, 'utf8');
    originalKpi = fs.readFileSync(KPI_CONFIG_PATH, 'utf8');
  });
  afterEach(() => {
    fs.writeFileSync(TEAM_CONFIG_PATH, originalTeamBoard, 'utf8');
    fs.writeFileSync(KPI_CONFIG_PATH, originalKpi, 'utf8');
    jest.resetModules();
    // bust teamConfig board cache
    try {
      const { invalidateTeamBoardCache } = require('../../utils/teamConfig');
      invalidateTeamBoardCache();
    } catch {}
  });

  function writeConfigs(teamBaseFilter, components, dls) {
    const teamBoard = JSON.parse(originalTeamBoard);
    const ndb = teamBoard.teams.find((t) => t.id === 'ndb');
    ndb.baseFilter = teamBaseFilter;
    ndb.base_jql = teamBaseFilter;
    ndb.components = components;
    ndb.leader_outlook_dls = dls;
    fs.writeFileSync(TEAM_CONFIG_PATH, JSON.stringify(teamBoard, null, 2), 'utf8');
    // kpiConfig already has project=ONCALL standard KPI
    try {
      const { invalidateTeamBoardCache } = require('../../utils/teamConfig');
      invalidateTeamBoardCache();
    } catch {}
  }

  test('buildOncallTeamClause builds component+assignee+issuetype OR', () => {
    jest.resetModules();
    const { buildOncallTeamClause } = require('../../services/oncallConfigResolve');
    const team = {
      components: ['NDB', 'Era', 'NDB Databases'],
      leader_outlook_dls: ['Team-Karan-Singh-Org', 'Team-BharatKumar-Beedu-Org'],
    };
    const clause = buildOncallTeamClause(team);
    expect(clause).toContain('component in (');
    expect(clause).toContain('"NDB Databases"');
    expect(clause).toContain('assignee in (membersOf("Team-Karan-Singh-Org")');
    expect(clause).toContain('issuetype in ("Era Oncall", "ERA Oncall")');
    // no project=ERA leakage
    expect(clause).not.toMatch(/project in \(ERA/);
  });

  test('resolveRuntimeConfig for ONCALL uses ownership clause not impossible project intersection', () => {
    const baseFilter = '(project in (ERA, NDBECO) OR (project in (ENG, FEAT, ONCALL, TH) AND (component in (NDB, Era) OR assignee in (membersOf("Team-Karan-Singh-Org")) OR issuetype in ("Era Oncall", "ERA Oncall"))))';
    writeConfigs(baseFilter, ['NDB', 'Era'], ['Team-Karan-Singh-Org']);
    jest.resetModules();
    const { resolveRuntimeConfig } = require('../../services/oncallConfigResolve');
    const cfg = resolveRuntimeConfig('ndb');
    // must contain ONCALL project
    expect(cfg.baseScopeJql).toMatch(/project\s*=\s*ONCALL/i);
    // must NOT contain the impossible `project in (ERA, NDBECO) AND project = ONCALL` conjunction
    // The old bug was `(${baseFilter}) AND (project = ONCALL)` which string-contains that pattern
    expect(cfg.baseScopeJql).not.toContain('project in (ERA, NDBECO) OR (project in (ENG');
    // must contain ownership pieces
    expect(cfg.baseScopeJql).toMatch(/component in/);
    expect(cfg.baseScopeJql).toMatch(/assignee in/);
    expect(cfg.baseScopeJql).toMatch(/issuetype in/);
  });

  test('resolveRuntimeConfig for non-ONCALL KPI still ANDs full baseFilter', () => {
    const baseFilter = 'project in (ENG) AND component in (NDB)';
    writeConfigs(baseFilter, ['NDB'], ['Team-X-Org']);
    // temporarily change OnCalls KPI to non-ONCALL to trigger else branch
    const kpiConfig = JSON.parse(originalKpi);
    kpiConfig.standardKpis = kpiConfig.standardKpis.map((k) => (k.name === 'OnCalls' ? { ...k, baseQuery: 'filter=NDB-OnCalls' } : k));
    fs.writeFileSync(KPI_CONFIG_PATH, JSON.stringify(kpiConfig, null, 2), 'utf8');
    jest.resetModules();
    const { resolveRuntimeConfig } = require('../../services/oncallConfigResolve');
    const cfg = resolveRuntimeConfig('ndb');
    // filter=NDB-OnCalls is not bare project=ONCALL, so full AND applies
    expect(cfg.baseScopeJql).toContain('project in (ENG)');
    expect(cfg.baseScopeJql).toContain('filter=NDB-OnCalls');
  });

  test('bare ONCALL without team clause falls back to project=ONCALL only', () => {
    const baseFilter = '(project in (ERA, NDBECO) OR (project in (ENG) AND component in (NDB)))';
    writeConfigs(baseFilter, [], []);
    // team with empty components/DLS still gets issuetype clause, but test empty team object
    jest.resetModules();
    const { buildOncallTeamClause } = require('../../services/oncallConfigResolve');
    const emptyTeam = { components: [], leader_outlook_dls: [] };
    const clause = buildOncallTeamClause(emptyTeam);
    // still has issuetype
    expect(clause).toMatch(/issuetype/);
    // if team is null, returns null
    expect(buildOncallTeamClause(null)).toBeNull();
  });
});
