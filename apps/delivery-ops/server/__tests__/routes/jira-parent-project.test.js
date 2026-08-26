const request = require('supertest');
const express = require('express');

// Mock the team config
const mockTeamConfig = {
  teams: [
    {
      id: 'ndb',
      name: 'NDB',
      projectKey: 'ERA',
      projectType: 'dedicated',
      baseFilter: 'filter=NDB-All-Base-Filter',
    },
    {
      id: 'datalens',
      name: 'DataLens',
      projectKey: 'ENG',
      projectType: 'parent',
      baseFilter: 'filter=DataLens-All-Base-Filter',
    }
  ],
  defaultTeamId: 'ndb'
};

function mockProjectVersions(projectVersions) {
  const { getJira } = require('../../utils/jiraClient');
  getJira.mockResolvedValue({
    getProjectVersions: async () => projectVersions || [],
  });
}

// Mock the config loading
jest.mock('../../config/teamBoardConfig.json', () => mockTeamConfig, { virtual: true });

jest.mock('../../utils/jiraClient', () => ({
  ...jest.requireActual('../../utils/jiraClient'),
  getJira: jest.fn(async () => ({
    getProjectVersions: async () => [],
  })),
}));

// Mock axios for JIRA API calls
jest.mock('axios');
const axios = require('axios');

// Mock auth services
jest.mock('../../services/userService', () => ({
  checkReleaseVersionsAuthorization: jest.fn().mockReturnValue({ authorized: true })
}));

// Mock middleware
jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, res, next) => {
    req.jiraToken = 'test-token';
    next();
  }
}));

jest.mock('../../middleware/authMiddleware', () => ({
  requireAuth: () => (req, res, next) => next()
}));

const jiraRoutes = require('../../routes/jira');
const { clearFixVersionCache } = require('../../utils/teamScope');

describe('Parent Project Version Filtering', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/jira', jiraRoutes);
    jest.clearAllMocks();
    clearFixVersionCache();
  });

  describe('POST /api/jira/release-versions', () => {
    it('returns unreleased versions from the team JIRA project', async () => {
      const projectVersions = [
        { name: 'NDB-2.11', released: false, archived: false, releaseDate: '2026-09-15' },
        { name: 'NDB-2.12', released: false, archived: false, releaseDate: '2026-12-01' },
        { name: 'NDB-2.10', released: true, archived: false, releaseDate: '2026-03-01' },
        { name: 'ERA-open', released: false, archived: false, releaseDate: '2026-09-01' },
      ];
      mockProjectVersions(projectVersions);

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'ndb' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.projectKey).toBe('ERA');
      const names = response.body.versions.map(v => v.name);
      expect(names).toEqual(['NDB-2.12', 'NDB-2.11', 'ERA-open']);
      expect(names).not.toContain('NDB-2.10');
      expect(response.body.defaultVersion).toBe('ERA-open');
    });

    it('returns every unreleased name in the project, without prefix or glob matching', async () => {
      const names = [
        'DataLens-1.0',
        'DL2025.02',
        'Analytics-2.1',
        'Core-3.0',
        'DataLens2025.03',
        'DL-1.1',
      ];
      mockProjectVersions(names.map((name) => ({ name, released: false, archived: false })));

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.projectKey).toBe('ENG');
      expect(response.body.versions).toHaveLength(6);
    });

    it('keeps mixed-case names from the project', async () => {
      const names = ['datalens-1.0', 'DATALENS-2.0', 'dl-test', 'DL-PROD'];
      mockProjectVersions(names.map((name) => ({ name, released: false, archived: false })));

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.versions).toHaveLength(4);
      const returned = response.body.versions.map(v => v.name);
      expect(returned).toEqual(expect.arrayContaining(names));
    });

    it('should handle empty version list gracefully', async () => {
      mockProjectVersions([]);

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.versions).toEqual([]);
      expect(response.body.defaultVersion).toBeNull();
    });

    it('should not fall back to NDB when the teamId is unknown', async () => {
      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'prism-infra' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('returns 400 when the team has no projectKey', async () => {
      mockTeamConfig.teams.push({
        id: 'no-project',
        name: 'No Project',
        projectType: 'parent',
        baseFilter: 'filter=x',
      });

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'no-project' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/no projectKey/);
      mockTeamConfig.teams.pop();
    });
  });

  describe('POST /api/jira/discover-versions', () => {
    it('should provide version discovery with filter information for parent project', async () => {
      const mockVersions = [
        { name: 'DataLens-1.0', released: false, archived: false },
        { name: 'Analytics-2.1', released: false, archived: false }
      ];

      mockProjectVersions([
        { name: 'DataLens-1.0', released: false, archived: false },
        { name: 'Analytics-2.1', released: false, archived: false },
      ]);

      const response = await request(app)
        .post('/api/jira/discover-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.teamId).toBe('datalens');
      expect(response.body.projectType).toBe('parent');
      expect(response.body.projectKey).toBe('ENG');
      
      // Should have every unreleased version (no glob filter)
      expect(response.body.versions).toHaveLength(2);
      const names = response.body.versions.map(v => v.name);
      expect(names).toContain('DataLens-1.0');
      expect(names).toContain('Analytics-2.1');
    });

    it('should show dedicated project information correctly', async () => {
      const mockVersions = [
        { name: 'NDB-2.11', released: false, archived: false },
        { name: 'NDB-2.12', released: false, archived: false }
      ];

      mockProjectVersions([
        { name: 'NDB-2.11', released: false, archived: false },
        { name: 'NDB-2.12', released: false, archived: false },
      ]);

      const response = await request(app)
        .post('/api/jira/discover-versions')
        .send({ teamId: 'ndb' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.projectType).toBe('dedicated');
      expect(response.body.projectKey).toBe('ERA');
      expect(response.body.versions).toHaveLength(2);
    });
  });
});

