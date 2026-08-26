import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTeam } from './TeamContext';
import { listReleaseVersions, fetchGateTimeline, pickDefaultRelease } from '../release/services/releaseBriefService';

/**
 * The server lists unreleased versions from the team's JIRA project.
 * Trust that list — do not re-filter to a product prefix.
 */
export function isAllowedVersion(v) {
  const name = typeof v === 'string' ? v : v?.name;
  return Boolean(name);
}

function isJiraUnreachable(err) {
  const status = err?.response?.status;
  if (status === 503) return true;
  const reason = err?.response?.data?.reason;
  return reason === 'jira_unreachable';
}

const SelectedReleaseContext = createContext(null);

const RELEASE_STORAGE_KEY = 'selectedRelease';
const VERSIONS_TTL_MS = 10 * 60 * 1000;
const GATE_TTL_MS = 5 * 60 * 1000;

const versionsCache = new Map();
const versionsInFlight = new Map();
const gateCache = new Map();
const gateInFlight = new Map();

function readVersionsCache(teamId) {
  if (!teamId) return null;
  const entry = versionsCache.get(teamId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > VERSIONS_TTL_MS) {
    versionsCache.delete(teamId);
    return null;
  }
  return { versions: entry.versions, defaultVersion: entry.defaultVersion || null };
}

function readGateCache(release) {
  if (!release) return null;
  const entry = gateCache.get(release);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > GATE_TTL_MS) {
    gateCache.delete(release);
    return null;
  }
  return entry.timeline;
}

