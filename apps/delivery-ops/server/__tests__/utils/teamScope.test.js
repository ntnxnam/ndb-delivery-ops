const {
  wrapTeamScope,
  requireBaseFilter,
  isUnreleasedVersion,
  pickNextUpcomingGaVersion,
  listFixVersionsForTeam,
  clearFixVersionCache,
} = require('../../utils/teamScope');

describe('wrapTeamScope', () => {
  test('ANDs the team base filter onto ticket JQL', () => {
    expect(wrapTeamScope(
      'filter=NDB-All-Base-Filter and statusCategory!=Done',
      'fixVersion = NDB-2.11 AND status not in (Cancelled, Backlog)'
    )).toBe(
      '(filter=NDB-All-Base-Filter and statusCategory!=Done) AND (fixVersion = NDB-2.11 AND status not in (Cancelled, Backlog))'
    );
  });

  test('passes through when the base filter is missing', () => {
    expect(wrapTeamScope('', 'fixVersion = NDB-2.11')).toBe('fixVersion = NDB-2.11');
    expect(wrapTeamScope(null, 'fixVersion = NDB-2.11')).toBe('fixVersion = NDB-2.11');
  });
});

describe('requireBaseFilter', () => {
  test('throws 400 when Admin has no baseFilter', () => {
    expect(() => requireBaseFilter({ id: 'prism-infra' })).toThrow(/no baseFilter/);
    try {
      requireBaseFilter({ id: 'prism-infra', baseFilter: '  ' });
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });
});

describe('isUnreleasedVersion', () => {
  test('keeps open versions and drops released or archived', () => {
    expect(isUnreleasedVersion({ name: 'NDB-2.11', released: false, archived: false })).toBe(true);
    expect(isUnreleasedVersion({ name: 'NDB-2.10', released: true, archived: false })).toBe(false);
    expect(isUnreleasedVersion({ name: 'old', released: false, archived: true })).toBe(false);
  });
});

describe('pickNextUpcomingGaVersion', () => {
  const now = new Date('2026-08-26T12:00:00Z');

  test('picks the soonest future JIRA releaseDate', () => {
    const versions = [
      { name: 'NDB-2.12', released: false, releaseDate: '2026-12-01' },
      { name: 'NDB-2.11', released: false, releaseDate: '2026-09-15' },
      { name: 'NDB-2.10', released: true, releaseDate: '2026-03-01' },
    ];
    expect(pickNextUpcomingGaVersion(versions, now)).toBe('NDB-2.11');
  });

  test('falls back to the soonest overdue date when none are upcoming', () => {
    const versions = [
      { name: 'NDB-2.9', released: false, releaseDate: '2026-01-01' },
      { name: 'NDB-2.8', released: false, releaseDate: '2025-10-01' },
    ];
    expect(pickNextUpcomingGaVersion(versions, now)).toBe('NDB-2.8');
  });
});

describe('listFixVersionsForTeam', () => {
  beforeEach(() => {
    clearFixVersionCache();
  });

  test('returns distinct fixVersions from tickets in the team baseFilter', async () => {
    const seen = [];
    const jira = {
      searchAll: async (jql) => {
        seen.push(jql);
        return [
          { fields: { fixVersions: [{ name: 'MSP-2.1' }, { name: 'MSP-2.0' }] } },
          { fields: { fixVersions: [{ name: 'MSP-2.1' }] } },
          { fields: { fixVersions: [{ name: 'master' }] } },
        ];
      },
      getProjectVersions: async () => [
        { name: 'MSP-2.1', released: false, releaseDate: '2026-10-01' },
        { name: 'MSP-2.0', released: true, releaseDate: '2026-01-01' },
        { name: 'ERA-ignored', released: false, releaseDate: '2026-09-01' },
      ],
    };

    const versions = await listFixVersionsForTeam(
      { id: 'prism-infra', baseFilter: 'filter=Prism-Infra-Base', projectKey: 'ERA' },
      jira
    );

    expect(seen[0]).toBe('(filter=Prism-Infra-Base) AND (fixVersion is not EMPTY)');
    expect(versions.map((v) => v.name)).toEqual(['MSP-2.1', 'MSP-2.0', 'master']);
    expect(versions.find((v) => v.name === 'MSP-2.1')).toEqual({
      name: 'MSP-2.1',
      released: false,
      releaseDate: '2026-10-01',
    });
    expect(versions.find((v) => v.name === 'ERA-ignored')).toBeUndefined();
  });

  test('does not silently fall back when baseFilter is missing', async () => {
    const jira = { searchAll: jest.fn() };
    await expect(listFixVersionsForTeam({ id: 'prism-infra' }, jira))
      .rejects.toThrow(/no baseFilter/);
    expect(jira.searchAll).not.toHaveBeenCalled();
  });
});