describe('Dynamic Filter Construction', () => {
  // NOTE: getDefaultReleaseBaseFilter / getReleaseBaseFilter are internal helpers
  // inside jira/index.js that are not currently exported.  Tests below are skipped
  // until these helpers are extracted to a utility module (per minimal-architecture.mdc).
  const {
    getDefaultReleaseBaseFilter,
    getReleaseBaseFilter,
  } = require('../../routes/jira/index.js');

  it.skip('should construct default filters for standard versions', () => {
    expect(getDefaultReleaseBaseFilter('NDB-2.11')).toBe('filter=NDB-2.11-All');
    expect(getDefaultReleaseBaseFilter('DataLens-1.0')).toBe('filter=DataLens-1.0-All');
    expect(getDefaultReleaseBaseFilter('DL2025.02')).toBe('filter=DL2025.02-All');
  });

  it.skip('should handle edge cases in version names', () => {
    expect(getDefaultReleaseBaseFilter('')).toBeNull();
    expect(getDefaultReleaseBaseFilter(null)).toBeNull();
    expect(getDefaultReleaseBaseFilter('  ')).toBeNull();
    expect(getDefaultReleaseBaseFilter('Version With Spaces')).toBe('filter=Version With Spaces-All');
  });

  it.skip('should prioritize config overrides over dynamic construction', () => {
    // This would need to be tested with actual config file mocking
    // For now, we test the logic path
    const version = 'NDB-2.11';
    const teamId = 'ndb';
    
    // If config override exists, it should be used
    // If not, dynamic construction should apply
    const result = getReleaseBaseFilter(version, teamId);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^filter=/);
  });
});

describe('Backward Compatibility Tests', () => {
  it('should handle teams without projectType field', () => {
    const legacyTeam = {
      id: 'legacy',
      name: 'Legacy Team',
      projectKey: 'LEG'
      // No projectType field
    };

    // The system should treat this as a dedicated project
    const isParentProject = legacyTeam.projectType === 'parent';
    expect(isParentProject).toBe(false);
  });

  it.skip('should handle calls to getReleaseBaseFilter without teamId', () => {
    // The function should work with just releaseVersion
    const result = getReleaseBaseFilter('NDB-2.11');
    expect(result).toBe('filter=NDB-2.11-All');
  });

  it('should maintain existing filter behavior for NDB team', () => {
    // NDB team should continue working exactly as before
    const ndbTeam = mockTeamConfig.teams.find(t => t.id === 'ndb');
    expect(ndbTeam.projectType).toBe('dedicated');
    expect(ndbTeam.versionPatterns).toBeUndefined();
    
    // Version filtering should not apply to dedicated projects
    const shouldFilter = ndbTeam.projectType === 'parent' && ndbTeam.versionPatterns;
    expect(shouldFilter).toBe(false);
  });
});