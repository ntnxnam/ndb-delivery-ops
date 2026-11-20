jest.mock('axios');
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
    riskIndicator: 'custom'+'field_23560',
    statusUpdate: 'custom'+'field_23073',
    statusUpdateDate: 'custom'+'field_45660',
    qaContact: 'custom'+'field_10860',
    testLead: 'custom'+'field_11065',
    tpmOwner: 'custom'+'field_27764',
    codeComplete: 'custom'+'field_11067',
    commitGate: 'custom'+'field_35863',
    promotionGate: 'custom'+'field_35864',
    requirementsLink: 'custom'+'field_14463',
    tcmsLink: 'custom'+'field_31460'
  })[key] || null),
  getFieldValue: jest.fn((fields, key) => fields && fields['custom'+'field_23560'] && key === 'riskIndicator' ? fields['custom'+'field_23560'] : null),
  buildFieldIdsString: jest.fn(() => 'custom'+'field_23560,custom'+'field_23073')
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
      { ['custom'+'field_23560']: 'Red' },
      { ['custom'+'field_23560']: 'Yellow' },
      { ['custom'+'field_23560']: 'Green' },
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

