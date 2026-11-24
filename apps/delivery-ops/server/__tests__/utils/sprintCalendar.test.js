const {
  parseSprintCalendar,
  inferSprintCalendarFromSprints,
  collectSprintCalendarFromBoard,
  snapSprintDays,
} = require('../../utils/sprintCalendar');

describe('sprintCalendar', () => {
  describe('parseSprintCalendar', () => {
    it('accepts a valid calendar', () => {
      expect(parseSprintCalendar({ s1StartIso: '2024-10-23', sprintDays: 21 })).toEqual({
        s1StartIso: '2024-10-23',
        sprintDays: 21,
      });
    });

    it('rejects missing, malformed, or out-of-range values', () => {
      expect(parseSprintCalendar(null)).toBeNull();
      expect(parseSprintCalendar({ s1StartIso: '2024/10/23', sprintDays: 21 })).toBeNull();
      expect(parseSprintCalendar({ s1StartIso: '2024-10-23', sprintDays: 0 })).toBeNull();
      expect(parseSprintCalendar({ s1StartIso: '2024-10-23', sprintDays: 14.5 })).toBeNull();
    });
  });

  describe('snapSprintDays', () => {
    it('snaps near-standard cadences', () => {
      expect(snapSprintDays(20)).toBe(21);
      expect(snapSprintDays(14)).toBe(14);
      expect(snapSprintDays(7)).toBe(7);
      expect(snapSprintDays(30)).toBe(30);
    });
  });

  describe('inferSprintCalendarFromSprints', () => {
    it('uses a named S1 and snaps 21-day inclusive windows', () => {
      const inferred = inferSprintCalendarFromSprints([
        { name: 'Sprint 2', startDate: '2024-11-13T00:00:00.000Z', endDate: '2024-12-03T00:00:00.000Z' },
        { name: 'S1', startDate: '2024-10-23T00:00:00.000Z', endDate: '2024-11-12T00:00:00.000Z' },
      ]);
      expect(inferred.s1StartIso).toBe('2024-10-23');
      expect(inferred.sprintDays).toBe(21);
      expect(inferred.inferredFrom.namedS1).toBe(true);
    });

    it('falls back to the earliest dated sprint when none is named S1', () => {
      const inferred = inferSprintCalendarFromSprints([
        { name: 'MSP 12', startDate: '2025-01-08T00:00:00.000Z', endDate: '2025-01-21T00:00:00.000Z' },
        { name: 'MSP 11', startDate: '2024-12-25T00:00:00.000Z', endDate: '2025-01-07T00:00:00.000Z' },
      ]);
      expect(inferred.s1StartIso).toBe('2024-12-25');
      expect(inferred.sprintDays).toBe(14);
      expect(inferred.inferredFrom.namedS1).toBe(false);
    });

    it('throws when the board has no dated sprints', () => {
      expect(() => inferSprintCalendarFromSprints([{ name: 'Future' }])).toThrow(/no dated sprints/);
    });

    it('uses recent 10 sprints for 21d cadence — 15x14d old + 8x21d recent => 21', () => {
      const sprints = [];
      // 15 old 14-day sprints
      for (let i = 0; i < 15; i += 1) {
        const start = new Date(Date.UTC(2023, 0, 1 + i * 14));
        const end = new Date(Date.UTC(2023, 0, 14 + i * 14));
        sprints.push({ name: `S${i + 1}`, startDate: start.toISOString(), endDate: end.toISOString() });
      }
      // 8 recent 21-day sprints
      for (let i = 0; i < 8; i += 1) {
        const start = new Date(Date.UTC(2024, 5, 1 + i * 21));
        const end = new Date(Date.UTC(2024, 5, 21 + i * 21));
        sprints.push({ name: `S${16 + i}`, startDate: start.toISOString(), endDate: end.toISOString() });
      }
      const inferred = inferSprintCalendarFromSprints(sprints);
      expect(inferred.sprintDays).toBe(21);
    });
  });

  describe('collectSprintCalendarFromBoard', () => {
    it('reads the board then infers from paginated sprints', async () => {
      const get = jest.fn()
        .mockResolvedValueOnce({ data: { id: 99, name: 'Prism Infra', type: 'scrum' } })
        .mockResolvedValueOnce({
          data: {
            isLast: true,
            values: [
              { id: 1, name: 'S1', startDate: '2024-10-23T00:00:00.000Z', endDate: '2024-11-12T00:00:00.000Z' },
            ],
          },
        });

      const collected = await collectSprintCalendarFromBoard({ get }, 99);
      expect(collected.board.name).toBe('Prism Infra');
      expect(collected.sprintCalendar).toEqual({ s1StartIso: '2024-10-23', sprintDays: 21 });
      expect(get).toHaveBeenNthCalledWith(1, '/rest/agile/1.0/board/99', expect.any(Object));
    });

    it('stops after four sprint pages so a long board cannot hang Detect', async () => {
      const get = jest.fn(async (url) => {
        if (String(url).endsWith('/sprint')) {
          return {
            data: {
              isLast: false,
              values: [{ name: 'S1', startDate: '2024-10-23T00:00:00.000Z', endDate: '2024-11-12T00:00:00.000Z' }],
            },
          };
        }
        return { data: { id: 99, name: 'Board' } };
      });
      await collectSprintCalendarFromBoard({ get }, 99);
      const sprintCalls = get.mock.calls.filter((call) => String(call[0]).endsWith('/sprint'));
      expect(sprintCalls).toHaveLength(4);
    });
  });
});
