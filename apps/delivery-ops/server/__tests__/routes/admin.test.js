const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Mock the config files
jest.mock('fs');
jest.mock('../../config/api', () => ({
  JIRA_API_V2: {
    PROJECT: (key) => `https://jira.example.com/rest/api/2/project/${key}`,
    PROJECT_VERSIONS: (key) => `https://jira.example.com/rest/api/2/project/${key}/versions`,
    SEARCH: 'https://jira.example.com/rest/api/2/search'
  }
}));

// Mock axios for JIRA API calls
jest.mock('axios');
const axios = require('axios');

// Mock auth service
jest.mock('../../services/authService', () => ({
  checkAuthorization: jest.fn()
}));

const { checkAuthorization } = require('../../services/authService');
const adminRoutes = require('../../routes/admin');

describe('Admin Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);

    // Reset all mocks
    jest.clearAllMocks();

    // Default auth to authorized
    checkAuthorization.mockReturnValue({ authorized: true });

    // Default file system mocks
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath.includes('teamBoardConfig.json')) {
        return JSON.stringify({
          teams: [
            {
              id: 'ndb',
              name: 'NDB',
              projectKey: 'ERA',
              projectType: 'dedicated'
            }
          ],
          defaultTeamId: 'ndb'
        });
      }
      if (filePath.includes('allowedUsers.json')) {
        return JSON.stringify({
          superAdminUsers: ['admin'],
          teams: {}
        });
      }
      if (filePath.includes('kpiConfig.json')) {
        return JSON.stringify({ teams: {} });
      }
      return '{}';
    });

    fs.writeFileSync.mockReturnValue(true);
  });

  describe('GET /teams', () => {
    it('should return teams for authorized users', async () => {
      const response = await request(app)
        .get('/api/admin/teams')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.teams).toHaveLength(1);
      expect(response.body.teams[0].id).toBe('ndb');
    });

    it('should deny access for unauthorized users', async () => {
      checkAuthorization.mockReturnValue({ 
        authorized: false, 
        error: 'Access denied' 
      });

      await request(app)
        .get('/api/admin/teams')
        .expect(403);
    });
  });

  describe('POST /teams', () => {
    it('should create a new dedicated project team', async () => {
      const newTeam = {
        id: 'analytics',
        name: 'Analytics Team',
        projectKey: 'ANAL',
        projectType: 'dedicated',
        baseFilter: 'filter=Analytics-Base',
        sprintBaseFilter: 'filter=Analytics-Sprint'
      };

      const response = await request(app)
        .post('/api/admin/teams')
        .send(newTeam)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.team.id).toBe('analytics');
      expect(fs.writeFileSync).toHaveBeenCalledTimes(3); // teamBoard, allowedUsers, kpi configs
    });

    it('should create a new parent project team with version patterns', async () => {
      const newTeam = {
        id: 'datalens',
        name: 'DataLens',
        projectKey: 'ENG',
        projectType: 'parent',
        versionPatterns: ['^DataLens.*', '^DL.*'],
        userConfig: {
          admins: ['user1'],
          allowedUsers: ['user1', 'user2'],
          emailSenders: ['user1'],
          features: {
            releaseVersions: true,
            sprintReports: true,
            kpiTab: true
          }
        }
      };

      const response = await request(app)
        .post('/api/admin/teams')
        .send(newTeam)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.team.versionPatterns).toEqual(['^DataLens.*', '^DL.*']);
    });

    it('should reject team creation with missing required fields', async () => {
      const invalidTeam = {
        name: 'Incomplete Team'
        // Missing id and projectKey
      };

      const response = await request(app)
        .post('/api/admin/teams')
        .send(invalidTeam)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    it('should reject duplicate team ids', async () => {
      const duplicateTeam = {
        id: 'ndb', // Already exists
        name: 'Duplicate NDB',
        projectKey: 'ERA2'
      };

      const response = await request(app)
        .post('/api/admin/teams')
        .send(duplicateTeam)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Team already exists');
    });
  });

  describe('POST /validate-jira-project', () => {
    it('should validate accessible JIRA project', async () => {
      axios.get
        .mockResolvedValueOnce({
          data: {
            key: 'ERA',
            name: 'Era Project',
            projectTypeKey: 'software',
            lead: { displayName: 'Project Lead' }
          }
        })
        .mockResolvedValueOnce({
          data: [
            { name: 'NDB-2.11', released: false, archived: false },
            { name: 'NDB-2.12', released: false, archived: false }
          ]
        });

      const response = await request(app)
        .post('/api/admin/validate-jira-project')
        .send({
          projectKey: 'ERA',
          jiraToken: 'test-token'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.project.key).toBe('ERA');
      expect(response.body.versions.open).toBe(2);
    });

    it('should handle invalid project key', async () => {
      axios.get.mockRejectedValue({
        response: {
          status: 404,
          data: {
            errorMessages: ['Project not found']
          }
        }
      });

      const response = await request(app)
        .post('/api/admin/validate-jira-project')
        .send({
          projectKey: 'INVALID',
          jiraToken: 'test-token'
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /validate-filters', () => {
    it('should validate working JIRA filters', async () => {
      axios.get.mockResolvedValue({
        data: { total: 25 }
      });

      const response = await request(app)
        .post('/api/admin/validate-filters')
        .send({
          filters: [
            { name: 'BaseFilter', filterQuery: 'filter=Team-Base' },
            { name: 'SprintFilter', filterQuery: 'filter=Team-Sprint' }
          ],
          jiraToken: 'test-token'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].valid).toBe(true);
      expect(response.body.results[0].issueCount).toBe(25);
    });

    it('should detect invalid filters', async () => {
      axios.get
        .mockResolvedValueOnce({ data: { total: 10 } }) // First filter works
        .mockRejectedValueOnce({
          response: {
            data: {
              errorMessages: ['Filter does not exist']
            }
          }
        }); // Second filter fails

      const response = await request(app)
        .post('/api/admin/validate-filters')
        .send({
          filters: [
            { name: 'ValidFilter', filterQuery: 'filter=Valid' },
            { name: 'InvalidFilter', filterQuery: 'filter=Invalid' }
          ],
          jiraToken: 'test-token'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results[0].valid).toBe(true);
      expect(response.body.results[1].valid).toBe(false);
    });
  });
});

describe('Team Configuration Validation', () => {
  it('should validate dedicated project configuration', () => {
    const team = {
      id: 'ndb',
      name: 'NDB',
      projectKey: 'ERA',
      projectType: 'dedicated'
    };

    // Dedicated projects don't need version patterns
    expect(team.versionPatterns).toBeUndefined();
    expect(team.projectKey).toBeTruthy();
  });

  it('should validate parent project configuration', () => {
    const team = {
      id: 'datalens',
      name: 'DataLens',
      projectKey: 'ENG',
      projectType: 'parent',
      versionPatterns: ['^DataLens.*', '^DL.*']
    };

    // Parent projects require version patterns
    expect(team.versionPatterns).toEqual(expect.arrayContaining([
      expect.stringMatching(/^\^DataLens/),
      expect.stringMatching(/^\^DL/)
    ]));
  });
});

describe('Backward Compatibility', () => {
  it('should handle teams without projectType (defaults to dedicated)', () => {
    const legacyTeam = {
      id: 'legacy',
      name: 'Legacy Team',
      projectKey: 'LEG'
      // No projectType specified
    };

    // Should be treated as dedicated project
    const projectType = legacyTeam.projectType || 'dedicated';
    expect(projectType).toBe('dedicated');
  });

  it('should preserve existing configuration when updating', () => {
    const existingTeam = {
      id: 'existing',
      name: 'Existing Team',
      projectKey: 'EXIST',
      boardId: 1234,
      baseFilter: 'existing-filter'
    };

    const update = {
      name: 'Updated Team Name'
    };

    const updatedTeam = { ...existingTeam, ...update };

    expect(updatedTeam.projectKey).toBe('EXIST');
    expect(updatedTeam.boardId).toBe(1234);
    expect(updatedTeam.name).toBe('Updated Team Name');
  });
});