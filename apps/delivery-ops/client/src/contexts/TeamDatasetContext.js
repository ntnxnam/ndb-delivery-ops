/**
 * TeamDatasetContext — centralised data bundle for the selected team/product.
 *
 * Mirrors the Python chatbot's st.session_state.processed_df pattern:
 *   - One sync run fills the on-disk cache via POST /api/release-dataset/sync
 *   - Every page reads from the in-memory bundle (no repeated JIRA fetches)
 *   - When no bundle is present, pages fall back to their existing API calls
 *
 * Lifecycle:
 *   1. On mount (or team change): check /sync-status
 *      a. If bundle exists and is fresh  → load /bundle into memory
 *      b. If bundle stale (>10 min)      → reload /bundle (no full sync)
 *      c. If no bundle                   → set bundle = null (pages use fallback)
 *   2. triggerSync() — user-initiated: POST /sync (SSE stream), then load /bundle
 *   3. refreshFromDisk() — pull latest /bundle without a full JIRA sync
 *
 * SSE progress uses fetch() + ReadableStream because EventSource cannot carry
 * the Authorization header (see plan caveat #1).
 *
 * Per react-useeffect-infinite-loop-prevention.mdc: all callbacks are
 * memoised with useCallback; no objects created inside renders appear in
 * useEffect dependency arrays.
 */

