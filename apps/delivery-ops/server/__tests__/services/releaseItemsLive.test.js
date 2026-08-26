jest.mock('../../utils/jiraRouteHelpers', () => ({
  resolveRequestedTeam: jest.fn((teamId) => ({
    effectiveTeamId: teamId || null,
    team: teamId
      ? { id: teamId, boardId: 1, baseFilter: 'filter=Prism-Infra-Base', labelPrefix: 'msp' }
      : null,
    projectKey: teamId ? 'ERA' : null,
  })),
}));

jest.mock('../../utils/teamConfig', () => ({
  getTeamBaseFilter: jest.fn((teamId) => (teamId ? 'filter=Prism-Infra-Base' : null)),
  getTeamSosBaseFilter: jest.fn(() => null),
}));

const axios = require('axios');
const { fetchAllItemsAcrossVersions } = require('../../services/releaseItemsDataService');

jest.mock('axios');
jest.mock('../../services/jiraService', () => ({
  formatRiskIndicator: (v) => v,
  sortByRiskIndicator: (items) => items,
}));
jest.mock('../../services/userService', () => ({
  extractUserName: () => null,
  extractAssigneeName: () => null,
}));
jest.mock('../../utils/adfText', () => ({
  extractTextFieldValue: () => '',
}));
jest.mock('../../utils/simpleCache', () => ({
  getCached: () => null,
  setCached: () => {},
}));

describe('fetchAllItemsAcrossVersions', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockResolvedValue({
      data: {
        issues: [
          {
            key: 'FEAT-1',
            fields: {
              summary: 'Prism work',
              status: { name: 'In Progress' },
              issuetype: { name: 'Feature' },
              fixVersions: [{ name: 'MSP-2.1' }],
              labels: [],
            },
          },
        ],
        total: 1,
      },
    });
  });

  test('searches JIRA with the team baseFilter wrap and ignores disk cache', async () => {
    const result = await fetchAllItemsAcrossVersions('token', {
      fixVersions: ['MSP-2.1'],
      teamId: 'prism-infra',
    });

    expect(axios.get).toHaveBeenCalled();
    const jql = axios.get.mock.calls[0][1].params.jql;
    expect(jql).toContain('(filter=Prism-Infra-Base) AND ');
    expect(jql).toContain('fixVersion = "MSP-2.1"');
    expect(jql).toContain('labels = "msp-2.1-long-term-funded"');
    expect(result.allItems.map((i) => i.key)).toEqual(['FEAT-1']);
  });

  test('returns 400 when the team has no baseFilter', async () => {
    const { getTeamBaseFilter } = require('../../utils/teamConfig');
    getTeamBaseFilter.mockReturnValueOnce(null);
    await expect(fetchAllItemsAcrossVersions('token', {
      fixVersions: ['MSP-2.1'],
      teamId: 'prism-infra',
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
