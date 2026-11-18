jest.mock('axios');
jest.mock('../../utils/simpleCache', () => ({
  tcmsCache: { get: jest.fn(() => null), set: jest.fn() },
}));

const axios = require('axios');
const {
  buildTcmsQueryUrl,
  enrichItemWithQuality,
  enrichItemWithTCMS,
} = require('../../services/tcmsService');

describe('tcmsService — TCMS table rows Functional/System', () => {
  beforeEach(() => jest.clearAllMocks());

  // Helper to mock both quality_index and milestone metrics endpoints
  function mockAxiosSuccess(qiValue = 85) {
    axios.get.mockImplementation((url, opts) => {
      if (url.includes('/quality_index')) {
        const featKey = opts?.params?.feats || 'FEAT-1';
        return Promise.resolve({
          data: {
            date: '2026-05-06',
            QI: qiValue,
            feats: [{ name: featKey, QI: qiValue }],
            teams: [{ name: 'ndb-2.12/FUNCTIONAL', QI: qiValue }],
          },
        });
      }
      if (url.includes('/milestone_all_test_cases/aggregate/metrics')) {
        return Promise.resolve({
          data: {
            data: [
              {
                average_total_op_success_percentage: qiValue,
                total: 100,
                run: 90,
                passed: 80,
                failed: 10,
                average_manual_op_success_percentage: 75,
                manual_run: 40,
                manual_passed: 30,
                manual_failed: 10,
                manual_passed_percentage: 75,
                average_automation_op_success_percentage: 88,
                automation_run: 50,
                automation_passed: 44,
                automation_failed: 6,
                automation_passed_percentage: 88,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    axios.post.mockResolvedValue({ data: { total: 100 } });
  }

  // 1
  test('UT-TCMS-001: buildTcmsQueryUrl constructs correct TCMS URL', () => {
    const url = buildTcmsQueryUrl('FEAT-123', 'NDB-2.12');
    expect(url).toContain('https://tcms.eng.nutanix.com/#/testcases/NDB/2.12/qcow2');
    expect(url).toContain('FEAT-123');
    expect(url).toContain('Requirements');
  });

  // 2
  test('UT-TCMS-002: enrichItemWithQuality produces { functional, system } only', async () => {
    mockAxiosSuccess(85);
    const item = { key: 'FEAT-1' };
    await enrichItemWithQuality(item, 'NDB-2.12', false);
    expect(item.tcmsQuality).toBeTruthy();
    const table = item.tcmsQuality.releaseOverall;
    expect(table).toBeTruthy();
    expect(Object.keys(table).sort()).toEqual(['functional', 'system']);
    expect(table).not.toHaveProperty('overall');
    // automation as top-level key must not exist (only as column)
    expect(table).not.toHaveProperty('automation');
    expect(table.functional).toHaveProperty('manual');
    expect(table.functional).toHaveProperty('automation');
    expect(table.system).toHaveProperty('manual');
    expect(table.system).toHaveProperty('automation');
  });

  // 3
  test('UT-TCMS-003: toTable functional and system share same leaf until TCMS split (documented clone)', async () => {
    mockAxiosSuccess(80);
    const item = { key: 'FEAT-2' };
    await enrichItemWithQuality(item, 'NDB-2.12', false);
    const tbl = item.tcmsQuality.releaseOverall;
    // Currently both rows share same source — intentional until TCMS category filter lands
    expect(tbl.functional.manual).toEqual(tbl.system.manual);
    expect(tbl.functional.automation).toEqual(tbl.system.automation);
  });

  // 4
  test('UT-TCMS-004: isLongTerm=true nulls branch tables', async () => {
    mockAxiosSuccess(90);
    const item = { key: 'FEAT-3' };
    await enrichItemWithQuality(item, 'NDB-2.12', true);
    expect(item.tcmsQuality.releaseOverall).toBeNull();
    expect(item.tcmsQuality.releaseLast3Weeks).toBeNull();
    expect(item.tcmsQuality.masterOverall).toBeTruthy();
    expect(item.tcmsQuality.masterOverall.functional).toBeTruthy();
    expect(item.tcmsQuality.masterOverall.system).toBeTruthy();
  });

  // 5
  test('UT-TCMS-005: failure path still sets tcmsQueryUrl and null tables', async () => {
    axios.get.mockRejectedValue(new Error('network down'));
    axios.post.mockRejectedValue(new Error('down'));
    const item = { key: 'FEAT-FAIL' };
    await enrichItemWithQuality(item, 'NDB-2.12', false);
    expect(item.tcmsQueryUrl).toContain('FEAT-FAIL');
    // When TCMS is down, enrich returns object with all tables null (not null object) — verify graceful degradation
    expect(item.tcmsQuality).toBeTruthy();
    expect(item.tcmsQuality.releaseOverall).toBeNull();
    expect(item.tcmsQuality.masterOverall).toBeNull();
    expect(item.tcmsQI.master).toBeNull();
    expect(item.tcmsQI.branch).toBeNull();
  });

  // 6
  test('UT-TCMS-006: masterOverall and releaseOverall both have 2-row shape', async () => {
    mockAxiosSuccess(77);
    const item = { key: 'FEAT-4' };
    await enrichItemWithQuality(item, 'NDB-2.12', false);
    for (const k of ['releaseOverall', 'releaseLast3Weeks', 'masterOverall', 'masterLast3Weeks']) {
      const tbl = item.tcmsQuality[k];
      if (tbl) {
        expect(Object.keys(tbl)).toEqual(expect.arrayContaining(['functional', 'system']));
        expect(Object.keys(tbl)).toHaveLength(2);
      }
    }
  });

  // 7
  test('UT-TCMS-007: enrichItemWithTCMS alias matches enrichItemWithQuality', async () => {
    mockAxiosSuccess(85);
    const item = { key: 'FEAT-ALIAS' };
    await enrichItemWithTCMS(item, 'NDB-2.12', false);
    expect(item.tcmsQuality).toBeTruthy();
    expect(item.tcmsQuality.releaseOverall).toHaveProperty('functional');
    expect(item.tcmsQuality.releaseOverall).toHaveProperty('system');
  });

  // 8
  test('UT-TCMS-008: config description mentions 2 rows Functional/System and not old 3-row label', () => {
    const cfg = require('../../config/releaseVersionsColumnsConfig.json');
    const desc = cfg.columns.quality.description;
    expect(desc).toMatch(/2 rows \(Functional\/System\)/);
    expect(desc).toMatch(/Manual\/Automation/);
    expect(desc).not.toMatch(/Overall\/Functional\/Automation/);
  });

  // 9
  test('UT-TCMS-009: null metric returns null table (null-guard)', async () => {
    axios.get.mockResolvedValue({ data: null });
    axios.post.mockResolvedValue({ data: {} });
    const item = { key: 'FEAT-NULL' };
    await enrichItemWithQuality(item, 'NDB-2.12', false);
    // When all fetches return null, tables should be null
    expect(item.tcmsQuality.releaseOverall).toBeNull();
    expect(item.tcmsQuality.masterOverall).toBeNull();
  });

  // 10 — regression: old Overall row must not appear as table key
  test('UT-TCMS-010: regression — no Overall key in any tcmsQuality table', async () => {
    mockAxiosSuccess(85);
    const item = { key: 'FEAT-REG' };
    await enrichItemWithQuality(item, 'NDB-2.12', false);
    const allTables = Object.values(item.tcmsQuality).filter(Boolean);
    for (const tbl of allTables) {
      expect(tbl).not.toHaveProperty('overall');
      expect(tbl).not.toHaveProperty('Overall');
    }
  });

  // 11 — fishy fix: Last 4 weeks must not echo Overall when no recent runs
  test('UT-TCMS-011: Last 4 weeks null when no recent milestone metrics (no fallback to Overall)', async () => {
    // Mock: Overall metrics return data, Last 4 Week metrics return empty (no row)
    axios.get.mockImplementation((url, opts) => {
      const timeFilter = opts?.params?.time_filter;
      if (url.includes('/quality_index')) {
        const featKey = opts?.params?.feats || 'FEAT-FISHY';
        return Promise.resolve({ data: { date: '2026-05-06', QI: 80, feats: [{ name: featKey, QI: 80 }], teams: [] } });
      }
      if (url.includes('/milestone_all_test_cases/aggregate/metrics')) {
        if (timeFilter === 'Last 4 Week') {
          // Simulate no runs in last 4 weeks
          return Promise.resolve({ data: { data: [] } });
        }
        return Promise.resolve({
          data: {
            data: [
              {
                average_total_op_success_percentage: 80,
                total: 100,
                run: 90,
                passed: 80,
                failed: 10,
                average_manual_op_success_percentage: 75,
                manual_run: 40,
                manual_passed: 30,
                manual_failed: 10,
                manual_passed_percentage: 75,
                average_automation_op_success_percentage: 88,
                automation_run: 50,
                automation_passed: 44,
                automation_failed: 6,
                automation_passed_percentage: 88,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    axios.post.mockResolvedValue({ data: { total: 100 } });
    const item = { key: 'FEAT-FISHY' };
    await enrichItemWithQuality(item, 'NDB-2.12', false);
    // Overall should have data, Last 4 weeks should be null (not duplicate)
    expect(item.tcmsQuality.releaseOverall).toBeTruthy();
    expect(item.tcmsQuality.releaseLast3Weeks).toBeNull();
    expect(item.tcmsQuality.masterLast3Weeks).toBeNull();
    // Ensure not same object
    if (item.tcmsQuality.releaseOverall && item.tcmsQuality.releaseLast3Weeks) {
      expect(item.tcmsQuality.releaseOverall).not.toEqual(item.tcmsQuality.releaseLast3Weeks);
    }
  });
});
