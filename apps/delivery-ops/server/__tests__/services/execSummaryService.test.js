jest.mock('axios');
jest.mock('../../services/jiraService', () => ({
  createHttpsAgent: jest.fn(() => ({}))
}));
jest.mock('../../utils/jiraQueryUtils', () => ({
  buildCommitItemsJQL: jest.fn(() => 'fixVersion = "NDB-2.11"')
}));
jest.mock('../../utils/tcmsHelpers', () => ({
  extractQIFromItem: jest.fn(() => 90)
}));
jest.mock('../../utils/milestoneProcessor', () => ({
  processAllMilestones: jest.fn(() => ({ daysFromCutoff: 10, currentCCDate: '2026-01-01', currentCGDate: '2026-01-10', currentPGDate: '2026-01-20', milestones: {} }))
}));
jest.mock('../../utils/jiraFieldsConfig', () => ({
  getFieldId: jest.fn((key) => ({
    riskIndicator: 'customfield_23560',
    statusUpdate: 'customfield_23073',
    statusUpdateDate: 'customfield_45660',
    qaContact: 'customfield_10860',
    testLead: 'customfield_11065',
    tpmOwner: 'customfield_27764',
    codeComplete: 'customfield_11067',
    commitGate: 'customfield_35863',
    promotionGate: 'customfield_35864',
    requirementsLink: 'customfield_14463',
    tcmsLink: 'customfield_31460'
  })[key] || null),
  getFieldValue: jest.fn((fields, key) => fields && fields.customfield_23560 && key === 'riskIndicator' ? fields.customfield_23560 : null),
  buildFieldIdsString: jest.fn(() => 'customfield_23560,customfield_23073')
}));

const axios = require('axios');
const {
  generateExecutiveSummary,
  calculateRiskBreakdown,
  calculateDateMetrics,
  fetchP0BugsCount,
  fetchCommitItems
} = require('../../services/execSummaryService');

describe('execSummaryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('UT-EXEC-001: generateExecutiveSummary returns empty template for no items', () => {
    const out = generateExecutiveSummary('NDB-2.11', [], {}, {});
    expect(out.executiveSummary).toContain('No commit projects found');
  });

  test('UT-EXEC-002: calculateRiskBreakdown classifies red/yellow/green', () => {
    const items = [
      { customfield_23560: 'Red' },
      { customfield_23560: 'Yellow' },
      { customfield_23560: 'Green' },
      {}
    ];
    const out = calculateRiskBreakdown(items);
    expect(out.red).toBe(1);
    expect(out.yellow).toBe(1);
    expect(out.green).toBe(1);
    expect(out.notSet).toBe(1);
  });

  test('UT-EXEC-003: calculateDateMetrics returns processed milestone data', () => {
    const out = calculateDateMetrics('NDB-2.11');
    expect(out.currentCGDate).toBe('2026-01-10');
  });

  test('UT-EXEC-004: fetchP0BugsCount returns total from jira search', async () => {
    axios.get.mockResolvedValue({ data: { total: 5 } });
    const out = await fetchP0BugsCount('token', 'NDB-2.11');
    expect(out).toBe(5);
  });

  test('UT-EXEC-005: fetchCommitItems returns issues array', async () => {
    axios.get.mockResolvedValue({ data: { issues: [{ key: 'ERA-1' }] } });
    const out = await fetchCommitItems('token', 'NDB-2.11');
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('ERA-1');
  });
});

