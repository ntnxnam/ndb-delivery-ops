const {
  getQuarterRange,
  quarterContaining,
  lastNQuartersWindow,
  weekBucketsInRange,
} = require('../../utils/nutanixQuarters');

describe('nutanixQuarters', () => {
  it('defines Q1 from Aug 1', () => {
    expect(getQuarterRange(2026, 'Q1')).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-10-31',
    });
  });

  it('maps mid-October into Q1 of that Aug-start year', () => {
    const q = quarterContaining(new Date(2026, 9, 16)); // Oct 16 2026
    expect(q.fiscalYear).toBe(2026);
    expect(q.quarter).toBe('Q1');
    expect(q.startDate).toBe('2026-08-01');
  });

  it('maps May into Q4 of prior Aug-start FY', () => {
    const q = quarterContaining(new Date(2026, 4, 15)); // May 15 2026
    expect(q.fiscalYear).toBe(2025);
    expect(q.quarter).toBe('Q4');
    expect(q.startDate).toBe('2026-05-01');
  });

  it('last 2 quarters from Oct 2026 starts at prior Q4 (May 1)', () => {
    const win = lastNQuartersWindow(2, new Date(2026, 9, 16));
    expect(win.start).toBe('2026-05-01');
    expect(win.end).toBe('2026-10-16');
    expect(win.quarters).toHaveLength(2);
    expect(win.quarters[0].quarter).toBe('Q4');
    expect(win.quarters[1].quarter).toBe('Q1');
  });

  it('builds Monday-aligned week buckets inside a range', () => {
    const buckets = weekBucketsInRange('2026-08-01', '2026-08-20');
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets[0].weekStart).toBeDefined();
    expect(buckets[0].weekEnd >= buckets[0].weekStart).toBe(true);
  });
});
