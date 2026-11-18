import {
  filterOpenTickets,
  drillTitle,
  CFD_DRILL_HERO_KEYS,
} from '../../components/CfdCfi/openTicketsFilter';

describe('openTicketsFilter', () => {
  const rows = [
    { key: 'A-1', priority: 'Blocker - P0', status: 'Open', ageDays: 20 },
    { key: 'A-2', priority: 'Critical - P1', status: 'In Progress', ageDays: 5 },
    { key: 'A-3', priority: 'Major - P2', status: 'Resolved', ageDays: 30 },
    { key: 'A-4', priority: 'Major - P2', status: 'Open', ageDays: 2 },
  ];

  test('openNow returns all', () => {
    expect(filterOpenTickets(rows, 'openNow')).toHaveLength(4);
  });

  test('agedOpen filters by ageDays', () => {
    const out = filterOpenTickets(rows, 'agedOpen', { agedDays: 14 });
    expect(out.map((r) => r.key).sort()).toEqual(['A-1', 'A-3']);
  });

  test('p0Open / p1Open match priority labels', () => {
    expect(filterOpenTickets(rows, 'p0Open').map((r) => r.key)).toEqual(['A-1']);
    expect(filterOpenTickets(rows, 'p1Open').map((r) => r.key)).toEqual(['A-2']);
  });

  test('tbv matches Resolved status', () => {
    expect(filterOpenTickets(rows, 'tbv').map((r) => r.key)).toEqual(['A-3']);
  });

  test('drillTitle includes KPI name', () => {
    expect(drillTitle('openNow', 'Top-CFD')).toBe('Open now — Top-CFD');
  });

  test('drillTitle does not fall back to Open now for Created', () => {
    expect(drillTitle('createdWindow', 'Top-CFD')).toBe('Created — Top-CFD');
    expect(drillTitle('resolvedWindow', 'Top-CFD')).toMatch(/^Resolved/);
  });

  test('CFD_DRILL_HERO_KEYS lists open-family modes only', () => {
    expect(CFD_DRILL_HERO_KEYS).toEqual(
      expect.arrayContaining(['openNow', 'agedOpen', 'p0Open', 'p1Open', 'tbv'])
    );
    expect(CFD_DRILL_HERO_KEYS).not.toContain('createdWindow');
  });
});
