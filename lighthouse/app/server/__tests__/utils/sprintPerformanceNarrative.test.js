const {
  buildNarrative,
  closedSeries,
  halves,
  pct,
  ragFor,
  slotIsClosed,
} = require('../../utils/sprintPerformanceMetrics');

const cfg = {
  trendSlots: 3,
  rag: { greenSayDoPct: 75, yellowSayDoPct: 60 },
  improvementAlertPts: 10,
  scopeCreepAlertPct: 20,
  chronicCarryoverSprints: 3,
  minPlannedForRanking: 5,
  staleActiveSprintDays: 7,
};

function slot(n, startIso) {
  return { slot: n, name: `S${n}`, startIso, range: '…' };
}

describe('closedSeries / slotIsClosed', () => {
  test('excludes in-flight cadence slot from trend window', () => {
    const slots = [
      slot(1, '2026-01-07'),
      slot(2, '2026-01-28'),
      slot(3, '2026-02-18'), // ends 2026-03-10 if 21-day sprint
    ];
    const series = slots.map((s) => ({ slot: s.slot, planned: 10, donePlanned: 8 }));
    const closed = closedSeries(series, slots, '2026-03-05T12:00:00.000Z', 21);
    expect(closed.map((x) => x.slot)).toEqual([1, 2]);
    expect(slotIsClosed(slots[2], '2026-03-05', 21)).toBe(false);
    expect(slotIsClosed(slots[1], '2026-03-05', 21)).toBe(true);
  });
});

describe('buildNarrative scope + verdict parity', () => {
  const baseModel = () => {
    const series = [
      { slot: 1, planned: 10, donePlanned: 5 },
      { slot: 2, planned: 10, donePlanned: 6 },
      { slot: 3, planned: 10, donePlanned: 7 },
      { slot: 4, planned: 10, donePlanned: 8 },
      { slot: 5, planned: 10, donePlanned: 9 },
      { slot: 6, planned: 10, donePlanned: 9 },
    ];
    const closed = series; // all closed for this unit test
    const trend = halves(closed, cfg.trendSlots);
    return {
      meta: {
        sprintCount: 6,
        slots: series.map((x) => slot(x.slot, '2026-01-01')),
        allSprintsUrl: 'https://jira.example/issues/?jql=x',
        jiraBaseUrl: 'https://jira.example',
        sprintScope: null,
        releasePrefix: 'NDB-',
        unmappedItems: 0,
        config: cfg,
      },
      overall: {
        series,
        window: { sayDo: 70, scopeCreep: 5, pendingQA: 0, committed: 60, carried: 10, completion: 80 },
        recentSayDo: trend.recent,
        rag: ragFor(trend.recent, cfg),
        trend,
      },
      scrumTeams: [
        {
          name: 'Team-A', unmeasurable: false, active: true,
          window: { sayDo: 90, donePlanned: 9, planned: 10, carried: 1, scopeCreep: 0 },
          trend: { early: 70, recent: 90 },
          url: 'https://jira.example/a',
          sprintIds: [1],
        },
        {
          name: 'Team-B', unmeasurable: false, active: true,
          window: { sayDo: 40, donePlanned: 4, planned: 10, carried: 6, scopeCreep: 30 },
          trend: { early: 60, recent: 40 },
          url: 'https://jira.example/b',
          sprintIds: [2],
        },
      ],
      leaders: [],
      managers: [],
      chronic: [],
      hygiene: { staleActive: [], lateClosed: [], startedEmpty: [] },
      rows: [],
    };
  };

  test('uses scopeLabel instead of hard-coded Org-wide', () => {
    const model = baseModel();
    const { highlights, lowlights } = buildNarrative(model, cfg, { scopeLabel: 'Ashish Kumar' });
    const trendLine = [...highlights, ...lowlights].find((x) => /say\/do/.test(x.text) && /improved|declined/.test(x.text));
    expect(trendLine).toBeTruthy();
    expect(trendLine.text.startsWith('Ashish Kumar say/do')).toBe(true);
    expect(trendLine.text).not.toMatch(/^Org-wide/);
  });

  test('default scopeLabel is Org-wide', () => {
    const model = baseModel();
    const { highlights, lowlights } = buildNarrative(model, cfg);
    const trendLine = [...highlights, ...lowlights].find((x) => /say\/do/.test(x.text) && /improved|declined/.test(x.text));
    expect(trendLine.text.startsWith('Org-wide say/do')).toBe(true);
  });

  test('recentSayDo on model matches trend.recent (verdict ≡ highlight)', () => {
    const model = baseModel();
    expect(model.overall.recentSayDo).toBe(model.overall.trend.recent);
    const recentSlots = model.overall.series.slice(-cfg.trendSlots);
    const manual = pct(
      recentSlots.reduce((a, x) => a + x.donePlanned, 0),
      recentSlots.reduce((a, x) => a + x.planned, 0)
    );
    expect(model.overall.trend.recent).toBe(manual);
  });
});
