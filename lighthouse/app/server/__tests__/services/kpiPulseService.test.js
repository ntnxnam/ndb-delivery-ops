const {
  wrapBase,
  andJql,
  median,
  percentile,
  cell,
  statusChangedDuring,
  seriesCaption,
} = require('../../services/kpiPulseService');

describe('kpiPulseService helpers', () => {
  it('wraps baseJql', () => {
    expect(wrapBase('project = OnCall')).toBe('(project = OnCall)');
  });

  it('rejects empty baseJql', () => {
    expect(() => wrapBase('')).toThrow(/baseJql/);
  });

  it('ands clauses', () => {
    expect(andJql('(a)', 'created >= "2026-01-01"')).toBe('(a) AND created >= "2026-01-01"');
  });

  it('computes median and p90', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it('builds clickable cells', () => {
    expect(cell(3, 'project = X')).toEqual({ count: 3, jql: 'project = X' });
  });

  it('net burn and top dwell must not pretend to be searchCount cells', () => {
    // Contract guard — derived metrics use jql: null (enforced in buildPulse)
    const derivedNet = { count: -3, jql: null, createdCount: 10, resolvedCount: 7 };
    const derivedDwell = { status: 'Waiting', count: 5, unit: 'days', jql: null };
    expect(derivedNet.jql).toBeNull();
    expect(derivedDwell.jql).toBeNull();
  });

  it('statusChangedDuring composes base + after/before window', () => {
    const jql = statusChangedDuring('(filter=1)', 'Closed', '2026-09-14', '2026-09-20');
    expect(jql).toContain('(filter=1)');
    expect(jql).toContain('status changed to "Closed" after "2026-09-14" before "2026-09-21"');
  });

  it('seriesCaption prefers Closed outflow over legacy resolved', () => {
    const series = [
      { created: { count: 2 }, closed: { count: 0 }, toResolved: { count: 1 } },
      { created: { count: 1 }, closed: { count: 3 }, toResolved: { count: 2 } },
    ];
    expect(seriesCaption(series)).toMatch(/Closed ahead|Created ahead|even/i);
  });

  it('seriesCaption names resolutiondate outflow when transitions are empty', () => {
    const series = [
      { created: { count: 1 }, closed: { count: 0 }, toResolved: { count: 0 }, resolved: { count: 4 } },
      { created: { count: 2 }, closed: { count: 0 }, toResolved: { count: 0 }, resolved: { count: 5 } },
    ];
    expect(seriesCaption(series, { outflowMode: 'resolutiondate' })).toMatch(
      /Done \(resolution date\) ahead of created/i
    );
  });
});
