const {
  wrapTeamScope,
  sprintScopeFromBaseFilter,
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

  test('hoists ORDER BY outside the AND parentheses', () => {
    expect(wrapTeamScope(
      'filter=prisminfra-all-base-filter',
      '(fixVersion = "MSP-3.2.0.0" OR labels = "msp-3.2.0.0-long-term-funded") AND issuetype IN (Feature, Initiative) AND status != Cancelled ORDER BY key ASC'
    )).toBe(
      '(filter=prisminfra-all-base-filter) AND ((fixVersion = "MSP-3.2.0.0" OR labels = "msp-3.2.0.0-long-term-funded") AND issuetype IN (Feature, Initiative) AND status != Cancelled) ORDER BY key ASC'
    );
  });
});

describe('sprintScopeFromBaseFilter', () => {
  test.each([
    ['filter=NDB-All-Base-Filter and statusCategory!=Done', 'filter=NDB-All-Base-Filter'],
    ['filter=NCN-All-Base-Filter AND statusCategory != "Done"', 'filter=NCN-All-Base-Filter'],
    ['project = X and statusCategory not in (Done) ORDER BY key', 'project = X'],
    ['filter=prisminfra-all-base-filter', 'filter=prisminfra-all-base-filter'],
    ['statusCategory!=Done and project = X', 'statusCategory!=Done and project = X'],
    ['', ''],
    [null, ''],
  ])('%p → %p', (input, expected) => {
    expect(sprintScopeFromBaseFilter(input)).toBe(expected);
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

  test('returns unreleased versions from the team project — one GET, no ticket search', async () => {
    const jira = {
      searchAll: jest.fn(),
      getProjectVersions: async (projectKey) => {
        expect(projectKey).toBe('ENG');
        return [
          { name: 'MSP-2.1', released: false, archived: false, releaseDate: '2026-10-01' },
          { name: 'MSP-2.0', released: true, archived: false, releaseDate: '2026-01-01' },
          { name: 'old', released: false, archived: true, releaseDate: '2025-01-01' },
          { name: 'MSP-2.2', released: false, archived: false, releaseDate: '2026-12-01' },
        ];
      },
    };

    const versions = await listFixVersionsForTeam(
      { id: 'prism-infra', projectKey: 'ENG' },
      jira
    );

    expect(jira.searchAll).not.toHaveBeenCalled();
    expect(versions.map((v) => v.name)).toEqual(['MSP-2.2', 'MSP-2.1']);
    expect(versions.find((v) => v.name === 'MSP-2.1')).toEqual({
      name: 'MSP-2.1',
      released: false,
      releaseDate: '2026-10-01',
    });
  });

  test('does not silently fall back when projectKey is missing', async () => {
    const jira = { getProjectVersions: jest.fn() };
    await expect(listFixVersionsForTeam({ id: 'prism-infra' }, jira))
      .rejects.toThrow(/no projectKey/);
    expect(jira.getProjectVersions).not.toHaveBeenCalled();
  });
});
