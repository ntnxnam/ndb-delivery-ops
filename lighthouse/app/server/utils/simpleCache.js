/**
 * Simple in-memory cache with TTL support
 * For caching TCMS and other API responses
 */

class SimpleCache {
  constructor(defaultTTL = 300000) { // 5 minutes default
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key, value, ttl = this.defaultTTL) {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    });
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  // Clean up expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    }
  }
}

// Create cache instances
const tcmsCache = new SimpleCache(600000); // 10 minutes TTL for TCMS data
const jiraCache = new SimpleCache(300000); // 5 minutes TTL for JIRA data

// Periodic cleanup for all caches
setInterval(() => {
  tcmsCache.cleanup();
  jiraCache.cleanup();
}, 60000); // Clean up every minute

// Helper functions for JIRA cache
function getCached(key, params = {}) {
  const cacheKey = `${key}:${JSON.stringify(params)}`;
  return jiraCache.get(cacheKey);
}

function setCached(key, params = {}, value, ttl) {
  const cacheKey = `${key}:${JSON.stringify(params)}`;
  return jiraCache.set(cacheKey, value, ttl);
}

module.exports = {
  SimpleCache,
  tcmsCache,
  jiraCache,
  getCached,
  setCached
};