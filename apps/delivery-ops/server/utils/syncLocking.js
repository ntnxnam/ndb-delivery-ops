const DEFAULT_TTL_MS = 120000;

class SyncLocking {
  constructor() {
    this.locks = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [key, value] of this.locks.entries()) {
      if (value.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }

  acquire(key, options = {}) {
    const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
    const owner = options.owner || 'unknown';
    const now = Date.now();
    this.cleanup(now);
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) {
      return {
        ok: false,
        key,
        owner: existing.owner,
        remainingMs: Math.max(0, existing.expiresAt - now),
      };
    }

    this.locks.set(key, {
      owner,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    });

    return { ok: true, key };
  }

  release(key) {
    this.locks.delete(key);
  }

  releaseMany(keys = []) {
    for (const key of keys) {
      this.release(key);
    }
  }

  isLocked(key) {
    const now = Date.now();
    this.cleanup(now);
    const lock = this.locks.get(key);
    if (!lock) return false;
    return lock.expiresAt > now;
  }

  listActive() {
    const now = Date.now();
    this.cleanup(now);
    return Array.from(this.locks.entries()).map(([key, value]) => ({
      key,
      owner: value.owner,
      acquiredAt: value.acquiredAt,
      expiresAt: value.expiresAt,
      remainingMs: Math.max(0, value.expiresAt - now),
    }));
  }
}

module.exports = new SyncLocking();
