/**
 * Token validation cache to avoid repeated JIRA API calls
 * Caches validation results for a configurable TTL period
 */

class TokenCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || 15 * 60 * 1000; // 15 minutes default
    this.maxSize = options.maxSize || 1000; // Max cached tokens
    this.cleanupInterval = options.cleanupInterval || 5 * 60 * 1000; // 5 minutes cleanup
    
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  /**
   * Generate cache key from token and username
   * @param {string} token - JIRA token
   * @param {string} username - Username
   * @returns {string} Cache key
   */
  generateKey(token, username) {
    // Use first 16 chars of token + username for security
    const tokenPrefix = token.substring(0, 16);
    return `${tokenPrefix}:${username}`;
  }

  /**
   * Get cached validation result
   * @param {string} token - JIRA token
   * @param {string} username - Username
   * @returns {object|null} Cached result or null if not found/expired
   */
  get(token, username) {
    const key = this.generateKey(token, username);
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    // Update access time for LRU-style cleanup
    entry.lastAccessed = Date.now();
    return entry.result;
  }

  /**
   * Set validation result in cache
   * @param {string} token - JIRA token
   * @param {string} username - Username
   * @param {object} result - Validation result
   */
  set(token, username, result) {
    // Only cache successful validations to avoid caching temporary errors
    if (!result.valid) return;
    
    const key = this.generateKey(token, username);
    const now = Date.now();
    
    // Enforce max size by removing oldest entries
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, {
      result,
      expiresAt: now + this.ttl,
      lastAccessed: now,
      createdAt: now
    });
  }

  /**
   * Evict oldest entries when cache is full
   */
  evictOldest() {
    const entries = Array.from(this.cache.entries());
    
    // Sort by last accessed time (oldest first)
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    
    // Remove oldest 10% of entries
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`[TokenCache] Cleaned up ${removed} expired entries. Cache size: ${this.cache.size}`);
    }
  }

  /**
   * Clear all cached entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let expired = 0;
    
    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) expired++;
    }
    
    return {
      size: this.cache.size,
      expired,
      active: this.cache.size - expired,
      ttl: this.ttl,
      maxSize: this.maxSize
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}

// Create singleton instance
const tokenCache = new TokenCache({
  ttl: 15 * 60 * 1000,      // 15 minutes
  maxSize: 500,             // 500 tokens max
  cleanupInterval: 10 * 60 * 1000  // 10 minutes cleanup
});

// Graceful shutdown
process.on('SIGTERM', () => tokenCache.destroy());
process.on('SIGINT', () => tokenCache.destroy());

module.exports = tokenCache;