import { useState, useRef, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { requestKey, resetGateForKey } from '../utils/requestGate';
import { useTeam } from '../contexts/TeamContext';

// Module-level result cache keyed by fixVersion name. Survives component
// re-mounts so navigating between tabs does NOT re-hit the heavy endpoint.
//
// Entry shape: {
//   commit: Array,
//   longTermFunded: Array,
//   sectionMetadata: object,
//   fetchedAt: number,
// }
const releaseItemsCache = new Map();
const releaseItemsInFlight = new Map(); // version -> Promise

const RELEASE_ITEMS_TTL_MS = 5 * 60 * 1000;

function cacheKey(teamId, version) {
  return `${teamId || ''}::${version || ''}`;
}

function readItemsCache(teamId, version) {
  if (!version) return null;
  const entry = releaseItemsCache.get(cacheKey(teamId, version));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > RELEASE_ITEMS_TTL_MS) {
    releaseItemsCache.delete(cacheKey(teamId, version));
    return null;
  }
  return entry;
}

function writeCache(teamId, version, commit, longTermFunded, sectionMetadata) {
  if (!version) return;
  releaseItemsCache.set(cacheKey(teamId, version), {
    commit,
    longTermFunded,
    sectionMetadata,
    fetchedAt: Date.now(),
  });
}

/**
 * Split unified allItems array into commit vs long-term-funded sections.
 * Commit items have the fixVersion in their fixVersions string.
 * Long-term and extension items only matched by label (fixVersions may be absent).
 */
function splitItems(allItems, version) {
  const versionLower = (version || '').toLowerCase();
  const commit = [];
  const longTermFunded = [];

  for (const item of allItems) {
    const fvStr = (item.fixVersions || '').toLowerCase();
    const labelsArr = Array.isArray(item.labels) ? item.labels : [];
    const labelsStr = labelsArr.join(' ').toLowerCase();

    const isLongTerm =
      labelsStr.includes(`${versionLower}-long-term-funded`) ||
      labelsStr.includes('code-complete-extention-recieved') ||
      labelsStr.includes('code-complete-extension-recieved');

    if (isLongTerm) {
      longTermFunded.push(item);
    } else if (fvStr.includes(versionLower) || fvStr.includes(version)) {
      commit.push(item);
    } else {
      // Fallback: treat as commit if we can't classify (shouldn't normally happen)
      commit.push(item);
    }
  }

  return { commit, longTermFunded };
}

/**
 * Custom hook for fetching and managing release items.
 * Uses the unified POST /api/jira/release-items endpoint.
 */
export function useReleaseItems() {
  const { selectedTeamId } = useTeam();
  const [items, setItems] = useState({ commit: [], longTermFunded: [] });
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState('');
  const [sectionMetadata, setSectionMetadata] = useState({});

  const abortControllerRef = useRef(null);

  const performFetch = useCallback(async (version, { ignoreFailureCooldown = false } = {}) => {
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    const key = cacheKey(selectedTeamId, version);
    const body = { fixVersions: [version], teamId: selectedTeamId };

    if (!jiraToken) {
      setError('JIRA token required');
      setLoadingItems(false);
      return null;
    }

    if (ignoreFailureCooldown) {
      resetGateForKey(requestKey('POST', '/api/jira/release-items', body));
    }

    const promise = (async () => {
      try {
        const response = await authenticatedPost(
          '/api/jira/release-items',
          body,
          { jiraToken, username, ignoreFailureCooldown },
          { signal: abortControllerRef.current?.signal }
        );

        if (!response.data.success) {
          throw new Error(response.data.error || response.data.message || 'Failed to fetch release items');
        }

        const allItems = response.data.data?.allItems || [];
        return allItems;
      } finally {
        releaseItemsInFlight.delete(key);
      }
    })();

    releaseItemsInFlight.set(key, promise);

    try {
      const allItems = await promise;
      const { commit, longTermFunded } = splitItems(allItems, version);

      console.log(`[useReleaseItems] Got ${allItems.length} items → ${commit.length} commit, ${longTermFunded.length} long-term`);

      const newMetadata = {
        detectedSections: ['commit', ...(longTermFunded.length > 0 ? ['longTermFunded'] : [])],
        sectionData: {
          commit: { name: 'Commit', itemCount: commit.length, loaded: true },
          ...(longTermFunded.length > 0 && {
            longTermFunded: { name: 'Long-term-funded', itemCount: longTermFunded.length, isLegacy: true, loaded: true },
          }),
        },
        totalItems: allItems.length,
        loadingLongTerm: false,
      };

      setItems({ commit, longTermFunded });
      setSectionMetadata(newMetadata);
      writeCache(selectedTeamId, version, commit, longTermFunded, newMetadata);
      setLoadingItems(false);
      return { commit, longTermFunded };
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        console.log('[useReleaseItems] Fetch was cancelled');
        setLoadingItems(false);
        return null;
      }
      const serverMsg = err.response?.data?.error || err.response?.data?.message;
      console.error('[useReleaseItems] Error fetching items:', serverMsg || err.message);
      setError(serverMsg || err.message || 'Failed to load release items');
      setLoadingItems(false);
      return null;
    }
  }, [selectedTeamId]);

  const fetchItemsForVersion = useCallback(async (version, opts = {}) => {
    if (!version) return null;

    // Cancel any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    if (opts.ignoreFailureCooldown) {
      releaseItemsInFlight.delete(cacheKey(selectedTeamId, version));
    }

    // Cache hit — skip when the user explicitly chose this version / Load
    const cached = opts.ignoreFailureCooldown ? null : readItemsCache(selectedTeamId, version);
    if (cached) {
      setItems({ commit: cached.commit, longTermFunded: cached.longTermFunded || [] });
      setSectionMetadata(cached.sectionMetadata || {});
      return { commit: cached.commit, longTermFunded: cached.longTermFunded || [] };
    }

    // Deduplicate concurrent fetches
    const key = cacheKey(selectedTeamId, version);
    const existing = releaseItemsInFlight.get(key);
    if (existing) {
      try {
        const allItems = await existing;
        if (Array.isArray(allItems)) {
          const split = splitItems(allItems, version);
          setItems(split);
        }
        return null;
      } catch {
        return null;
      }
    }

    setLoadingItems(true);
    setError('');
    setItems({ commit: [], longTermFunded: [] });
    setSectionMetadata({});

    return performFetch(version, opts);
  }, [performFetch, selectedTeamId]);

  // fetchLongTermItems is a no-op now — long-term items are fetched in the same
  // request as commit items. Kept for API compatibility with ReleaseVersionTab.
  const fetchLongTermItems = useCallback(async (_version) => {
    return null;
  }, []);

  const refreshItemsForVersion = useCallback(async (version) => {
    if (!version) return null;
    releaseItemsCache.delete(cacheKey(selectedTeamId, version));
    return fetchItemsForVersion(version, { ignoreFailureCooldown: true });
  }, [fetchItemsForVersion, selectedTeamId]);

  const cancelRequests = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    items,
    loadingItems,
    error,
    setError,
    fetchItemsForVersion,
    refreshItemsForVersion,
    fetchLongTermItems,
    setItems,
    sectionMetadata,
    cancelRequests,
  };
}
