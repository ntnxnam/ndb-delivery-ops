/**
 * Cadence window ends on the in-flight sprint (floor of today vs anchor).
 * Stays put until the next sprint start (~3 weeks), then rolls forward and
 * the lookback (~windowSlots ≈ 18 months) is measured from that new end.
 */
const { slotFor, currentSlotFor, selectWindowSprints } = require('../../services/sprintPerformanceService');

const anchor = { startIso: '2026-10-07', number: 60 };
const sprintDays = 21;

describe('sprintPerformance window (today and before)', () => {
  test('slotFor labels sprint starts on the cadence', () => {
    expect(slotFor('2026-09-16', anchor, sprintDays)).toBe(59);
    expect(slotFor('2026-10-07', anchor, sprintDays)).toBe(60);
    expect(slotFor('2026-10-28', anchor, sprintDays)).toBe(61);
  });

  test('currentSlotFor stays on the Oct-7 sprint until Oct 28', () => {
    // S60 floor 2026-10-07 → through 2026-10-27; S61 starts 2026-10-28
    expect(currentSlotFor('2026-10-07T08:00:00.000Z', anchor, sprintDays)).toBe(60);
    expect(currentSlotFor('2026-10-08T12:00:00.000Z', anchor, sprintDays)).toBe(60);
    expect(currentSlotFor('2026-10-17T12:00:00.000Z', anchor, sprintDays)).toBe(60);
    expect(currentSlotFor('2026-10-27T12:00:00.000Z', anchor, sprintDays)).toBe(60);
    expect(currentSlotFor('2026-10-28T00:00:00.000Z', anchor, sprintDays)).toBe(61);
  });

  test('window includes in-flight sprint; rolls on next start; excludes future starts', () => {
    const board = [
      { id: 1, name: 'NDB-Team-S59', originBoardId: 2888, state: 'closed', startDate: '2026-09-16T00:00:00.000Z', endDate: '2026-10-06' },
      { id: 2, name: 'NDB-Team-S60', originBoardId: 2888, state: 'active', startDate: '2026-10-07T00:00:00.000Z', endDate: '2026-10-27' },
      { id: 3, name: 'NDB-Team-S61', originBoardId: 2888, state: 'future', startDate: '2026-10-28T00:00:00.000Z', endDate: '2026-11-17' },
    ];
    const opts = { boardId: 2888, anchor, sprintDays, windowSlots: 6, teamPrefix: 'NDB' };

    const duringS60 = selectWindowSprints(board, { ...opts, today: new Date('2026-10-17T12:00:00.000Z') });
    expect(duringS60.map((s) => s.slot).sort()).toEqual([59, 60]); // floor Oct 7 → include S60
    expect(duringS60.some((s) => s.slot === 61)).toBe(false);

    const onOct28 = selectWindowSprints(board, { ...opts, today: new Date('2026-10-28T12:00:00.000Z') });
    expect(onOct28.map((s) => s.slot).sort()).toEqual([59, 60, 61]); // new end → look back from 28 Oct
  });
});
