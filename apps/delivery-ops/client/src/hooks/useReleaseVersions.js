import { useState, useRef, useEffect, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';
import { useTeam } from '../contexts/TeamContext';

// In-flight request per teamId so we only fire one POST when multiple effects/pages call fetchVersions
const releaseVersionsInFlight = new Map();

// Module-level result cache keyed by teamId. Survives component unmount / re-mount
// so navigating between ReleaseVersionTab, ReleaseTrendsPage, etc. does NOT re-hit
// /api/jira/release-versions. Use refreshVersions() to bypass the cache.
//
// Entry shape: { versions: Array, error: string, fetchedAt: number }
const releaseVersionsCache = new Map();

// 10 minutes — long enough that tab-switching is free, short enough that a session
// left open across a release cut sees fresh data without manual refresh.
const RELEASE_VERSIONS_TTL_MS = 10 * 60 * 1000;

function getCachedVersions(teamId) {
  if (!teamId) return null;
  const entry = releaseVersionsCache.get(teamId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > RELEASE_VERSIONS_TTL_MS) {
    releaseVersionsCache.delete(teamId);
    return null;
  }
  return entry;
}

function setCachedVersions(teamId, versions, error) {
  if (!teamId) return;
  releaseVersionsCache.set(teamId, { versions, error, fetchedAt: Date.now() });
}

function clearCachedVersions(teamId) {
  if (teamId) releaseVersionsCache.delete(teamId);
}

/**
 * Custom hook for managing release versions with team context
 * @returns {object} - { versions, selectedVersion, loadingVersions, showVersionDropdown, defaultVersion, fetchVersions, handleVersionChange, setSelectedVersion }
 */
export function useReleaseVersions() {
  const { selectedTeamId, registerTeamChangeCallback, registerApiRequest } = useTeam();
  // Hydrate from module cache so a re-mount within the same team is instant.
  const initialCache = getCachedVersions(selectedTeamId);
  const [versions, setVersions] = useState(initialCache ? initialCache.versions : []);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [showVersionDropdown, setShowVersionDropdown] = useState(Boolean(initialCache));
  const [defaultVersion, setDefaultVersion] = useState('');
  const [error, setError] = useState(initialCache ? (initialCache.error || '') : '');
  const jiraTokenRef = useRef('');
  const usernameRef = useRef('');

  // Store token and username in refs to avoid re-renders
  useEffect(() => {
    jiraTokenRef.current = localStorage.getItem('jiraToken') || '';
    usernameRef.current = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  }, []);

  // Sync local state from cache whenever selectedTeamId changes (handles
  // switching teams: if the new team's data is cached, restore it instantly
  // without firing a fetch).
  useEffect(() => {
    const cached = getCachedVersions(selectedTeamId);
    if (cached) {
      setVersions(cached.versions);
      setShowVersionDropdown(true);
      setError(cached.error || '');
    } else {
      setVersions([]);
      setShowVersionDropdown(false);
      setError('');
    }
  }, [selectedTeamId]);

  // Clear in-memory selection on team change. Cached versions for the previous
  // team stay in the module map (TTL'd) so a quick switch-back is free.
  useEffect(() => {
    const cleanup = registerTeamChangeCallback(() => {
      console.log('[useReleaseVersions] Team changed - resetting selection');
      setSelectedVersion(null);
      setLoadingVersions(false);
    });
    return cleanup;
  }, [registerTeamChangeCallback]);

  // Internal: actually hit /api/jira/release-versions. Shared by fetchVersions (cache-aware)
  // and refreshVersions (force-bypass).
  const performFetch = useCallback(async (teamId) => {
    setLoadingVersions(true);
    setError('');

    const promise = (async () => {
      const controller = new AbortController();
      const unregisterRequest = registerApiRequest(controller);

      try {
        const jiraToken = jiraTokenRef.current;
        const username = usernameRef.current;
        const response = await authenticatedPost('/api/jira/release-versions', { teamId }, {
          jiraToken,
          username
        }, { signal: controller.signal });

        if (response.data.success) {
          const fetchedVersions = response.data.versions || [];
          const errMsg = fetchedVersions.length === 0
            ? 'No open release versions found for this team\'s project.'
            : '';
          return { versions: fetchedVersions, error: errMsg };
        }
        return {
          versions: [],
          error: response.data.error || response.data.message || 'Failed to fetch versions'
        };
      } catch (err) {
        console.error('[useReleaseVersions] Error fetching versions:', err?.response?.data || err);
        return {
          versions: [],
          error: getUserFacingMessage(err, { context: 'release-versions', fallback: 'Failed to load release versions. Please try again.' })
        };
      } finally {
        unregisterRequest();
        releaseVersionsInFlight.delete(teamId);
      }
    })();

    releaseVersionsInFlight.set(teamId, promise);

    try {
      const result = await promise;
      setVersions(result.versions);
      setShowVersionDropdown(true);
      setError(result.error || '');
      setCachedVersions(teamId, result.versions, result.error || '');
    } finally {
      setLoadingVersions(false);
    }
  }, [registerApiRequest]);

  // Cache-aware fetch — used by mount-time effects in consumer components.
  // Returns immediately (hydrating local state) when the team's versions are
  // already cached. Only hits the API on cache miss.
  const fetchVersions = useCallback(async () => {
    const jiraToken = jiraTokenRef.current;
    const teamId = selectedTeamId;

    if (!jiraToken) {
      setError('JIRA token required');
      return;
    }
    if (!teamId) {
      setError('Select a team in the header to load release versions.');
      return;
    }

    // Cache hit -- hydrate local state and skip the API call.
    const cached = getCachedVersions(teamId);
    if (cached) {
      setVersions(cached.versions);
      setShowVersionDropdown(true);
      setError(cached.error || '');
      return;
    }

    // Concurrent in-flight request for this team -- await its result.
    const existing = releaseVersionsInFlight.get(teamId);
    if (existing) {
      try {
        const result = await existing;
        setVersions(result.versions);
        setShowVersionDropdown(true);
        setError(result.error || '');
      } catch {
        setVersions([]);
      }
      return;
    }

    await performFetch(teamId);
  }, [selectedTeamId, performFetch]);

  // Force-refresh — bypasses cache. Wire this to explicit user-initiated refresh
  // actions (Refresh button, post-create/post-rename retries).
  const refreshVersions = useCallback(async () => {
    const jiraToken = jiraTokenRef.current;
    const teamId = selectedTeamId;

    if (!jiraToken) {
      setError('JIRA token required');
      return;
    }
    if (!teamId) {
      setError('Select a team in the header to load release versions.');
      return;
    }
    clearCachedVersions(teamId);
    await performFetch(teamId);
  }, [selectedTeamId, performFetch]);

  const handleVersionChange = (event) => {
    const version = event.target.value;
    setSelectedVersion(version);
  };

  // No auto-fetch here: pages that need versions (ReleaseVersionTab, ReleaseTrendsPage) call fetchVersions
  // when mounted and team + token exist, so we only call the API when the user is on a page that needs it.

  return {
    versions,
    selectedVersion,
    loadingVersions,
    showVersionDropdown,
    defaultVersion,
    setDefaultVersion,
    setSelectedVersion,
    fetchVersions,
    refreshVersions,
    handleVersionChange,
    error,
    setError
  };
}

