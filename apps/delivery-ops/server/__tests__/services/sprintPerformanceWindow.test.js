/**
 * Cadence window: immediately past sprint stays in the report for the whole
 * in-flight sprint; when the next sprint starts, lastSlot rolls forward.
 */
const { slotFor, currentSlotFor, selectWindowSprints } = require('../../services/sprintPerformanceService');

const anchor = { startIso: '2026-10-07', number: 60 };
const sprintDays = 21;

describe('sprintPerformance window (immediately past sprint)', () => {
  test('slotFor labels sprint starts on the cadence', () => {
    expect(slotFor('2026-09-16', anchor, sprintDays)).toBe(59);
    expect(slotFor('2026-10-07', anchor, sprintDays)).toBe(60);
    expect(slotFor('2026-10-28', anchor, sprintDays)).toBe(61);
  });

  test('currentSlotFor stays on in-flight slot for the full 3 weeks (no mid-sprint round-up)', () => {
    // S60: 2026-10-07 → 2026-10-27; S61 starts 2026-10-28
    expect(currentSlotFor('2026-10-07T08:00:00.000Z', anchor, sprintDays)).toBe(60);
    expect(currentSlotFor('2026-10-08T12:00:00.000Z', anchor, sprintDays)).toBe(60);
    expect(currentSlotFor('2026-10-17T12:00:00.000Z', anchor, sprintDays)).toBe(60); // day 10.5 — round would wrongly say 61
    expect(currentSlotFor('2026-10-27T12:00:00.000Z', anchor, sprintDays)).toBe(60);
    expect(currentSlotFor('2026-10-28T00:00:00.000Z', anchor, sprintDays)).toBe(61);
  });

  test('window ends at immediately past slot; rolls forward when next sprint starts', () => {
    const board = [
      { id: 1, name: 'NDB-Team-S59', originBoardId: 2888, state: 'closed', startDate: '2026-09-16T00:00:00.000Z', endDate: '2026-10-06' },
      { id: 2, name: 'NDB-Team-S60', originBoardId: 2888, state: 'active', startDate: '2026-10-07T00:00:00.000Z', endDate: '2026-10-27' },
      { id: 3, name: 'NDB-Team-S61', originBoardId: 2888, state: 'future', startDate: '2026-10-28T00:00:00.000Z', endDate: '2026-11-17' },
    ];
    const opts = { boardId: 2888, anchor, sprintDays, windowSlots: 6, teamPrefix: 'NDB' };

    const duringS60 = selectWindowSprints(board, { ...opts, today: new Date('2026-10-17T12:00:00.000Z') });
    expect(duringS60.map((s) => s.slot)).toEqual([59]); // S60 in flight → past is S59 only among fixtures
    expect(duringS60.every((s) => s.slot === 59)).toBe(true);

    const afterS60 = selectWindowSprints(board, { ...opts, today: new Date('2026-10-28T12:00:00.000Z') });
    expect(afterS60.map((s) => s.slot).sort()).toEqual([59, 60]); // S61 in flight → past includes S60
  });
});
