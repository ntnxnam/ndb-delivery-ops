const {
  inspectBaseFilter,
  groupFeatureComponents,
  pickBoard,
  selectBoards,
  inspectProject,
} = require('../../services/teamInspectService');
const { slugifyTeamId, normalizeFeatureComponents } = require('../../services/teamAdminService');

const PC = 'customfield_15160';

describe('groupFeatureComponents', () => {
  it('groups primary-component children under their parent component', () => {
    const issues = [
      { fields: { components: [{ name: 'NKP' }], [PC]: { value: 'NKP', child: { value: 'Core' } } } },
      { fields: { components: [{ name: 'NKP' }], [PC]: { value: 'NKP', child: { value: 'UI' } } } },
      { fields: { components: [{ name: 'NDK' }], [PC]: { value: 'NDK', child: { value: 'Core' } } } },
      { fields: { components: [], [PC]: { value: 'CSI' } } },
      { fields: { components: [{ name: 'NKP' }] } },
    ];
    const { components, featureComponents } = groupFeatureComponents(issues, PC);
    expect(components[0]).toEqual({ name: 'NKP', count: 3, primaryComponents: ['Core', 'UI'], suggested: true });
    expect(featureComponents).toEqual({ NKP: ['Core', 'UI'], NDK: ['Core'], CSI: [] });
  });

  it('suggests components with at least 3 tickets or 5% share', () => {
    const issues = [
      ...Array(95).fill({ fields: { components: [{ name: 'NDB' }] } }),
      ...Array(3).fill({ fields: { components: [{ name: 'Era' }] } }),
      { fields: { components: [{ name: 'ux' }] } },
      { fields: { components: [{ name: 'NDK' }] } },
    ];
    const suggested = groupFeatureComponents(issues, PC).components.filter((c) => c.suggested).map((c) => c.name);
    expect(suggested).toEqual(['NDB', 'Era']);
  });
});

describe('pickBoard', () => {
  const boards = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'NCN Scrum' }, { id: 3, name: 'Cloud Native Board' }];

  it('prefers the requested board, then a name match, then the first board', () => {
    expect(pickBoard(boards, { boardId: 3 }).id).toBe(3);
    expect(pickBoard(boards, { teamName: 'cloud native' }).id).toBe(3);
    expect(pickBoard(boards, { projectKey: 'NCN' }).id).toBe(2);
    expect(pickBoard(boards, { teamName: 'zzz' }).id).toBe(1);
    expect(pickBoard([], {})).toBeNull();
  });
});

describe('selectBoards', () => {
  const mixed = [
    { id: 2888, name: 'NDBAllSprintBoard' },
    { id: 4366, name: 'NDB DBE' },
    { id: 1592, name: 'DR-Core-WorkStream-Scrum-Board' },
    { id: 1594, name: 'DR-ASync-WorkStream-Board' },
    { id: 735, name: 'DRaaS - Prism UI - Scrum Board' },
    { id: 3543, name: 'Copy of DR-Runbook-WorkStream-Base-Board' },
    { id: 1268, name: 'API-Infra-Scrum' },
  ];

  it('keeps boards that match the team and holds the NDB project boards back', () => {
    const out = selectBoards(mixed, { teamName: 'Cerebro / DR' });
    expect(out.matchedOn).toBe('team');
    expect(out.boards.map((b) => b.name)).toEqual([
      'DR-ASync-WorkStream-Board',
      'DR-Core-WorkStream-Scrum-Board',
      'Copy of DR-Runbook-WorkStream-Base-Board',
      'DRaaS - Prism UI - Scrum Board',
    ]);
    expect(out.otherBoards.map((b) => b.id)).toEqual([2888, 4366, 1268]);
  });

  it('keeps the project list when no board name matches the team', () => {
    const out = selectBoards(mixed, { teamName: 'Cerebro' });
    expect(out.matchedOn).toBe('project');
    expect(out.boards).toHaveLength(mixed.length);
    expect(out.otherBoards).toEqual([]);
  });
});

