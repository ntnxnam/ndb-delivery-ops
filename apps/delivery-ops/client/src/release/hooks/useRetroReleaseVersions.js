import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listReleaseVersions } from '../services/releaseBriefService';

/**
 * useRetroReleaseVersions — fetch the release-versions list *including*
 * released (past) versions, so the Retrospective can run on shipped
 * releases like NDB-2.11.
 *
 * This is scoped to the retro page on purpose: it calls the shared
 * `/api/jira/release-versions` endpoint with `includeReleased: true`,
 * leaving the global SelectedReleaseContext (unreleased-only) untouched.
 *
 * Fetch policy (no request storms per minimal-architecture.mdc):
 *   - One automatic fetch per (teamId, token, username). When the token or
 *     team becomes ready the deps change and it refetches once.
 *   - It does NOT auto-retry on empty/error. Instead it surfaces
 *     `versionsError` + a manual `refetchVersions()` so an empty dropdown
 *     (transient JIRA failure / rate-limit) is recoverable with one click
 *     rather than a silent dead end.
 */
export function useRetroReleaseVersions({ teamId, jiraToken, username }) {
  const [versions, setVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  // Bumped by refetchVersions() to force the effect to run again.
  const [reloadTick, setReloadTick] = useState(0);
  // Guards against setting state after unmount / superseded fetch.
  const runIdRef = useRef(0);

  const refetchVersions = useCallback(() => {
    setReloadTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const runId = ++runIdRef.current;
    if (!teamId || !jiraToken) {
      setVersions([]);
      setVersionsError('');
      setLoadingVersions(false);
      return undefined;
    }
    setLoadingVersions(true);
    setVersionsError('');
    // A manual retry should bypass the request-gate failure cooldown so the
    // user is never stuck behind a prior transient failure.
    listReleaseVersions({
      teamId,
      jiraToken,
      username,
      includeReleased: true,
      ignoreFailureCooldown: reloadTick > 0,
    })
      .then(({ versions: v }) => {
        if (runId !== runIdRef.current) return;
        setVersions(Array.isArray(v) ? v : []);
      })
      .catch((err) => {
        if (runId !== runIdRef.current) return;
        setVersions([]);
        setVersionsError(
          err?.response?.data?.error || err?.message || 'Failed to load release versions'
        );
      })
      .finally(() => {
        if (runId !== runIdRef.current) return;
        setLoadingVersions(false);
      });
    return () => {
      // Invalidate this run so a late resolve cannot clobber a newer one.
      runIdRef.current += 1;
    };
  }, [teamId, jiraToken, username, reloadTick]);

  const activeVersions = useMemo(
    () => versions.filter((v) => v?.name && !v.released),
    [versions]
  );
  const inactiveVersions = useMemo(
    () => versions.filter((v) => v?.name && v.released),
    [versions]
  );

  return {
    activeVersions,
    inactiveVersions,
    loadingVersions,
    versionsError,
    refetchVersions,
  };
}
