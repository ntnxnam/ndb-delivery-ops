import { generateTableHTMLForEmail } from '../emailTableGenerator';
import { getFieldId, getFieldValue } from '../jiraFields';

const mockColumnsConfig = {
  columnOrder: ['key', 'summary', 'quality'],
  columns: {
    key: { label: 'Key', includeInUI: true, order: 1 },
    summary: { label: 'Summary', includeInUI: true, order: 2 },
    quality: { label: 'Quality', includeInUI: true, order: 3, description: 'TCMS Quality: 4 tables (Release/Master × Overall/Last 4 weeks), each 2 rows (Functional/System) × 2 cols (Manual/Automation)' },
  },
};

const noop = () => null;
const dummyHistory = {};

describe('emailTableGenerator — TCMS Quality Functional/System rows', () => {
  const makeItem = (tcmsQuality) => ({
    key: 'FEAT-1',
    summary: 'Test feature',
    status: 'In Progress',
    fixVersions: 'NDB-2.12',
    assignee: 'user@test.com',[getFieldId('qaContact')]: null,[getFieldId('tpmOwner')]: null,[getFieldId('statusUpdate')]: null,[getFieldId('riskIndicator')]: null,
    tcmsQuality,
    tcmsQI: null,
  });

  const makeQualityTable = (qi = 80) => ({
    functional: {
      manual: { qi, run: 10, passed: 8, failed: 2, rate: 80 },
      automation: { qi: 90, run: 20, passed: 18, failed: 2, rate: 90 },
    },
    system: {
      manual: { qi: 70, run: 15, passed: 10, failed: 5, rate: 66 },
      automation: { qi: 85, run: 25, passed: 22, failed: 3, rate: 88 },
    },
  });

  test('UT-EMAIL-001: quality cell renders Functional and System row labels', () => {
    const item = makeItem({
      releaseOverall: makeQualityTable(),
      releaseLast3Weeks: null,
      masterOverall: null,
      masterLast3Weeks: null,
    });
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop, 'https://jira.nutanix.com'
    );
    expect(html).toContain('Functional');
    expect(html).toContain('System');
  });

  test('UT-EMAIL-002: regression — no Overall or Automation row labels (as row th)', () => {
    const item = makeItem({
      releaseOverall: makeQualityTable(),
      releaseLast3Weeks: makeQualityTable(),
      masterOverall: makeQualityTable(),
      masterLast3Weeks: makeQualityTable(),
    });
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop
    );
    // Row labels are rendered as <th scope="row">Functional</th> and System
    // Ensure no row header contains Overall or Automation as row label
    // Column header Automation is allowed (th scope=col), so check row pattern specifically
    const rowOverallMatches = html.match(/<th scope="row"[^>]*>Overall<\/th>/g) || [];
    const rowAutomationMatches = html.match(/<th scope="row"[^>]*>Automation<\/th>/g) || [];
    expect(rowOverallMatches).toHaveLength(0);
    expect(rowAutomationMatches).toHaveLength(0);
  });

  test('UT-EMAIL-003: each quality table has 2 body rows + Manual/Automation cols', () => {
    const item = makeItem({
      releaseOverall: makeQualityTable(),
      releaseLast3Weeks: null,
      masterOverall: null,
      masterLast3Weeks: null,
    });
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop
    );
    // Should contain headers Manual and Automation as col headers
    expect(html).toContain('Manual</th>');
    expect(html).toContain('Automation</th>');
    // Count Functional occurrences — 1 per non-null table (releaseOverall only = 1 table => 1 Functional row) + 1 footnote
    const functionalCount = (html.match(/Functional/g) || []).length;
    expect(functionalCount).toBe(2);
  });

  test('UT-EMAIL-004: legacy overall fallback maps to System row', () => {
    const legacyTable = {
      functional: { manual: { qi: 10, run: 1, passed: 1, failed: 0, rate: 100 }, automation: { qi: 20, run: 2, passed: 2, failed: 0, rate: 100 } },
      overall: { manual: { qi: 99, run: 99, passed: 99, failed: 0, rate: 99 }, automation: { qi: 99, run: 99, passed: 99, failed: 0, rate: 99 } },
    };
    const item = makeItem({
      releaseOverall: legacyTable,
      releaseLast3Weeks: null,
      masterOverall: null,
      masterLast3Weeks: null,
    });
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop
    );
    // System row should show qi 99 from overall fallback
    expect(html).toContain('QI 99%');
  });

  test('UT-EMAIL-005: QI null renders — without trailing %', () => {
    const tableWithNullQi = {
      functional: { manual: { qi: null, run: 10, passed: 5, failed: 5, rate: null }, automation: null },
      system: { manual: null, automation: null },
    };
    const item = makeItem({
      releaseOverall: tableWithNullQi,
      releaseLast3Weeks: null,
      masterOverall: null,
      masterLast3Weeks: null,
    });
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop
    );
    expect(html).toContain('QI —');
    expect(html).not.toContain('—%');
    // Rate null also should be —
    expect(html).toContain('Rate —');
  });

  test('UT-EMAIL-006: null tcmsQuality renders Not Set', () => {
    const item = makeItem(null);
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop
    );
    expect(html).toContain('Not Set');
  });

  test('UT-EMAIL-007: a11y — row headers use th scope=row and col headers scope=col', () => {
    const item = makeItem({
      releaseOverall: makeQualityTable(),
      releaseLast3Weeks: null,
      masterOverall: null,
      masterLast3Weeks: null,
    });
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop
    );
    expect(html).toContain('scope="row"');
    expect(html).toContain('scope="col"');
  });

  test('UT-EMAIL-008: 4 tables rendered when all windows present', () => {
    const item = makeItem({
      releaseOverall: makeQualityTable(80),
      releaseLast3Weeks: makeQualityTable(81),
      masterOverall: makeQualityTable(82),
      masterLast3Weeks: makeQualityTable(83),
    });
    const html = generateTableHTMLForEmail(
      { commit: [item] }, dummyHistory, 'NDB-2.12', mockColumnsConfig, noop, noop, noop, noop
    );
    // Each non-null table title appears
    expect(html).toContain('Release NDB-2.12 — Overall');
    expect(html).toContain('Release NDB-2.12 — Last 4 weeks');
    expect(html).toContain('Master — Overall');
    expect(html).toContain('Master — Last 4 weeks');
    // Functional appears 4 times (one per table) + 1 footnote
    expect((html.match(/Functional/g) || []).length).toBe(5);
    expect((html.match(/System/g) || []).length).toBe(5);
  });
});
