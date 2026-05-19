/**
 * Unit tests for changelog pagination utility
 * Test Plan: TC-001 through TC-006
 */

const { fetchAllChangelogHistories } = require('../../utils/changelogPagination');
const axios = require('axios');

// Mock dependencies
jest.mock('axios');
jest.mock('../../utils/logger', () => ({
  jira: {
    info: jest.fn(),
    warning: jest.fn()
  }
}));

const logger = require('../../utils/logger');

describe('changelogPagination', () => {
  const baseUrl = 'https://jira.nutanix.com';
  const jiraKey = 'FEAT-18452';
  const issueId = '12345';
  const token = 'test-token';
  const httpsAgent = {};
  const retryJiraCall = jest.fn((fn) => fn());

  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockClear();
  });

  describe('TC-001: Issue with Paginated Changelog', () => {
    test('should fetch all pages when changelog is paginated', async () => {
      // Mock initial response with paginated changelog
      const initialResponse = {
        data: {
          id: issueId,
          key: jiraKey,
          changelog: {
            total: 250,
            maxResults: 100,
            startAt: 0,
            histories: Array(100).fill(null).map((_, i) => ({
              id: `history-${i}`,
              created: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
              items: []
            }))
          }
        }
      };

      // Mock Strategy 1: maxResults=total succeeds
      const maxResultsResponse = {
        data: {
          changelog: {
            total: 250,
            maxResults: 250,
            startAt: 0,
            histories: Array(250).fill(null).map((_, i) => ({
              id: `history-${i}`,
              created: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
              items: []
            }))
          }
        }
      };

      axios.get
        .mockResolvedValueOnce(initialResponse) // Initial fetch
        .mockResolvedValueOnce(maxResultsResponse); // Strategy 1

      const result = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issueId,
        token,
        httpsAgent,
        retryJiraCall,
        logger
      );

      expect(result.histories).toHaveLength(250);
      expect(result.paginationInfo.total).toBe(250);
      expect(result.paginationInfo.fetched).toBe(250);
      expect(result.paginationInfo.strategiesUsed).toContain('maxResults=total');
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('TC-002: Issue with Non-Paginated Changelog', () => {
    test('should return early when no pagination needed', async () => {
      const response = {
        data: {
          id: issueId,
          key: jiraKey,
          changelog: {
            total: 50,
            maxResults: 100,
            startAt: 0,
            histories: Array(50).fill(null).map((_, i) => ({
              id: `history-${i}`,
              created: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
              items: []
            }))
          }
        }
      };

      axios.get.mockResolvedValueOnce(response);

      const result = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issueId,
        token,
        httpsAgent,
        retryJiraCall,
        logger
      );

      expect(result.histories).toHaveLength(50);
      expect(result.paginationInfo.needsPagination).toBe(false);
      expect(result.paginationInfo.strategiesUsed).toContain('none');
      expect(axios.get).toHaveBeenCalledTimes(1); // Only initial call
    });
  });

  describe('TC-003: Issue with No Changelog', () => {
    test('should handle issue with no changelog gracefully', async () => {
      const response = {
        data: {
          id: issueId,
          key: jiraKey,
          changelog: null
        }
      };

      axios.get.mockResolvedValueOnce(response);

      const result = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issueId,
        token,
        httpsAgent,
        retryJiraCall,
        logger
      );

      expect(result.histories).toHaveLength(0);
      expect(result.paginationInfo.needsPagination).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('TC-005: Pagination Failure Scenarios', () => {
    test('should handle Strategy 1 failure and try Strategy 2', async () => {
      const initialResponse = {
        data: {
          id: issueId,
          key: jiraKey,
          changelog: {
            total: 250,
            maxResults: 100,
            startAt: 0,
            histories: Array(100).fill(null).map((_, i) => ({
              id: `history-${i}`,
              created: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
              items: []
            }))
          }
        }
      };

      // Strategy 1 fails
      const strategy1Error = new Error('maxResults not supported');
      
      // Strategy 2 succeeds with issue ID endpoint
      const strategy2Response1 = {
        data: {
          values: Array(100).fill(null).map((_, i) => ({
            id: `history-${i + 100}`,
            created: `2026-01-${String(i + 101).padStart(2, '0')}T00:00:00.000Z`,
            items: []
          }))
        }
      };

      const strategy2Response2 = {
        data: {
          values: Array(50).fill(null).map((_, i) => ({
            id: `history-${i + 200}`,
            created: `2026-01-${String(i + 201).padStart(2, '0')}T00:00:00.000Z`,
            items: []
          }))
        }
      };

      axios.get
        .mockResolvedValueOnce(initialResponse) // Initial fetch
        .mockRejectedValueOnce(strategy1Error) // Strategy 1 fails
        .mockResolvedValueOnce(strategy2Response1) // Strategy 2 page 1
        .mockResolvedValueOnce(strategy2Response2); // Strategy 2 page 2

      const result = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issueId,
        token,
        httpsAgent,
        retryJiraCall,
        logger
      );

      expect(result.histories.length).toBeGreaterThan(100);
      expect(result.paginationInfo.strategiesUsed).toContain('issue-id-endpoint');
      expect(result.warnings.length).toBeGreaterThan(0); // Strategy 1 failure warning
    });

    test('should return partial data with warnings when all strategies fail', async () => {
      const initialResponse = {
        data: {
          id: issueId,
          key: jiraKey,
          changelog: {
            total: 250,
            maxResults: 100,
            startAt: 0,
            histories: Array(100).fill(null).map((_, i) => ({
              id: `history-${i}`,
              created: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
              items: []
            }))
          }
        }
      };

      const error = new Error('API error');

      axios.get
        .mockResolvedValueOnce(initialResponse) // Initial fetch
        .mockRejectedValueOnce(error) // Strategy 1 fails
        .mockRejectedValueOnce(error) // Strategy 2 fails
        .mockRejectedValueOnce(error); // Strategy 3 fails

      const result = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issueId,
        token,
        httpsAgent,
        retryJiraCall,
        logger
      );

      expect(result.histories).toHaveLength(100); // Partial data
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.paginationInfo.fetched).toBe(100);
      expect(result.paginationInfo.total).toBe(250);
    });
  });

  describe('TC-006: Strategy Fallback', () => {
    test('should fall back through strategies correctly', async () => {
      const initialResponse = {
        data: {
          id: issueId,
          key: jiraKey,
          changelog: {
            total: 250,
            maxResults: 100,
            startAt: 0,
            histories: Array(100).fill(null).map((_, i) => ({
              id: `history-${i}`,
              created: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
              items: []
            }))
          }
        }
      };

      // Strategy 1: Partial success (gets 150 instead of 250)
      const strategy1Response = {
        data: {
          changelog: {
            total: 250,
            maxResults: 250,
            startAt: 0,
            histories: Array(150).fill(null).map((_, i) => ({
              id: `history-${i}`,
              created: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
              items: []
            }))
          }
        }
      };

      // Strategy 2: Gets remaining 100
      const strategy2Response = {
        data: {
          values: Array(100).fill(null).map((_, i) => ({
            id: `history-${i + 150}`,
            created: `2026-01-${String(i + 151).padStart(2, '0')}T00:00:00.000Z`,
            items: []
          }))
        }
      };

      axios.get
        .mockResolvedValueOnce(initialResponse) // Initial fetch
        .mockResolvedValueOnce(strategy1Response) // Strategy 1 partial
        .mockResolvedValueOnce(strategy2Response); // Strategy 2 completes

      const result = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issueId,
        token,
        httpsAgent,
        retryJiraCall,
        logger
      );

      expect(result.histories.length).toBeGreaterThanOrEqual(200);
      expect(result.paginationInfo.strategiesUsed).toContain('maxResults=total (partial)');
      expect(result.paginationInfo.strategiesUsed).toContain('issue-id-endpoint');
    });
  });

  describe('Error Handling', () => {
    test('should handle initial fetch error gracefully', async () => {
      const error = new Error('Network error');
      axios.get.mockRejectedValueOnce(error);

      const result = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issueId,
        token,
        httpsAgent,
        retryJiraCall,
        logger
      );

      expect(result.histories).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.paginationInfo.strategiesUsed).toContain('error');
    });
  });
});

