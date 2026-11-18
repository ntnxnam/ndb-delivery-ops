const { segmentPhases } = require('../../utils/sprintPerformanceTimeline');

/** Build ratio points from say/do percents with equal planned weight. */
function pts(pcts) {
  return pcts.map((p) => (p == null ? { num: 0, den: 0 } : { num: p, den: 100 }));
}

describe('segmentPhases', () => {
  test('holds a single phase when the series never shifts enough', () => {
    const phases = segmentPhases(pts([40, 41, 42, 39, 40, 41]), { minLen: 3, minDiffPts: 8 });
    expect(phases).toEqual([{ from: 0, to: 5 }]);
  });

  test('splits on a lasting level drop (closed sprints only — caller trims in-flight)', () => {
    // ~44% then ~33% for 3+ sprints each side
    const early = Array(10).fill(44);
    const late = [33, 34, 31];
    const phases = segmentPhases(pts([...early, ...late]), { minLen: 3, minDiffPts: 8 });
    expect(phases.length).toBeGreaterThanOrEqual(2);
    expect(phases[phases.length - 1]).toEqual({ from: early.length, to: early.length + late.length - 1 });
  });

  test('refuses splits that leave fewer than minLen measurable points', () => {
    const phases = segmentPhases(pts([80, 80, 40, 40, 40, 40]), { minLen: 3, minDiffPts: 8 });
    // first two points alone cannot form a phase
    expect(phases.every((ph) => ph.to - ph.from + 1 >= 3)).toBe(true);
  });

  test('skips zero-denominator points when counting minLen', () => {
    const series = pts([50, 50, null, 50, 30, 30, 30]);
    const phases = segmentPhases(series, { minLen: 3, minDiffPts: 8 });
    expect(phases.length).toBeGreaterThanOrEqual(1);
  });
});
