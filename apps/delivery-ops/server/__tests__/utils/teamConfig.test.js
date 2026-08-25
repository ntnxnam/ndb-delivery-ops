const {
  normalizeTeamId,
  normalizeTeamsList,
  findTeamInList,
  getTeamBaseFilter,
  getTeamById,
} = require('../../utils/teamConfig');

describe('teamConfig', () => {
  test('normalizeTeamId trims and lowercases', () => {
    expect(normalizeTeamId(' NDB ')).toBe('ndb');
    expect(normalizeTeamId(null)).toBe('');
  });

  test('normalizeTeamsList accepts array or map', () => {
    expect(normalizeTeamsList([{ id: 'ndb' }])).toEqual([{ id: 'ndb' }]);
    expect(normalizeTeamsList({ ndb: { name: 'NDB' } })).toEqual([{ name: 'NDB', id: 'ndb' }]);
    expect(normalizeTeamsList(null)).toEqual([]);
  });

  test('findTeamInList is case-insensitive', () => {
    const teams = [{ id: 'ndb', baseFilter: 'filter=NDB-All-Base-Filter' }];
    expect(findTeamInList(teams, 'NDB').id).toBe('ndb');
    expect(findTeamInList(teams, 'ndb').baseFilter).toBe('filter=NDB-All-Base-Filter');
    expect(findTeamInList(teams, 'missing')).toBeNull();
  });

  test('getTeamBaseFilter resolves the configured NDB team regardless of case', () => {
    const lower = getTeamBaseFilter('ndb');
    const upper = getTeamBaseFilter('NDB');
    expect(lower).toBeTruthy();
    expect(upper).toBe(lower);
    expect(getTeamById('NDB').id).toBe('ndb');
  });
});