export function SelectedReleaseProvider({ children }) {
  const { selectedTeamId, selectedTeam, hasTeamSelected, teamEpoch } = useTeam();
  const loadedEpochRef = useRef(0);
  const loadedTeamIdRef = useRef(selectedTeamId);
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const [versions, setVersions] = useState(() => readVersionsCache(selectedTeamId)?.versions || []);
  const [selectedRelease, setSelectedReleaseState] = useState(() => localStorage.getItem(RELEASE_STORAGE_KEY) || '');
  const [gateTimeline, setGateTimeline] = useState(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingGateTimeline, setLoadingGateTimeline] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [gateError, setGateError] = useState('');
  const [jiraUnreachable, setJiraUnreachable] = useState(false);

  const setSelectedRelease = useCallback((release) => {
    setSelectedReleaseState(release || '');
    if (release) {
      localStorage.setItem(RELEASE_STORAGE_KEY, release);
    } else {
      localStorage.removeItem(RELEASE_STORAGE_KEY);
    }
  }, []);

  const loadVersions = useCallback(async (force = false) => {
    if (!hasTeamSelected || !selectedTeamId || !jiraToken) {
      setVersions([]);
      return { versions: [], defaultVersion: null };
    }

    if (!force) {
      const cached = readVersionsCache(selectedTeamId);
      if (cached) {
        setVersions(cached.versions);
        return cached;
      }
    } else {
      versionsCache.delete(selectedTeamId);
    }

    const existing = versionsInFlight.get(selectedTeamId);
    if (existing) {
      try {
        const data = await existing;
        setVersions(data.versions);
        return data;
      } catch (err) {
        setVersions([]);
        if (isJiraUnreachable(err)) {
          setJiraUnreachable(true);
          setVersionsError('Cannot reach JIRA — check your VPN connection.');
        } else {
          setVersionsError(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to load release versions');
        }
        return { versions: [], defaultVersion: null };
      }
    }

    setLoadingVersions(true);
    setVersionsError('');
    const promise = (async () => {
      try {
        const { versions: fetched, defaultVersion } = await listReleaseVersions({
          teamId: selectedTeamId,
          jiraToken,
          username,
        });
        const payload = { versions: fetched, defaultVersion: defaultVersion || null, fetchedAt: Date.now() };
        versionsCache.set(selectedTeamId, payload);
        return payload;
      } finally {
        versionsInFlight.delete(selectedTeamId);
      }
    })();

    versionsInFlight.set(selectedTeamId, promise);
    try {
      const payload = await promise;
      setVersions(payload.versions);
      setJiraUnreachable(false);
      return payload;
    } catch (err) {
      setVersions([]);
      if (isJiraUnreachable(err)) {
        setJiraUnreachable(true);
        setVersionsError('Cannot reach JIRA — check your VPN connection.');
      } else {
        setVersionsError(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to load release versions');
      }
      return { versions: [], defaultVersion: null };
    } finally {
      setLoadingVersions(false);
    }
  }, [hasTeamSelected, jiraToken, selectedTeamId, username]);

  const loadGateTimeline = useCallback(async (release, force = false) => {
    if (!release || !jiraToken || !username) {
      setGateTimeline(null);
      return null;
    }

    if (!force) {
      const cached = readGateCache(release);
      if (cached) {
        setGateTimeline(cached);
        return cached;
      }
    } else {
      gateCache.delete(release);
    }

    const existing = gateInFlight.get(release);
    if (existing) {
      try {
        const timeline = await existing;
        setGateTimeline(timeline);
        return timeline;
      } catch (err) {
        setGateTimeline(null);
        if (isJiraUnreachable(err)) {
          setJiraUnreachable(true);
          setGateError('Cannot reach JIRA — check your VPN connection.');
        } else {
          setGateError(err?.message || 'Failed to load gate timeline');
        }
        return null;
      }
    }

    setLoadingGateTimeline(true);
    setGateError('');
    const promise = (async () => {
      try {
        const { timeline } = await fetchGateTimeline({
          release,
          jiraToken,
          username,
        });
        gateCache.set(release, { timeline, fetchedAt: Date.now() });
        return timeline;
      } finally {
        gateInFlight.delete(release);
      }
    })();
    gateInFlight.set(release, promise);

    try {
      const timeline = await promise;
      setGateTimeline(timeline);
      setJiraUnreachable(false);
      return timeline;
    } catch (err) {
      if (isJiraUnreachable(err)) {
        setJiraUnreachable(true);
        setGateError('Cannot reach JIRA — check your VPN connection.');
      } else {
        setGateError(err?.message || 'Failed to load gate timeline');
      }
      setGateTimeline(null);
      return null;
    } finally {
      setLoadingGateTimeline(false);
    }
  }, [jiraToken, username]);

  useEffect(() => {
    let cancelled = false;
    const teamChanged = selectedTeamId !== loadedTeamIdRef.current;
    const force = teamEpoch > loadedEpochRef.current || teamChanged;

    if (teamChanged) {
      loadedTeamIdRef.current = selectedTeamId;
      setVersions([]);
      setVersionsError('');
      setGateTimeline(null);
      setSelectedReleaseState('');
      localStorage.removeItem(RELEASE_STORAGE_KEY);
    }

    (async () => {
      const payload = await loadVersions(force);
      if (cancelled) return;
      loadedEpochRef.current = teamEpoch;
      const fetched = payload.versions || [];
      setSelectedReleaseState((prev) => {
        // After a team switch, never keep the previous team's release.
        const preferred = teamChanged
          ? ''
          : (prev || localStorage.getItem(RELEASE_STORAGE_KEY) || '');
        const picked = pickDefaultRelease(fetched, preferred, payload.defaultVersion) || '';
        if (picked) {
          localStorage.setItem(RELEASE_STORAGE_KEY, picked);
        } else {
          localStorage.removeItem(RELEASE_STORAGE_KEY);
        }
        return picked;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, teamEpoch, loadVersions]);

  useEffect(() => {
    loadGateTimeline(selectedRelease, false);
  }, [selectedRelease, loadGateTimeline]);

  // Pre-split into active (unreleased) and inactive (released). The server
  // already scoped `versions` to this team.
  const activeVersions = useMemo(
    () => versions.filter((v) => isAllowedVersion(v) && !v.released),
    [versions]
  );
  const inactiveVersions = useMemo(
    () => versions.filter((v) => isAllowedVersion(v) && v.released),
    [versions]
  );

  // Clears the stored preferred release and re-picks using the GA-date logic.
  // Called after "Test Connection" succeeds so the default re-evaluates against
  // live JIRA data rather than a potentially stale localStorage value.
  const refreshVersionsAndResetDefault = useCallback(async () => {
    localStorage.removeItem(RELEASE_STORAGE_KEY);
    const fetchedPayload = await loadVersions(true);
    setSelectedReleaseState(() => {
      const picked = pickDefaultRelease(fetchedPayload.versions, '', fetchedPayload.defaultVersion) || '';
      if (picked) localStorage.setItem(RELEASE_STORAGE_KEY, picked);
      return picked;
    });
  }, [loadVersions]);

  const value = useMemo(() => ({
    selectedRelease,
    setSelectedRelease,
    versions,
    activeVersions,
    inactiveVersions,
    gateTimeline,
    loadingVersions,
    loadingGateTimeline,
    versionsError,
    gateError,
    jiraUnreachable,
    productId: selectedTeam?.id || selectedTeam?.productId || '',
    // fetchVersions — returns from cache if still fresh; never forces a re-fetch.
    fetchVersions: () => loadVersions(false),
    // refreshVersions — busts the cache and forces a new JIRA call.
    refreshVersions: () => loadVersions(true),
    // refreshVersionsAndResetDefault — busts cache + clears localStorage preference
    // so pickDefaultRelease re-runs the GA-date logic with fresh JIRA data.
    refreshVersionsAndResetDefault,
    refreshGateTimeline: () => loadGateTimeline(selectedRelease, true),
  }), [
    activeVersions,
    inactiveVersions,
    loadVersions,
    gateError,
    gateTimeline,
    jiraUnreachable,
    loadingGateTimeline,
    loadingVersions,
    refreshVersionsAndResetDefault,
    selectedRelease,
    selectedTeam?.id,
    selectedTeam?.productId,
    setSelectedRelease,
    versions,
    versionsError,
    loadGateTimeline,
  ]);

  return (
    <SelectedReleaseContext.Provider value={value}>
      {children}
    </SelectedReleaseContext.Provider>
  );
}

export function useSelectedRelease() {
  const ctx = useContext(SelectedReleaseContext);
  if (!ctx) {
    throw new Error('useSelectedRelease must be used within SelectedReleaseProvider');
  }
  return ctx;
}

