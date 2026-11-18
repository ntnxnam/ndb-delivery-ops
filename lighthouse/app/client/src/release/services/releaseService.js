import { apiService } from '../../shared/services/apiService';
import { PROGRESS_STAGES } from '../../shared/utils/constants';

class ReleaseService {
  constructor() {
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  // Get all release versions
  async getReleaseVersions(options = {}) {
    const { loadingKey = 'release_versions', onProgress, useCache = true } = options;
    
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
    const { loadingKey = 'release_items', onProgress, useCache = true } = options;
    
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

  // Get checkpoint history
  async getCheckpointHistory(releaseVersion, options = {}) {
    const { loadingKey = 'checkpoint_history', onProgress, useCache = true } = options;
    
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

  // Get release trends data
  async getReleaseTrends(options = {}) {
    const { loadingKey = 'release_trends', onProgress, useCache = true } = options;
    
    const cacheKey = 'release_trends';
    if (useCache && this.isCacheValid(cacheKey)) {
      return this.getFromCache(cacheKey);
    }

    const result = await apiService.request('/api/jira/release-trends', {
      method: 'GET',
      loadingKey,
      onProgress,
      errorContext: 'fetching release trends',
      estimatedTime: 8000,
      stages: ['connecting', 'fetching', 'analyzing', 'formatting']
    });

    if (result && useCache) {
      this.setCache(cacheKey, result);
    }

    return result;
  }

  // Get release configuration
  async getReleaseConfig(options = {}) {
    const { loadingKey = 'release_config', onProgress } = options;
    
    return await apiService.request('/api/config/release-versions', {
      method: 'GET',
      loadingKey,
      onProgress,
      errorContext: 'fetching release configuration'
    });
  }

  // Update release configuration
  async updateReleaseConfig(config, options = {}) {
    const { loadingKey = 'update_release_config', onProgress } = options;
    
    return await apiService.request('/api/config/release-versions', {
      method: 'PUT',
      body: config,
      loadingKey,
      onProgress,
      errorContext: 'updating release configuration'
    });
  }

  // Export release data
  async exportReleaseData(releaseVersion, format = 'excel', options = {}) {
    const { loadingKey = 'export_release', onProgress } = options;
    
    return await apiService.request('/api/jira/export-release', {
      method: 'POST',
      body: { releaseVersion, format },
      loadingKey,
      onProgress,
      errorContext: 'exporting release data',
      estimatedTime: 12000,
      stages: PROGRESS_STAGES.EXPORT
    });
  }

  // Generate release highlights
  async generateReleaseHighlights(releaseVersion, options = {}) {
    const { loadingKey = 'generate_highlights', onProgress } = options;
    
    return await apiService.request('/api/ai/generate-release-highlights', {
      method: 'POST',
      body: { releaseVersion },
      loadingKey,
      onProgress,
      errorContext: 'generating release highlights',
      estimatedTime: 10000,
      stages: ['fetching', 'analyzing', 'generating', 'formatting']
    });
  }

  // Cache management methods
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
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
          this.cacheTimestamps.delete(key);
        }
      }
    } else {
      this.cache.clear();
      this.cacheTimestamps.clear();
    }
  }

  getCacheStats() {
    const now = Date.now();
    const validEntries = Array.from(this.cacheTimestamps.entries())
      .filter(([_, timestamp]) => (now - timestamp) < this.cacheTTL);

    return {
      totalEntries: this.cache.size,
      validEntries: validEntries.length,
      expiredEntries: this.cache.size - validEntries.length,
      cacheTTL: this.cacheTTL
    };
  }
}

export const releaseService = new ReleaseService();