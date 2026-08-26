jest.mock('axios');
jest.mock('../../utils/sprintCache', () => ({
  getSprintsForBoard: jest.fn(),
  classifySprintIssue: jest.fn(),
  getAddedToSprintAt: jest.fn()
}));
jest.mock('../../utils/jiraQueryUtils', () => ({
  buildSprintReportJql: jest.fn(() => 'sprint = 10')
}));
jest.mock('../../utils/teamConfig', () => ({
  loadKpiConfigSync: jest.fn(),
  getKpisForTeam: jest.fn(),
  loadTeamBoardConfig: jest.fn(() => ({
    defaultTeamId: 'ndb',
    sprintFieldId: 'customfield_10360',
    storyPointsFieldId: 'customfield_10002',
    pendingQAStatusName: 'Resolved',
    completedStatusName: 'Closed',
    teams: [{ id: 'ndb', name: 'NDB', boardId: 2888, sprintBaseFilter: 'filter=NDB-All-Base-Filter' }]
  })),
  getTeamById: jest.fn(() => ({
    id: 'ndb',
    name: 'NDB',
    boardId: 2888,
    sprintBaseFilter: 'filter=NDB-All-Base-Filter'
  }))
}));
jest.mock('../../utils/changelogPagination', () => ({
  fetchAllChangelogHistories: jest.fn()
}));
jest.mock('../../utils/concurrency', () => ({
  runWithConcurrency: jest.fn(async (tasks) => Promise.all(tasks.map((t) => t())))
}));
jest.mock('../../utils/logger', () => ({ jira: { fetch: jest.fn(), issueBreakdown: jest.fn() } }));

const axios = require('axios');
const { getSprintsForBoard, classifySprintIssue } = require('../../utils/sprintCache');
const { getSprintList, getSprintMetrics, buildSprintReport } = require('../../services/sprintService');

describe('sprintService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('UT-SPR-001: getSprintMetrics computes expected rates', () => {
    const out = getSprintMetrics({
      totalInSprint: 10,
      addedAfterStart: 2,
      inProgress: 2,
      pendingQA: 1,
      completedInSprint: 7,
      removedFromSprint: 1
    });
    expect(out.completionRate).toBe(70);
    expect(out.scopeCreepRate).toBe(25);
    expect(out.removedFromSprint).toBe(1);
  });

  test('UT-SPR-002: getSprintList returns sorted sprint list', async () => {
    getSprintsForBoard.mockResolvedValue(new Map([
      [1, { name: 'S1', state: 'closed', endDate: '2026-01-01' }],
      [2, { name: 'S2', state: 'closed', endDate: '2026-02-01' }]
    ]));
    const out = await getSprintList({ token: 't', teamId: 'ndb' });
    expect(out[0].id).toBe(2);
    expect(out[1].id).toBe(1);
  });

  test('UT-SPR-003: buildSprintReport returns report shape', async () => {
    getSprintsForBoard.mockResolvedValue(new Map([
      [10, { name: 'Sprint 10', state: 'closed', startDate: '2026-01-01', endDate: '2026-01-21' }]
    ]));
    classifySprintIssue.mockReturnValue('completedInSprint');
    axios.get
      .mockResolvedValueOnce({
        data: {
          total: 1,
          issues: [{ key: 'ERA-1', fields: { summary: 'A', status: { name: 'Done' }, issuetype: { name: 'Bug' }, priority: { name: 'P2' }, assignee: { displayName: 'X' } } }]
        }
      })
      .mockResolvedValueOnce({ data: { total: 0 } })
      .mockResolvedValueOnce({ data: { total: 0 } });
    const out = await buildSprintReport({ token: 't', teamId: 'ndb', sprintId: 10 });
    expect(out.success).toBe(true);
    expect(out.sprint.id).toBe(10);
    expect(out.metrics.totalInSprint).toBe(1);
  });
});

