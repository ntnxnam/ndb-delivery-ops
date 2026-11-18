import fs from 'fs';
import path from 'path';
import { generateTableHTMLForEmail } from '../../utils/emailTableGenerator';

const cellPath = path.join(__dirname, '../../components/ReleaseVersionTableCell.js');
const emailPath = path.join(__dirname, '../../utils/emailTableGenerator.js');
const configPath = path.join(__dirname, '../../../../server/config/releaseVersionsColumnsConfig.json');

const cellSrc = fs.readFileSync(cellPath, 'utf8');
const emailSrc = fs.readFileSync(emailPath, 'utf8');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function makeTcmsQuality() {
  const mk = (v) => ({
    functional: {
      manual: { qi: v, run: 10, passed: 8, failed: 2, rate: 80 },
      automation: { qi: v + 5, run: 20, passed: 18, failed: 2, rate: 90 },
    },
    system: {
      manual: { qi: v - 10, run: 15, passed: 10, failed: 5, rate: 66 },
      automation: { qi: v + 2, run: 25, passed: 22, failed: 3, rate: 88 },
    },
  });
  return {
    releaseOverall: mk(80),
    releaseLast3Weeks: mk(81),
    masterOverall: mk(82),
    masterLast3Weeks: mk(83),
  };
}

describe('ReleaseVersionTableCell — TCMS Quality Functional/System rows (static + email parity)', () => {
  test('UT-UI-001: ReleaseVersionTableCell rows array is Functional/System only', () => {
    expect(cellSrc).toContain("{ label: 'Functional', key: 'functional' }");
    expect(cellSrc).toContain("{ label: 'System', key: 'system' }");
    // Negative: old 3-row definition must not exist
    expect(cellSrc).not.toMatch(/\{ label: 'Overall', key: 'overall' \}/);
    // Automation as row was removed — ensure no row entry for it
    const rowsBlock = cellSrc.match(/function renderQualityTable[\s\S]*?const rows = \[([\s\S]*?)\];/);
    expect(rowsBlock).toBeTruthy();
    expect(rowsBlock[1]).not.toContain("'Automation'");
    expect(rowsBlock[1]).not.toContain("'Overall'");
  });

  test('UT-UI-002: emailTableGenerator rows array mirrors UI — Functional/System', () => {
    expect(emailSrc).toContain("{ label: 'Functional', key: 'functional' }");
    expect(emailSrc).toContain("{ label: 'System', key: 'system' }");
    const rowsBlock = emailSrc.match(/const rows = \[([\s\S]*?)\];/);
    expect(rowsBlock).toBeTruthy();
    expect(rowsBlock[1]).not.toContain("'Overall'");
  });

  test('UT-UI-003: a11y — th scope row/col present in both UI and email', () => {
    expect(cellSrc).toContain('scope="row"');
    expect(cellSrc).toContain('scope="col"');
    expect(emailSrc).toContain('scope="row"');
    expect(emailSrc).toContain('scope="col"');
  });

  test('UT-UI-004: comment updated to 2×2 (Functional/System × Manual/Automation)', () => {
    expect(cellSrc).toContain('2×2 (Functional/System × Manual/Automation)');
    expect(cellSrc).not.toContain('3×2 (Overall/Functional/Automation');
  });

  test('UT-UI-005: config description documents 2 rows Functional/System', () => {
    const desc = config.columns.quality.description;
    expect(desc).toMatch(/2 rows \(Functional\/System\)/);
    expect(desc).not.toMatch(/Overall\/Functional\/Automation/);
  });

  test('UT-UI-006: legacy overall fallback exists for back-compat', () => {
    expect(cellSrc).toContain("rowData?.overall");
    expect(emailSrc).toContain("data.overall");
  });

  // Functional UI behavior verified via email generator HTML (parity proxy — same rows/cols)
  test('UT-UI-007: rendered HTML has 4 tables each with Functional/System row headers', () => {
    const tcmsQuality = makeTcmsQuality();
    const item = { key: 'FEAT-1', summary: 'Test', status: 'In Progress', fixVersions: 'NDB-2.12', assignee: 'a@test.com', customfield_10860: null, customfield_27764: null, customfield_23073: null, customfield_23560: null, tcmsQuality, tcmsQI: null };
    const columnsConfig = { columnOrder: ['key', 'quality'], columns: { key: { label: 'Key', includeInUI: true, order: 1 }, quality: { label: 'Quality', includeInUI: true, order: 2 } } };
    const html = generateTableHTMLForEmail({ commit: [item] }, {}, 'NDB-2.12', columnsConfig, () => null, () => null, () => null, () => null, 'https://jira.nutanix.com');
    expect((html.match(/Functional/g) || []).length).toBe(5);
    expect((html.match(/System/g) || []).length).toBe(5);
    expect(html).toContain('scope="row"');
    expect(html).toContain('Manual</th>');
    expect(html).toContain('Automation</th>');
  });

  test('UT-UI-008: regression — no Overall/Automation row th in rendered HTML', () => {
    const tcmsQuality = makeTcmsQuality();
    const item = { key: 'FEAT-1', summary: 'Test', status: 'In Progress', fixVersions: 'NDB-2.12', assignee: 'a@test.com', customfield_10860: null, customfield_27764: null, customfield_23073: null, customfield_23560: null, tcmsQuality, tcmsQI: null };
    const columnsConfig = { columnOrder: ['key', 'quality'], columns: { key: { label: 'Key', includeInUI: true, order: 1 }, quality: { label: 'Quality', includeInUI: true, order: 2 } } };
    const html = generateTableHTMLForEmail({ commit: [item] }, {}, 'NDB-2.12', columnsConfig, () => null, () => null, () => null, () => null);
    expect(html).not.toMatch(/<th scope="row"[^>]*>Overall<\/th>/);
    expect(html).not.toMatch(/<th scope="row"[^>]*>Automation<\/th>/);
  });

  test('UT-UI-009: QI null renders — without trailing %', () => {
    const tcmsQuality = {
      releaseOverall: { functional: { manual: { qi: null, run: 10, passed: 5, failed: 5, rate: null }, automation: null }, system: { manual: null, automation: null } },
      releaseLast3Weeks: null, masterOverall: null, masterLast3Weeks: null,
    };
    const item = { key: 'FEAT-1', summary: 'T', status: 'In Progress', fixVersions: 'NDB-2.12', assignee: 'a@test.com', customfield_10860: null, customfield_27764: null, customfield_23073: null, customfield_23560: null, tcmsQuality, tcmsQI: null };
    const columnsConfig = { columnOrder: ['key', 'quality'], columns: { key: { label: 'Key', includeInUI: true, order: 1 }, quality: { label: 'Quality', includeInUI: true, order: 2 } } };
    const html = generateTableHTMLForEmail({ commit: [item] }, {}, 'NDB-2.12', columnsConfig, () => null, () => null, () => null, () => null);
    expect(html).toContain('QI —');
    expect(html).not.toContain('—%');
  });

  test('UT-UI-010: legacy overall fallback System row shows overall data', () => {
    const tcmsQuality = {
      releaseOverall: {
        functional: { manual: { qi: 10, run: 1, passed: 1, failed: 0, rate: 100 }, automation: { qi: 20, run: 2, passed: 2, failed: 0, rate: 100 } },
        overall: { manual: { qi: 99, run: 99, passed: 99, failed: 0, rate: 99 }, automation: { qi: 99, run: 99, passed: 99, failed: 0, rate: 99 } },
      },
      releaseLast3Weeks: null, masterOverall: null, masterLast3Weeks: null,
    };
    const item = { key: 'FEAT-1', summary: 'T', status: 'In Progress', fixVersions: 'NDB-2.12', assignee: 'a@test.com', customfield_10860: null, customfield_27764: null, customfield_23073: null, customfield_23560: null, tcmsQuality, tcmsQI: null };
    const columnsConfig = { columnOrder: ['key', 'quality'], columns: { key: { label: 'Key', includeInUI: true, order: 1 }, quality: { label: 'Quality', includeInUI: true, order: 2 } } };
    const html = generateTableHTMLForEmail({ commit: [item] }, {}, 'NDB-2.12', columnsConfig, () => null, () => null, () => null, () => null);
    expect(html).toContain('QI 99%');
  });
});
