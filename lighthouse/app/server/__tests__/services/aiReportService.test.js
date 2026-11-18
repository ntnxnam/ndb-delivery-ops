jest.mock('axios');
jest.mock('../../utils/jiraQueryUtils', () => ({
  buildCommitItemsJQL: jest.fn(() => 'fixVersion = "NDB-2.11"')
}));
jest.mock('../../utils/milestoneProcessor', () => ({
  processAllMilestones: jest.fn(() => ({ daysFromCutoff: 12, currentPGDate: '2026-01-20' }))
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
  getFieldValue: jest.fn((fields, key) => {
    if (!fields) return null;
    const idMap = { riskIndicator: 'customfield_23560', statusUpdate: 'customfield_23073', statusUpdateDate: 'customfield_45660', codeComplete: 'customfield_11067', commitGate: 'customfield_35863', promotionGate: 'customfield_35864', requirementsLink: 'customfield_14463', tcmsLink: 'customfield_31460' };
    return fields[idMap[key]] || null;
  }),
  buildFieldIdsString: jest.fn(() => 'customfield_23560,customfield_11067')
}));
jest.mock('../../services/execSummaryService', () => ({
  fetchP0BugsCount: jest.fn(() => Promise.resolve(2))
}));

const axios = require('axios');
const {
  analyzeProjectRisk,
  extractRiskReasoning,
  analyzeProjectForExecutiveSummary,
  buildVPReportPrompt,
  generateAiVpReport
} = require('../../services/aiReportService');

describe('aiReportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('UT-AI-001: extractRiskReasoning extracts detail from risk field', () => {
    const out = extractRiskReasoning({ fields: { customfield_23560: 'Yellow - blocked by dependency' } });
    expect(out).toContain('blocked by dependency');
  });

  test('UT-AI-002: analyzeProjectForExecutiveSummary returns structured analysis', () => {
    const out = analyzeProjectForExecutiveSummary({
      fields: {
        assignee: { displayName: 'Dev' },
        customfield_10860: { displayName: 'QA' },
        customfield_23073: 'QI: 80%',
        customfield_45660: '2026-01-01'
      }
    });
    expect(out.resourceStatus.length).toBeGreaterThan(0);
    expect(out.timelineStatus.length).toBeGreaterThan(0);
  });

  test('UT-AI-005: analyzeProjectRisk returns gaps and metrics', () => {
    const out = analyzeProjectRisk({
      fields: {
        customfield_23073: 'QI: 75% execution: 80% 3 open bugs',
        customfield_11067: '2026-01-01'
      }
    });
    expect(out.resourceGaps.length).toBeGreaterThan(0);
    expect(out.qualityMetrics.qi).toBe(75);
  });

  test('UT-AI-003: buildVPReportPrompt uses version and metrics', () => {
    const out = buildVPReportPrompt({
      version: 'NDB-2.11',
      totalProjects: 3,
      p0BugsCount: 1,
      riskCounts: { red: 1, yellow: 1, green: 1, notSet: 0 },
      projectDetails: { red: [], yellow: [], green: [] },
      dateMetrics: { daysFromCutoff: 10 },
      riskPercentages: { red: 33, yellow: 33, green: 33, notSet: 0 }
    });
    expect(out).toContain('NDB-2.11 RELEASE STATUS ANALYSIS');
  });

  test('UT-AI-004: generateAiVpReport returns generated report payload', async () => {
    axios.get.mockResolvedValueOnce({
      data: { issues: [{ key: 'ERA-1', fields: { summary: 's', status: { name: 'Open' }, priority: { name: 'P1' }, customfield_23560: { value: 'Red' } } }] }
    });
    axios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'report' } }] } });
    const out = await generateAiVpReport({ version: 'NDB-2.11', naiApiKey: 'k', jiraToken: 'jt' });
    expect(out.teamExecReport).toBe('report');
    expect(out.version).toBe('NDB-2.11');
  });
});