import React, {
  createContext,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { getApiBase, getAuthHeaders } from '../utils/api';
import { useTeam } from './TeamContext';

const TeamDatasetContext = createContext(null);

// ─── provider ────────────────────────────────────────────────────────────────

export const TeamDatasetProvider = ({ children }) => {
  const { selectedTeam } = useTeam();
  const productId = selectedTeam?.productId || 'ndb';

  // Sync-in-progress state (server-side flag also polled via /sync-status).
  const [isSyncing, setIsSyncing] = useState(false);

  // SSE progress events while a sync is running.
  const [syncProgress, setSyncProgress] = useState([]);

  // Last known sync metadata (without ticket array).
  const [syncMeta, setSyncMeta] = useState(null);

  // Human-readable status string shown in the nav chip.
  const [syncError, setSyncError] = useState(null);

  // ─── helpers ───────────────────────────────────────────────────────────────

  const API_BASE = getApiBase();

  /** Build auth headers from localStorage (same pattern as getAuthHeaders). */
  const buildHeaders = useCallback(() => {
    return getAuthHeaders().headers;
  }, []);

  /** Load /sync-status and return the parsed payload. */
  const fetchSyncStatus = useCallback(async (pid) => {
    const headers = buildHeaders();
    const res = await fetch(
      `${API_BASE}/api/release-dataset/sync-status?productId=${encodeURIComponent(pid)}`,
      { headers }
    );
    if (!res.ok) throw new Error(`sync-status HTTP ${res.status}`);
    const json = await res.json();
    return json.data;
  }, [API_BASE, buildHeaders]);

  const refreshFromDisk = useCallback(async () => {
    try {
      const status = await fetchSyncStatus(productId);
      setSyncMeta(status?.bundleMeta || null);
    } catch (_e) {
      // best effort refresh only
    }
  }, [fetchSyncStatus, productId]);

  /**
   * Wipe the on-disk cache for the active product.
   *
   * @param {'bundle'|'full'} mode
   *   'bundle' — removes bundle only (per-release caches survive; next sync is fast)
   *   'full'   — removes everything including per-release caches and any stale lock
   */
  const resetCache = useCallback(async (mode = 'bundle') => {
    const headers = buildHeaders();
    const params = new URLSearchParams({ productId, mode });
    const res = await fetch(
      `${API_BASE}/api/release-dataset/cache?${params.toString()}`,
      { method: 'DELETE', headers }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`reset HTTP ${res.status}: ${text}`);
    }
    const json = await res.json();
    // Sync meta is now stale — clear it locally.
    setSyncMeta(null);
    setSyncProgress([]);
    setSyncError(null);
    return json.data;
  }, [API_BASE, buildHeaders, productId]);

  // ─── triggerSync ───────────────────────────────────────────────────────────

  /**
   * Run a full sync via POST /sync and stream progress events.
   *
   * @param {object} opts
   * @param {string[]} [opts.forceReleases]  — releases to force-refetch
   * @param {boolean}  [opts.forceAll]       — force-refetch every release (ignore per-release cache)
   * @param {boolean}  [opts.skipChangelog]  — skip changelog enrichment
   * @param {function} [opts.onProgress]     — (event) => void, called per SSE event
   */
  const triggerSync = useCallback(async (opts = {}) => {
    const pid = productId;
    const { forceReleases = [], forceAll = false, skipChangelog = false, onProgress } = opts;

    if (isSyncing) {
      console.warn('[TeamDatasetContext] sync already in progress');
      return;
    }

    setIsSyncing(true);
    setSyncProgress([]);
    setSyncError(null);

    try {
      const headers = buildHeaders();

      const params = new URLSearchParams({ productId: pid });
      if (forceAll) {
        params.set('forceAll', 'true');
      } else if (forceReleases.length) {
        params.set('forceReleases', forceReleases.join(','));
      }
      if (skipChangelog) params.set('skipChangelog', 'true');

      const res = await fetch(
        `${API_BASE}/api/release-dataset/sync?${params.toString()}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`sync HTTP ${res.status}: ${text}`);
      }

      // Pump the SSE stream via ReadableStream (EventSource cannot carry auth headers).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer.
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const event = JSON.parse(trimmed.slice(5).trim());
            setSyncProgress((prev) => [...prev, event]);
            onProgress?.(event);
          } catch (_) {
            // Malformed SSE line — ignore.
          }
        }
      }

      // After SSE closes, refresh sync metadata.
      const status = await fetchSyncStatus(pid);
      setSyncMeta(status?.bundleMeta || null);
    } catch (e) {
      const msg = e?.message || 'Sync failed';
      const isNetworkDown = msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('net::ERR');
      const displayMsg = isNetworkDown
        ? 'Cannot reach the backend server (port 6001). Make sure it is running and try again.'
        : msg;
      console.error('[TeamDatasetContext] triggerSync error:', msg);
      setSyncError(displayMsg);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, API_BASE, buildHeaders, fetchSyncStatus, productId]);

  // ─── initialise on team / product change ───────────────────────────────────

  const initialise = useCallback(async (pid) => {
    try {
      const status = await fetchSyncStatus(pid);
      if (status?.bundleMeta) {
        setSyncMeta(status.bundleMeta);
      } else {
        setSyncMeta(null);
      }
    } catch (e) {
      // /sync-status failed (e.g. server offline).
      console.warn('[TeamDatasetContext] init failed:', e?.message);
      setSyncMeta(null);
    }
  }, [fetchSyncStatus]);

  // Re-initialise whenever the active product changes.
  useEffect(() => {
    if (!productId) return;
    setSyncMeta(null);
    setSyncError(null);
    setSyncProgress([]);
    initialise(productId);
  }, [productId, initialise]);

  // ─── context value ─────────────────────────────────────────────────────────

  const value = {
    /** Deprecated: full bundle removed in unified layer. */
    bundle: null,
    /** Back-compat alias for older consumers. */
    bundleMeta: syncMeta,
    /** Lightweight metadata (lastSyncIso, numTickets, etc.). */
    syncMeta,
    /** True while POST /sync is streaming. */
    isSyncing,
    /** Ordered list of SSE progress events from the most recent sync. */
    syncProgress,
    /** Error message from the last failed sync, or null. */
    syncError,
    /** Trigger a full JIRA sync (SSE stream). */
    triggerSync,
    /** Pull the latest bundle from disk without a full sync. */
    refreshFromDisk,
    /** Wipe the on-disk cache. mode='bundle'|'full'. */
    resetCache,
    /** True when a bundle exists on disk (syncMeta is non-null). */
    isReady: syncMeta !== null,
  };

  return (
    <TeamDatasetContext.Provider value={value}>
      {children}
    </TeamDatasetContext.Provider>
  );
};

export default TeamDatasetContext;
