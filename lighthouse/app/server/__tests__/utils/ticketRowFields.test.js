const {
  mapExtraTicketFields,
  withExtraTicketFields,
} = require('../../utils/ticketRowFields');

describe('ticketRowFields', () => {
  test('maps components, due date and created', () => {
    expect(
      mapExtraTicketFields({
        components: [{ name: 'Era-Core' }, { name: 'UI' }],
        duedate: '2026-12-01',
        created: '2026-10-30T10:00:00.000+0000',
      })
    ).toEqual({
      components: ['Era-Core', 'UI'],
      dueDate: '2026-12-01',
      created: '2026-10-30T10:00:00.000+0000',
    });
  });

  test('empty fields become [] / null', () => {
    expect(mapExtraTicketFields({})).toEqual({ components: [], dueDate: null, created: null });
    expect(mapExtraTicketFields(undefined)).toEqual({
      components: [],
      dueDate: null,
      created: null,
    });
  });

  test('withExtraTicketFields appends without duplicating', () => {
    const out = withExtraTicketFields('summary,status,created').split(',');
    expect(out).toEqual(['summary', 'status', 'created', 'components', 'duedate']);
  });
});
