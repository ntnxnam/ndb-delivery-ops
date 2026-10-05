const request = require('supertest');
const express = require('express');
const fs = require('fs');

const realFs = jest.requireActual('fs');

jest.mock('fs');

jest.mock('../../utils/jiraClient', () => ({
  getJira: jest.fn(),
}));

jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, _res, next) => {
    req.jiraToken = 'test-token';
    next();
  },
}));

jest.mock('../../services/authService', () => ({
  checkAuthorization: jest.fn(),
  checkFeatureAccess: jest.fn(),
}));

const { getJira } = require('../../utils/jiraClient');
const { checkFeatureAccess } = require('../../services/authService');
const adminRoutes = require('../../routes/admin');

const CALENDAR = { s1StartIso: '2024-10-23', sprintDays: 21 };

function writtenTeamBoard() {
  const call = fs.writeFileSync.mock.calls.find(([p]) => String(p).includes('teamBoardConfig.json'));
  return call ? JSON.parse(call[1]) : null;
}

function sprintsFrom(startIso, count, days) {
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `S${i + 1}`,
    startDate: new Date(start + i * days * 86400000).toISOString(),
    endDate: new Date(start + (i + 1) * days * 86400000).toISOString(),
  }));
}

function fakeJira({ searchIssues, total, boards = [], featureIssues = [], versions = [] }) {
  const get = jest.fn(async (url, opts = {}) => {
    if (url === '/rest/api/2/search') {
      return { data: { total: total ?? searchIssues.length, issues: searchIssues } };
    }
    if (url === '/rest/agile/1.0/board') return { data: { values: boards } };
    const boardMatch = url.match(/^\/rest\/agile\/1\.0\/board\/(\d+)$/);
    if (boardMatch) return { data: { id: Number(boardMatch[1]), name: `Board ${boardMatch[1]}`, type: 'scrum' } };
    if (/\/sprint$/.test(url)) {
      return { data: { values: opts.params?.startAt ? [] : sprintsFrom('2024-10-23', 6, 21), isLast: true } };
    }
    if (url.startsWith('/rest/api/2/project/')) return { data: { name: 'Era' } };
    throw new Error(`unexpected GET ${url}`);
  });
  return {
    get,
    getProjectVersions: jest.fn().mockResolvedValue(versions),
    searchAll: jest.fn().mockResolvedValue(featureIssues),
    searchCount: jest.fn().mockResolvedValue(42),
  };
}

