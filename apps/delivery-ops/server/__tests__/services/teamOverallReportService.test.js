const service = require('../../services/teamOverallReportService');

describe('teamOverallReportService', () => {
  it('resolveDateRange quarter 2025-Q2', () => {
    const r = service.resolveDateRange({ periodType: 'quarter', quarter: '2025-Q2' });
    expect(r.start).toBe('2025-04-01');
    expect(r.end).toBe('2025-06-30');
  });
  it('resolveDateRange year 2025', () => {
    const r = service.resolveDateRange({ periodType: 'year', year: '2025' });
    expect(r.start).toBe('2025-01-01');
    expect(r.end).toBe('2025-12-31');
  });
  it('resolveDateRange custom', () => {
    const r = service.resolveDateRange({ periodType: 'custom', startDate: '2025-01-01', endDate: '2025-01-31' });
    expect(r.start).toBe('2025-01-01');
    expect(r.end).toBe('2025-01-31');
  });
  it('resolveDateRange invalid quarter throws', () => {
    expect(() => service.resolveDateRange({ periodType: 'quarter', quarter: '2025-Q5' })).toThrow();
  });
  it('getTeamConfig ndb returns team', () => {
    const t = service.getTeamConfig('ndb');
    expect(t).not.toBeNull();
    expect(t.id).toBe('ndb');
    expect(t.baseFilter).toContain('NDB-All-Base-Filter');
  });
  it('getTeamConfig unknown returns null', () => {
    const t = service.getTeamConfig('nonexistent');
    expect(t).toBeNull();
  });
});