describe('inspectBaseFilter', () => {
  function jira(overrides = {}) {
    return {
      get: jest.fn(async (url) => {
        if (url === '/rest/api/2/search') {
          return { data: { total: 3, issues: Array(3).fill({ fields: { project: { key: 'ERA', name: 'Era' } } }) } };
        }
        if (url === '/rest/agile/1.0/board') return { data: { values: [] } };
        throw new Error(`unexpected ${url}`);
      }),
      getProjectVersions: jest.fn().mockResolvedValue([]),
      searchAll: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
  }

  it('reports partial failures without failing the whole detection', async () => {
    const client = jira({ searchAll: jest.fn().mockRejectedValue(new Error('JIRA timeout')) });
    const out = await inspectBaseFilter(client, { baseFilter: 'filter=x', featureProjectKey: 'feat' });
    expect(out.projectKey).toBe('ERA');
    expect(out.feature).toMatchObject({ projectKey: 'FEAT', error: 'JIRA timeout', featureComponents: {} });
    expect(out.board).toMatchObject({ boards: [], boardId: null, calendarError: 'No scrum board found for ERA' });
  });

  it('does not pick the feature project as the main project', async () => {
    const issues = [
      ...Array(4).fill({ fields: { project: { key: 'FEAT', name: 'Features' } } }),
      ...Array(3).fill({ fields: { project: { key: 'ERA', name: 'Era' } } }),
    ];
    const client = jira({
      get: jest.fn(async (url) => (url === '/rest/api/2/search'
        ? { data: { total: 7, issues } }
        : { data: { values: [] } })),
    });
    const out = await inspectBaseFilter(client, { baseFilter: 'filter=x' });
    expect(out.projects.map((p) => p.key)).toEqual(['FEAT', 'ERA']);
    expect(out.projectKey).toBe('ERA');
    expect(client.getProjectVersions).toHaveBeenCalledWith('ERA');
  });

  it('reads the configured board directly even when it is not in the project board list', async () => {
    const get = jest.fn(async (url) => {
      if (url === '/rest/api/2/search') return { data: { total: 1, issues: [{ fields: { project: { key: 'NCN' } } }] } };
      if (url === '/rest/agile/1.0/board') return { data: { values: [{ id: 4053, name: 'Copy of NCN-CAPX' }] } };
      if (url === '/rest/agile/1.0/board/4741') return { data: { id: 4741, name: 'NCN Scrum', type: 'scrum' } };
      if (url === '/rest/agile/1.0/board/4741/sprint') {
        return { data: { isLast: true, values: [{ name: 'S1', startDate: '2020-02-20T00:00:00Z', endDate: '2020-03-05T00:00:00Z' }] } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const out = await inspectBaseFilter(jira({ get }), { baseFilter: 'filter=x', boardId: 4741 });
    expect(out.board).toMatchObject({ boardId: 4741, boardName: 'NCN Scrum', sprintCalendar: { s1StartIso: '2020-02-20' } });
  });

  it('keeps the rest of Detect when the board has no dated sprints', async () => {
    const get = jest.fn(async (url) => {
      if (url === '/rest/api/2/search') return { data: { total: 1, issues: [{ fields: { project: { key: 'DR', name: 'DR' } } }] } };
      if (url === '/rest/agile/1.0/board') return { data: { values: [{ id: 12, name: 'DR Scrum' }] } };
      if (url === '/rest/agile/1.0/board/12') return { data: { id: 12, name: 'DR Scrum', type: 'scrum' } };
      if (url === '/rest/agile/1.0/board/12/sprint') return { data: { isLast: true, values: [{ name: 'Sprint 1' }] } };
      throw new Error(`unexpected ${url}`);
    });
    const out = await inspectBaseFilter(jira({ get }), { baseFilter: 'filter=DR-All', teamName: 'Cerebro / DR' });
    expect(out.projectKey).toBe('DR');
    expect(out.board.boardId).toBe(12);
    expect(out.board.sprintCalendar).toBeNull();
    expect(out.board.calendarError).toMatch(/no dated sprints/);
  });

  it('loads DR boards when the admin selects the DR project', async () => {
    const get = jest.fn(async (url, opts = {}) => {
      if (url === '/rest/agile/1.0/board') {
        expect(opts.params).toMatchObject({ projectKeyOrId: 'DR', type: 'scrum' });
        return {
          data: {
            values: [
              { id: 2888, name: 'NDBAllSprintBoard' },
              { id: 1592, name: 'DR-Core-WorkStream-Scrum-Board' },
              { id: 1594, name: 'DR-ASync-WorkStream-Board' },
            ],
          },
        };
      }
      if (/^\/rest\/agile\/1\.0\/board\/159[24]$/.test(url)) {
        const id = Number(url.split('/').pop());
        return { data: { id, name: id === 1592 ? 'DR-Core-WorkStream-Scrum-Board' : 'DR-ASync-WorkStream-Board' } };
      }
      if (/^\/rest\/agile\/1\.0\/board\/159[24]\/sprint$/.test(url)) {
        return { data: { isLast: true, values: [{ name: 'S1', startDate: '2024-01-03', endDate: '2024-01-16' }] } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const out = await inspectProject(jira({
      get,
      getProjectVersions: jest.fn().mockResolvedValue([{ name: 'DR-1.0', released: false }]),
    }), { projectKey: 'dr', teamName: 'Cerebro / DR' });
    expect(out.projectKey).toBe('DR');
    expect(out.versions.unreleased).toEqual(['DR-1.0']);
    expect(out.board.boards.map((b) => b.name)).toEqual([
      'DR-ASync-WorkStream-Board',
      'DR-Core-WorkStream-Scrum-Board',
    ]);
    expect(out.board.otherBoards.map((b) => b.id)).toEqual([2888]);
    expect(out.board.boards.map((b) => b.id)).toContain(out.board.boardId);
  });

  it('drops a trailing ORDER BY before scoping the feature query', async () => {
    const client = jira();
    await inspectBaseFilter(client, { baseFilter: 'filter=x ORDER BY key' });
    expect(client.searchAll.mock.calls[0][0]).toBe('(filter=x) AND (project = FEAT)');
  });
});

describe('teamAdminService helpers', () => {
  it('slugifies team names into team codes', () => {
    expect(slugifyTeamId('Nutanix Cloud Native')).toBe('nutanix-cloud-native');
    expect(slugifyTeamId('  NDB / Era!! ')).toBe('ndb-era');
    expect(slugifyTeamId('')).toBe('');
  });

  it('normalizes feature components', () => {
    expect(normalizeFeatureComponents({ ' NKP ': ['b', 'a', 'a', ''], '': ['x'] })).toEqual({ NKP: ['a', 'b'] });
    expect(normalizeFeatureComponents(['NKP'])).toEqual({});
  });
});
