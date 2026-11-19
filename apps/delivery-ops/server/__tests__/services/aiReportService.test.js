jest.mock('axios');
jest.mock('../../utils/jiraQueryUtils', () => ({
  buildCommitItemsJQL: jest.fn(() => 'fixVersion = "NDB-2.11"')
}));
jest.mock('../../utils/milestoneProcessor', () => ({
  processAllMilestones: jest.fn(() => ({ daysFromCutoff: 12, currentPGDate: '2026-01-20' }))
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
  getFieldValue: jest.fn((fields, key) => {
    if (!fields) return null;
    const idMap = { riskIndicator: 'custom'+'field_23560', statusUpdate: 'custom'+'field_23073', statusUpdateDate: 'custom'+'field_45660', codeComplete: 'custom'+'field_11067', commitGate: 'custom'+'field_35863', promotionGate: 'custom'+'field_35864', requirementsLink: 'custom'+'field_14463', tcmsLink: 'custom'+'field_31460' };
    return fields[idMap[key]] || null;
  }),
  buildFieldIdsString: jest.fn(() => 'custom'+'field_23560,custom'+'field_11067')
}));
jest.mock('../../services/execSummaryService', () => ({
  fetchP0BugsCount: jest.fn(() => Promise.resolve(2))
}));
jest.mock('../../utils/jiraClient', () => ({
  getJira: jest.fn().mockResolvedValue({ get: jest.fn().mockResolvedValue({ data: { issues: [] } }) }),
  getShared: jest.fn().mockResolvedValue({
    loadEnv: jest.fn(() => ({})),
    JiraConnector: jest.fn(),
    completeChat: jest.fn().mockResolvedValue({ content: 'report' }),
  }),
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
    const out = extractRiskReasoning({ fields: { custom'+'field_23560: 'Yellow - blocked by dependency' } });
    expect(out).toContain('blocked by dependency');
  });

  test('UT-AI-002: analyzeProjectForExecutiveSummary returns structured analysis', () => {
    const out = analyzeProjectForExecutiveSummary({
      fields: {
        assignee: { displayName: 'Dev' },
        custom'+'field_10860: { displayName: 'QA' },
        custom'+'field_23073: 'QI: 80%',
        custom'+'field_45660: '2026-01-01'
      }
    });
    expect(out.resourceStatus.length).toBeGreaterThan(0);
    expect(out.timelineStatus.length).toBeGreaterThan(0);
  });

  test('UT-AI-005: analyzeProjectRisk returns gaps and metrics', () => {
    const out = analyzeProjectRisk({
      fields: {
        custom'+'field_23073: 'QI: 75% execution: 80% 3 open bugs',
        custom'+'field_11067: '2026-01-01'
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
    const out = await generateAiVpReport({ version: 'NDB-2.11', naiApiKey: 'k', jiraToken: 'jt' });
    expect(out.teamExecReport).toBe('report');
    expect(out.version).toBe('NDB-2.11');
  });
});

