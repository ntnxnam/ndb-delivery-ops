import { apiService } from '../../shared/services/apiService';
import { JIRA_CONFIG, PROGRESS_STAGES } from '../../shared/utils/constants';

class JiraApiService {
  constructor() {
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  // REMOVED: testConnection - now handled by authService.testConnectionAndRefreshPermissions()

  // Validate JIRA ticket key
  async validateTicket(jiraKey, options = {}) {
    const { loadingKey = 'jira_validate', onProgress } = options;
    
    return await apiService.request('/api/jira/validate', {
      method: 'POST',
      body: { jiraKey },
      loadingKey,
      onProgress,
      errorContext: 'validating JIRA ticket',
      estimatedTime: 2000,
      stages: ['connecting', 'validating']
    });
  }

  // Fetch JIRA ticket data
  async fetchTicket(jiraKey, options = {}) {
    const { loadingKey = 'jira_fetch', onProgress, useCache = true } = options;
    
    // Check cache first
    if (useCache && this.isCacheValid(`ticket_${jiraKey}`)) {
      return this.getFromCache(`ticket_${jiraKey}`);
    }

    const result = await apiService.request('/api/jira/fetch', {
      method: 'POST',
      body: { jiraKey },
      loadingKey,
      onProgress,
      errorContext: 'fetching JIRA ticket data',
      estimatedTime: 5000,
      stages: PROGRESS_STAGES.JIRA
    });

    // Cache the result
    if (result && useCache) {
      this.setCache(`ticket_${jiraKey}`, result);
    }

    return result;
  }

  // Fetch JIRA epics
  async fetchEpics(jiraKey, options = {}) {
    const { loadingKey = 'jira_epics', onProgress, useCache = true } = options;
    
    const cacheKey = `epics_${jiraKey}`;
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/fetch-epics', {
      method: 'POST',
      body: { jiraKey },
      loadingKey,
      onProgress,
      errorContext: 'fetching JIRA epics',
      estimatedTime: 7000,
      stages: PROGRESS_STAGES.JIRA
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Search issues by JQL
  async searchByJql(jql, options = {}) {
    const { 
      loadingKey = 'jira_search', 
      onProgress, 
      useCache = true,
      maxResults = JIRA_CONFIG.MAX_RESULTS,
      startAt = 0
    } = options;
    
    const cacheKey = `jql_${btoa(jql)}_${startAt}_${maxResults}`;
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/search-by-jql', {
      method: 'POST',
      body: { 
        jql, 
        maxResults, 
        startAt 
      },
      loadingKey,
      onProgress,
      errorContext: 'searching JIRA issues',
      estimatedTime: 8000,
      stages: PROGRESS_STAGES.JIRA
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Get issue breakdown by type and status
  async getIssueBreakdown(jiraKey, options = {}) {
    const { loadingKey = 'jira_breakdown', onProgress, useCache = true } = options;
    
    const cacheKey = `breakdown_${jiraKey}`;
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/issue-breakdown', {
      method: 'POST',
      body: { jiraKey },
      loadingKey,
      onProgress,
      errorContext: 'fetching issue breakdown',
      estimatedTime: 6000,
      stages: PROGRESS_STAGES.JIRA
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Get release versions
  async getReleaseVersions(options = {}) {
    const { loadingKey = 'jira_releases', onProgress, useCache = true } = options;
    
    const cacheKey = 'release_versions';
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/release-versions', {
      method: 'GET',
      loadingKey,
      onProgress,
      errorContext: 'fetching release versions',
      estimatedTime: 4000,
      stages: ['connecting', 'fetching', 'processing']
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Get release items by version and labels
  async getReleaseItems(releaseVersion, labels = [], options = {}) {
    const { loadingKey = 'jira_release_items', onProgress, useCache = true } = options;
    
    const cacheKey = `release_items_${releaseVersion}_${labels.join('_')}`;
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/release-items', {
      method: 'POST',
      body: { releaseVersion, labels },
      loadingKey,
      onProgress,
      errorContext: 'fetching release items',
      estimatedTime: 10000,
      stages: PROGRESS_STAGES.JIRA
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Get checkpoint history for release items
  async getCheckpointHistory(releaseVersion, options = {}) {
    const { loadingKey = 'jira_checkpoint_history', onProgress, useCache = true } = options;
    
    const cacheKey = `checkpoint_history_${releaseVersion}`;
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/checkpoint-history', {
      method: 'POST',
      body: { releaseVersion },
      loadingKey,
      onProgress,
      errorContext: 'fetching checkpoint history',
      estimatedTime: 15000,
      stages: PROGRESS_STAGES.JIRA
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Get sprint report data
  async getSprintReport(boardId, sprintId, options = {}) {
    const { loadingKey = 'jira_sprint_report', onProgress, useCache = true } = options;
    
    const cacheKey = `sprint_report_${boardId}_${sprintId}`;
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/sprint-report', {
      method: 'POST',
      body: { boardId, sprintId },
      loadingKey,
      onProgress,
      errorContext: 'fetching sprint report',
      estimatedTime: 8000,
      stages: PROGRESS_STAGES.JIRA
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Cache management
  setCache(key, data) {
    this.cache.set(key, data);
    this.cacheTimestamps.set(key, Date.now());
  }

  getFromCache(key) {
    return this.cache.get(key);
  }

  isCacheValid(key) {
    if (!this.cache.has(key) || !this.cacheTimestamps.has(key)) {
      return false;
    }
    
    const timestamp = this.cacheTimestamps.get(key);
    return (Date.now() - timestamp) < this.cacheTTL;
  }

  clearCache(pattern = null) {
    if (pattern) {
      // Clear cache entries matching pattern
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
          this.cacheTimestamps.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
      this.cacheTimestamps.clear();
    }
  }

  // Get cache statistics
  getCacheStats() {
    const now = Date.now();
    const validEntries = Array.from(this.cacheTimestamps.entries())
      .filter(([_, timestamp]) => (now - timestamp) < this.cacheTTL);

    return {
      totalEntries: this.cache.size,
      validEntries: validEntries.length,
      expiredEntries: this.cache.size - validEntries.length,
      cacheTTL: this.cacheTTL,
      oldestEntry: validEntries.length > 0 ? 
        Math.min(...validEntries.map(([_, timestamp]) => now - timestamp)) : 0
    };
  }
}

export const jiraApiService = new JiraApiService();