describe('Admin routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    checkFeatureAccess.mockReturnValue({ authorized: true });

    fs.readFileSync.mockImplementation((filePath, enc) => {
      const p = String(filePath);
      if (p.includes('kpiConfig.json')) return JSON.stringify({ teams: { ndb: [{ id: 'k1' }] } });
      if (p.includes('jiraFieldsConfig.json')) return realFs.readFileSync(filePath, enc);
      return '{}';
    });
    fs.writeFileSync.mockReturnValue(undefined);
  });

  describe('auth', () => {
    it('returns 403 for non-super-admins', async () => {
      checkFeatureAccess.mockReturnValue({ authorized: false, error: 'Access denied' });
      await request(app).get('/api/admin/teams').expect(403);
      await request(app).post('/api/admin/inspect-base-filter').send({ baseFilter: 'x' }).expect(403);
    });
  });

  describe('GET /teams', () => {
    it('lists teams with derived sprint scope and KPI counts', async () => {
      const res = await request(app).get('/api/admin/teams').expect(200);
      const ndb = res.body.teams.find((t) => t.id === 'ndb');
      expect(ndb.sprintScope).toBe('filter=NDB-All-Base-Filter');
      expect(ndb.kpiCount).toBe(1);
      expect(ndb).not.toHaveProperty('userConfig');
      expect(ndb).not.toHaveProperty('projectType');
    });
  });

  describe('POST /teams', () => {
    const body = {
      name: 'Data Lens Platform',
      baseFilter: 'filter=DL-All and statusCategory!=Done',
      projectKey: 'dl',
      boardId: '77',
      sprintCalendar: CALENDAR,
      featureComponents: { DataLens: ['DL-Core', 'DL-Core', ' '] },
      projectType: 'parent',
      versionPatterns: ['DL*'],
      sprintBaseFilter: 'filter=DL-All',
    };

    it('generates the team code from the name and drops legacy fields', async () => {
      const res = await request(app).post('/api/admin/teams').send(body).expect(200);
      expect(res.body.team).toEqual({
        id: 'data-lens-platform',
        name: 'Data Lens Platform',
        baseFilter: 'filter=DL-All and statusCategory!=Done',
        projectKey: 'DL',
        boardId: 77,
        sprintCalendar: CALENDAR,
        featureComponents: { DataLens: ['DL-Core'] },
      });
      const saved = writtenTeamBoard();
      expect(saved.teams.map((t) => t.id)).toContain('data-lens-platform');
      const kpiWrite = fs.writeFileSync.mock.calls.find(([p]) => String(p).includes('kpiConfig.json'));
      expect(JSON.parse(kpiWrite[1]).teams['data-lens-platform']).toEqual([]);
      expect(fs.writeFileSync.mock.calls.some(([p]) => String(p).includes('allowedUsers.json'))).toBe(false);
    });

    it('uses an explicit team code when given', async () => {
      const res = await request(app).post('/api/admin/teams').send({ ...body, id: 'DL' }).expect(200);
      expect(res.body.team.id).toBe('dl');
    });

    it('rejects missing base filter, project, or sprint calendar', async () => {
      await request(app).post('/api/admin/teams').send({ ...body, baseFilter: '' }).expect(400);
      await request(app).post('/api/admin/teams').send({ ...body, projectKey: undefined }).expect(400);
      const res = await request(app).post('/api/admin/teams').send({ ...body, sprintCalendar: null }).expect(400);
      expect(res.body.error).toBe('sprintCalendar is required');
    });

    it('rejects duplicate team codes', async () => {
      await request(app).post('/api/admin/teams').send({ ...body, id: 'ndb' }).expect(409);
    });
  });

  describe('PUT /teams/:teamId', () => {
    it('updates managed fields and keeps unmanaged ones', async () => {
      const res = await request(app)
        .put('/api/admin/teams/ndb')
        .send({ name: 'NDB Renamed', featureComponents: { NDB: ['Era Server'] }, id: 'hacked' })
        .expect(200);
      expect(res.body.team.id).toBe('ndb');
      expect(res.body.team.name).toBe('NDB Renamed');
      expect(res.body.team.featureComponents).toEqual({ NDB: ['Era Server'] });
      expect(res.body.team.releasePrefix).toBe('NDB-');
      expect(res.body.team.companionDisciplines.length).toBeGreaterThan(0);
    });

    it('returns 404 for unknown teams', async () => {
      await request(app).put('/api/admin/teams/nope').send({ name: 'x' }).expect(404);
    });
  });

  describe('POST /inspect-base-filter', () => {
    it('detects project, versions, board calendar, and feature components', async () => {
      const jira = fakeJira({
        total: 1200,
        searchIssues: [
          ...Array(8).fill({ fields: { project: { key: 'NCN', name: 'Cloud Native' } } }),
          ...Array(2).fill({ fields: { project: { key: 'ENG', name: 'Engineering' } } }),
        ],
        boards: [{ id: 10, name: 'Other' }, { id: 4741, name: 'NCN Scrum' }],
        versions: [
          { name: 'NKP-2.15', released: false },
          { name: 'NKP-2.14', released: true },
          { name: 'NKP-2.16', released: false, archived: true },
        ],
        featureIssues: [
          { fields: { components: [{ name: 'NKP' }], customfield_15160: { value: 'NKP', child: { value: 'NKP-Core' } } } },
          { fields: { components: [{ name: 'NKP' }, { name: 'CSI' }], customfield_15160: { value: 'CSI', child: { value: 'CSI-Driver' } } } },
        ],
      });
      getJira.mockResolvedValue(jira);

      const res = await request(app)
        .post('/api/admin/inspect-base-filter')
        .send({ baseFilter: 'filter=NCN-All-Base-Filter and statusCategory!=Done', name: 'Cloud Native' })
        .expect(200);

      expect(res.body.projectKey).toBe('NCN');
      expect(res.body.projectShare).toBe(80);
      expect(res.body.issueCount).toBe(1200);
      expect(res.body.sprintScope).toBe('filter=NCN-All-Base-Filter');
      expect(res.body.versions).toEqual({ total: 3, unreleasedCount: 1, unreleased: ['NKP-2.15'] });
      expect(res.body.board.boardId).toBe(4741);
      expect(res.body.board.sprintCalendar).toEqual({ s1StartIso: '2024-10-23', sprintDays: 21 });
      expect(res.body.feature.featureComponents).toEqual({ NKP: ['NKP-Core'], CSI: ['CSI-Driver'] });
      expect(jira.searchAll).toHaveBeenCalledWith(
        '(filter=NCN-All-Base-Filter and statusCategory!=Done) AND (project = FEAT)',
        'components,customfield_15160',
        expect.any(Object)
      );
    });

    it('returns 400 when the base filter is empty or matches nothing', async () => {
      getJira.mockResolvedValue(fakeJira({ searchIssues: [] }));
      await request(app).post('/api/admin/inspect-base-filter').send({ baseFilter: '  ' }).expect(400);
      const res = await request(app).post('/api/admin/inspect-base-filter').send({ baseFilter: 'filter=x' }).expect(400);
      expect(res.body.error).toBe('Base filter matched no tickets');
    });

    it('returns 400 with the JIRA message for invalid JQL', async () => {
      const err = Object.assign(new Error('Request failed'), {
        response: { status: 400, data: { errorMessages: ["The value 'nope' does not exist for the field 'filter'."] } },
      });
      getJira.mockResolvedValue({ get: jest.fn().mockRejectedValue(err) });
      const res = await request(app).post('/api/admin/inspect-base-filter').send({ baseFilter: 'filter=nope' }).expect(400);
      expect(res.body.error).toBe('Invalid base filter');
      expect(res.body.message).toContain("does not exist for the field 'filter'");
    });
  });

  describe('POST /board-calendar', () => {
    it('reads the calendar from the given board', async () => {
      getJira.mockResolvedValue(fakeJira({ searchIssues: [] }));
      const res = await request(app).post('/api/admin/board-calendar').send({ boardId: 2888 }).expect(200);
      expect(res.body.boardId).toBe(2888);
      expect(res.body.sprintCalendar).toEqual({ s1StartIso: '2024-10-23', sprintDays: 21 });
    });

    it('rejects a non-numeric board id', async () => {
      getJira.mockResolvedValue(fakeJira({ searchIssues: [] }));
      await request(app).post('/api/admin/board-calendar').send({ boardId: 'abc' }).expect(400);
    });
  });

  describe('POST /test-team-config', () => {
    it('checks project, versions, base filter, and sprint scope', async () => {
      const jira = fakeJira({ searchIssues: [], versions: [{ name: 'NDB-2.12', released: false }] });
      getJira.mockResolvedValue(jira);
      const res = await request(app).post('/api/admin/test-team-config').send({ teamId: 'ndb' }).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results.versionAccess.totalVersions).toBe(1);
      expect(res.body.results.sprintScope.jql).toBe('filter=NDB-All-Base-Filter');
      expect(jira.searchCount).toHaveBeenCalledWith('filter=NDB-All-Base-Filter');
    });

    it('requires teamId', async () => {
      await request(app).post('/api/admin/test-team-config').send({}).expect(400);
    });
  });

  describe('removed endpoints', () => {
    it.each(['validate-jira-project', 'validate-filters', 'validate-board'])('%s is gone', async (route) => {
      await request(app).post(`/api/admin/${route}`).send({}).expect(404);
    });
  });
});
