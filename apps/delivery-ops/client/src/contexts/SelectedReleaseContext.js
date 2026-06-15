import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTeam } from './TeamContext';
import { listReleaseVersions, fetchGateTimeline, pickDefaultRelease } from '../release/services/releaseBriefService';

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
  return entry.versions;
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
  const { selectedTeamId, selectedTeam, hasTeamSelected } = useTeam();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const [versions, setVersions] = useState(() => readVersionsCache(selectedTeamId) || []);
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
      return [];
    }

    if (!force) {
      const cached = readVersionsCache(selectedTeamId);
      if (cached) {
        setVersions(cached);
        return cached;
      }
    } else {
      versionsCache.delete(selectedTeamId);
    }

    const existing = versionsInFlight.get(selectedTeamId);
    if (existing) {
      try {
        const data = await existing;
        setVersions(data);
        return data;
      } catch (err) {
        setVersions([]);
        if (isJiraUnreachable(err)) {
          setJiraUnreachable(true);
          setVersionsError('Cannot reach JIRA — check your VPN connection.');
        } else {
          setVersionsError(err?.message || 'Failed to load release versions');
        }
        return [];
      }
    }

    setLoadingVersions(true);
    setVersionsError('');
    const promise = (async () => {
      try {
        const { versions: fetched } = await listReleaseVersions({
          teamId: selectedTeamId,
          jiraToken,
          username,
        });
        versionsCache.set(selectedTeamId, { versions: fetched, fetchedAt: Date.now() });
        return fetched;
      } finally {
        versionsInFlight.delete(selectedTeamId);
      }
    })();

    versionsInFlight.set(selectedTeamId, promise);
    try {
      const fetched = await promise;
      setVersions(fetched);
      setJiraUnreachable(false);
      return fetched;
    } catch (err) {
      setVersions([]);
      if (isJiraUnreachable(err)) {
        setJiraUnreachable(true);
        setVersionsError('Cannot reach JIRA — check your VPN connection.');
      } else {
        setVersionsError(err?.message || 'Failed to load release versions');
      }
      return [];
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
    (async () => {
      const fetched = await loadVersions(false);
      if (cancelled) return;
      setSelectedReleaseState((prev) => {
        const preferred = prev || localStorage.getItem(RELEASE_STORAGE_KEY) || '';
        const picked = pickDefaultRelease(fetched, preferred) || '';
        if (picked) {
          localStorage.setItem(RELEASE_STORAGE_KEY, picked);
        }
        return picked;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, loadVersions]);

  useEffect(() => {
    loadGateTimeline(selectedRelease, false);
  }, [selectedRelease, loadGateTimeline]);

  const value = useMemo(() => ({
    selectedRelease,
    setSelectedRelease,
    versions,
    gateTimeline,
    loadingVersions,
    loadingGateTimeline,
    versionsError,
    gateError,
    jiraUnreachable,
    productId: selectedTeam?.productId || 'ndb',
    refreshVersions: () => loadVersions(true),
    refreshGateTimeline: () => loadGateTimeline(selectedRelease, true),
  }), [
    gateError,
    gateTimeline,
    jiraUnreachable,
    loadingGateTimeline,
    loadingVersions,
    selectedRelease,
    selectedTeam?.productId,
    setSelectedRelease,
    versions,
    versionsError,
    loadVersions,
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

