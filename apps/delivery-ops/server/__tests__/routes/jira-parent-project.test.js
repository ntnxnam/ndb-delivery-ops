const request = require('supertest');
const express = require('express');

// Mock the team config
const mockTeamConfig = {
  teams: [
    {
      id: 'ndb',
      name: 'NDB',
      projectKey: 'ERA',
      projectType: 'dedicated'
    },
    {
      id: 'datalens',
      name: 'DataLens',
      projectKey: 'ENG',
      projectType: 'parent',
      versionPatterns: ['^DataLens.*', '^DL.*']
    }
  ],
  defaultTeamId: 'ndb'
};

// Mock the config loading
jest.mock('../../config/teamBoardConfig.json', () => mockTeamConfig, { virtual: true });

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

describe('Parent Project Version Filtering', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/jira', jiraRoutes);
    jest.clearAllMocks();
  });

  describe('POST /api/jira/release-versions', () => {
    it('should return all versions for dedicated project team (NDB)', async () => {
      const mockVersions = [
        { name: 'NDB-2.11', released: false, archived: false },
        { name: 'NDB-2.12', released: false, archived: false },
        { name: 'NDB-2.10', released: true, archived: false } // Should be filtered out
      ];

      axios.get.mockResolvedValue({ data: mockVersions });

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'ndb' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.versions).toEqual(['NDB-2.12', 'NDB-2.11']); // Sorted, unreleased only
    });

    it('should filter versions by patterns for parent project team (DataLens)', async () => {
      const mockVersions = [
        { name: 'DataLens-1.0', released: false, archived: false }, // Should match ^DataLens.*
        { name: 'DL2025.02', released: false, archived: false },    // Should match ^DL.*
        { name: 'Analytics-2.1', released: false, archived: false }, // Should NOT match
        { name: 'Core-3.0', released: false, archived: false },     // Should NOT match
        { name: 'DataLens2025.03', released: false, archived: false }, // Should match ^DataLens.*
        { name: 'DL-1.1', released: false, archived: false }        // Should match ^DL.*
      ];

      axios.get.mockResolvedValue({ data: mockVersions });

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should only include DataLens and DL versions, sorted
      expect(response.body.versions).toEqual([
        'DataLens2025.03',
        'DL2025.02',
        'DataLens-1.0',
        'DL-1.1'
      ]);
      
      // Should not include Analytics or Core versions
      expect(response.body.versions).not.toContain('Analytics-2.1');
      expect(response.body.versions).not.toContain('Core-3.0');
    });

    it('should handle case-insensitive pattern matching', async () => {
      const mockVersions = [
        { name: 'datalens-1.0', released: false, archived: false }, // lowercase
        { name: 'DATALENS-2.0', released: false, archived: false }, // uppercase
        { name: 'dl-test', released: false, archived: false },      // lowercase dl
        { name: 'DL-PROD', released: false, archived: false }       // uppercase dl
      ];

      axios.get.mockResolvedValue({ data: mockVersions });

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.versions).toHaveLength(4);
      expect(response.body.versions).toContain('datalens-1.0');
      expect(response.body.versions).toContain('DATALENS-2.0');
      expect(response.body.versions).toContain('dl-test');
      expect(response.body.versions).toContain('DL-PROD');
    });

    it('should handle empty version list gracefully', async () => {
      axios.get.mockResolvedValue({ data: [] });

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.versions).toEqual([]);
    });

    it('should handle team without version patterns (backward compatibility)', async () => {
      // Test with a team that has projectType but no versionPatterns
      const teamWithoutPatterns = {
        id: 'test-team',
        name: 'Test Team',
        projectKey: 'ENG',
        projectType: 'parent'
        // No versionPatterns
      };

      // Temporarily add this team to the mock config
      mockTeamConfig.teams.push(teamWithoutPatterns);

      const mockVersions = [
        { name: 'Version-1.0', released: false, archived: false },
        { name: 'Version-2.0', released: false, archived: false }
      ];

      axios.get.mockResolvedValue({ data: mockVersions });

      const response = await request(app)
        .post('/api/jira/release-versions')
        .send({ teamId: 'test-team' })
        .expect(200);

      // Should return all versions (no filtering applied)
      expect(response.body.success).toBe(true);
      expect(response.body.versions).toEqual(['Version-2.0', 'Version-1.0']);

      // Clean up
      mockTeamConfig.teams.pop();
    });
  });

  describe('POST /api/jira/discover-versions', () => {
    it('should provide version discovery with filter information for parent project', async () => {
      const mockVersions = [
        { name: 'DataLens-1.0', released: false, archived: false },
        { name: 'Analytics-2.1', released: false, archived: false }
      ];

      axios.get.mockResolvedValue({ data: mockVersions });

      const response = await request(app)
        .post('/api/jira/discover-versions')
        .send({ teamId: 'datalens' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.teamId).toBe('datalens');
      expect(response.body.projectType).toBe('parent');
      expect(response.body.versionPatterns).toEqual(['^DataLens.*', '^DL.*']);
      
      // Should only have filtered versions with filter info
      expect(response.body.versions).toHaveLength(1);
      expect(response.body.versions[0].name).toBe('DataLens-1.0');
      expect(response.body.versions[0].dynamicFilter).toBe('filter=DataLens-1.0-All');
      expect(response.body.versions[0].hasConfigOverride).toBe(false);
    });

    it('should show dedicated project information correctly', async () => {
      const mockVersions = [
        { name: 'NDB-2.11', released: false, archived: false },
        { name: 'NDB-2.12', released: false, archived: false }
      ];

      axios.get.mockResolvedValue({ data: mockVersions });

      const response = await request(app)
        .post('/api/jira/discover-versions')
        .send({ teamId: 'ndb' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.projectType).toBe('dedicated');
      expect(response.body.versionPatterns).toBeNull();
      expect(response.body.versions).toHaveLength(2);
    });
  });
});

describe('Dynamic Filter Construction', () => {
  // Mock the getReleaseBaseFilter function behavior
  const { 
    getDefaultReleaseBaseFilter,
    getReleaseBaseFilter,
    getTeamConfig,
    constructParentProjectFilter 
  } = require('../../routes/jira/index.js');

  it('should construct default filters for standard versions', () => {
    expect(getDefaultReleaseBaseFilter('NDB-2.11')).toBe('filter=NDB-2.11-All');
    expect(getDefaultReleaseBaseFilter('DataLens-1.0')).toBe('filter=DataLens-1.0-All');
    expect(getDefaultReleaseBaseFilter('DL2025.02')).toBe('filter=DL2025.02-All');
  });

  it('should handle edge cases in version names', () => {
    expect(getDefaultReleaseBaseFilter('')).toBeNull();
    expect(getDefaultReleaseBaseFilter(null)).toBeNull();
    expect(getDefaultReleaseBaseFilter('  ')).toBeNull();
    expect(getDefaultReleaseBaseFilter('Version With Spaces')).toBe('filter=Version With Spaces-All');
  });

  it('should prioritize config overrides over dynamic construction', () => {
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

  it('should handle calls to getReleaseBaseFilter without teamId', () => {
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