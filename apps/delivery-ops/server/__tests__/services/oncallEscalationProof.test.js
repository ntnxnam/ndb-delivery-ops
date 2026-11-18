jest.mock('../../services/kpiService', () => ({
  resolveKpiJql: jest.fn(),
}));
jest.mock('../../utils/jiraClient', () => ({
  getJira: jest.fn(),
  searchPages: jest.fn(),
}));
jest.mock('../../utils/teamConfig', () => ({
  loadKpiConfigSync: jest.fn(() => ({})),
  getKpisForTeam: jest.fn(() => ({ kpis: [] })),
}));

const {
  buildEscalationProofJqls,
} = require('../../services/oncallEscalationService');
const {
  linkedIntoJql,
  escapeLinkedIssuesOfInner,
} = require('../../services/oncallConfigResolve');

describe('escalation filter-style proof JQL', () => {
  test('escapeLinkedIssuesOfInner escapes quotes', () => {
    expect(escapeLinkedIssuesOfInner('filter = "Top-CFI"')).toBe('filter = \\"Top-CFI\\"');
  });

  test('linkedIntoJql wraps seed + linkedIssuesOf', () => {
    const jql = linkedIntoJql(
      '(project = OnCall) AND (statusCategory != Done)',
      'filter = 142539 OR filter = 142537'
    );
    expect(jql).toContain('project = OnCall');
    expect(jql).toContain('issueFunction in linkedIssuesOf(');
    expect(jql).toContain('filter = 142539 OR filter = 142537');
  });

  test('buildEscalationProofJqls uses linkedIssuesOf not key in', () => {
    const proof = buildEscalationProofJqls({
      windowJql: '(filter = NDB-OnCalls) AND (project = OnCall) AND (statusCategory != Done OR resolved >= -180d)',
      kpiJqls: ['filter = 142539', 'filter = 142537'],
      withEscalationKeys: ['ONCALL-1'],
      resolvedKeys: ['ONCALL-1'],
      stillOpenKeys: [],
      openStatusJql: 'statusCategory != Done',
      doneStatusJql: 'statusCategory = Done',
    });
    expect(proof.withEscalation).toMatch(/linkedIssuesOf/);
    expect(proof.withEscalation).not.toMatch(/^key in \(/);
    expect(proof.stillOpen).toMatch(/statusCategory != Done/);
    expect(proof.resolved).toMatch(/issueFunction not in linkedIssuesOf/);
  });

  test('falls back to key in when no KPI JQLs', () => {
    const proof = buildEscalationProofJqls({
      windowJql: 'project = OnCall',
      kpiJqls: [],
      withEscalationKeys: ['ONCALL-1', 'ONCALL-2'],
      resolvedKeys: ['ONCALL-1'],
      stillOpenKeys: ['ONCALL-2'],
    });
    expect(proof.withEscalation).toBe('key in (ONCALL-1,ONCALL-2)');
  });
});
