jest.mock('axios');
jest.mock('../../services/releaseItemsDataService', () => ({
  _internals: {
    fetchReleaseItemsFromJira: jest.fn(),
    processReleaseItems: jest.fn()
  }
}));
jest.mock('../../utils/jiraQueryUtils', () => ({
  buildCommitItemsJQL: jest.fn(() => 'commit-jql'),
  buildLongTermItemsJQL: jest.fn(() => 'longterm-jql')
}));
jest.mock('../../utils/jiraFieldsConfig', () => ({
  getFieldId: jest.fn((key) => ({
    sprint: 'customfield_10020',
    sprints: 'customfield_10021',
    codeComplete: 'customfield_11067',
    commitGate: 'customfield_35863',
    promotionGate: 'customfield_35864',
    riskIndicator: 'customfield_23560',
    tpmOwner: 'customfield_27764'
  })[key] || null)
}));
jest.mock('../../utils/logger', () => ({ jira: { fetch: jest.fn() } }));

const axios = require('axios');
const releaseItemsService = require('../../services/releaseItemsDataService');
const {
  generateTimelineColumns,
  calculateSprintStats,
  getReleaseCommitItems,
  buildSprintGanttData
} = require('../../services/ganttService');

describe('ganttService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('UT-GANTT-001: generateTimelineColumns returns month range', () => {
    const out = generateTimelineColumns();
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toHaveProperty('label');
    expect(out[0]).toHaveProperty('startDate');
  });

  test('UT-GANTT-002: calculateSprintStats computes coverage and averages', () => {
    const tickets = [{ sprintEndDate: '2026-01-01', sprintState: 'active', sprintId: 1 }];
    const cache = new Map([[1, { startDate: '2025-12-01', endDate: '2026-01-01', state: 'active' }]]);
    const out = calculateSprintStats(tickets, cache);
    expect(out.sprintCoverage).toBe(100);
    expect(out.activeSprints).toBe(1);
  });

  test('UT-GANTT-003: getReleaseCommitItems delegates to releaseItems internals', async () => {
    releaseItemsService._internals.fetchReleaseItemsFromJira.mockResolvedValue([{ key: 'ERA-1' }]);
    releaseItemsService._internals.processReleaseItems.mockResolvedValue([{ key: 'ERA-1' }]);
    const out = await getReleaseCommitItems('NDB-2.11', 'token');
    expect(out.success).toBe(true);
    expect(out.items).toHaveLength(1);
  });

  test('UT-GANTT-004: buildSprintGanttData returns enriched shape', async () => {
    axios.get.mockResolvedValue({
      data: {
        issues: [
          {
            key: 'ERA-1',
            fields: {
              summary: 'Ticket',
              status: { name: 'In Progress' },
              assignee: { displayName: 'User' },
              issuetype: { name: 'Task' },
              customfield_10020: { id: 1, name: 'Sprint 1' }
            }
          }
        ]
      }
    });
    const out = await buildSprintGanttData({ jiraKey: 'FEAT-1', jiraData: true, epics: [], token: 'token' });
    expect(out.success).toBe(true);
    expect(out.sprintTickets.length).toBeGreaterThan(0);
  });
});

