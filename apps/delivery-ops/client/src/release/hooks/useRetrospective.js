import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchRetrospectiveBootstrap,
  fetchRetrospectiveProjectDetail,
  fetchRetrospectiveProjects,
  fetchRetrospective,
} from '../services/retrospectiveService';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';
import { useReleaseData } from '../../contexts/ReleaseDataContext';
import {
  deriveRetroProjectsFromBundle,
  deriveRetroDetailFromBundle,
} from '../utils/bundleUtils';

export function useRetrospective({
  teamId,
  productId = 'ndb',
  jiraToken,
  username,
  topN = 10,
}) {
  const [bootstrap, setBootstrap] = useState(null);
  const [projectsPage, setProjectsPage] = useState(null);
  const [selectedProjectKey, setSelectedProjectKey] = useState('');
  const [projectDetail, setProjectDetail] = useState(null);
  const [retroFallback, setRetroFallback] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);
  const {
    versions,
    activeVersions,
    inactiveVersions,
    selectedRelease,
    setSelectedRelease,
  } = useSelectedRelease();
  const { releaseTickets, releaseError } = useReleaseData();
  const [loadingVersions] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingFallback, setLoadingFallback] = useState(false);
  const [error, setError] = useState('');
  const [fallbackAttemptedForRelease, setFallbackAttemptedForRelease] = useState('');

  const ready = !!teamId && !!jiraToken;

  const loadBootstrap = useCallback(async () => {
    if (!ready || !selectedRelease) return;
    setLoadingBootstrap(true);
    try {
      const { bootstrap: data } = await fetchRetrospectiveBootstrap({
        release: selectedRelease,
        productId,
        jiraToken,
        username,
      });
      setBootstrap(data);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load retrospective bootstrap');
    } finally {
      setLoadingBootstrap(false);
    }
  }, [ready, selectedRelease, productId, jiraToken, username]);

  const loadProjects = useCallback(async () => {
    if (!ready || !selectedRelease) return;
    const bundleDerived = deriveRetroProjectsFromBundle(releaseTickets, selectedRelease);
    if (bundleDerived) {
      setProjectsPage(bundleDerived);
      setSelectedProjectKey((prev) => prev || bundleDerived.projects[0]?.key || '');
      setError('');
      return;
    }
    setLoadingProjects(true);
    try {
      const { projectsPage: data } = await fetchRetrospectiveProjects({
        release: selectedRelease,
        productId,
        page: 1,
        limit: 50,
        jiraToken,
        username,
      });
      setProjectsPage(data);
      setSelectedProjectKey((prev) => prev || data?.projects?.[0]?.key || '');
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load retrospective projects');
    } finally {
      setLoadingProjects(false);
    }
  }, [ready, selectedRelease, productId, jiraToken, username, releaseTickets]);

  const loadDetail = useCallback(async () => {
    if (!ready || !selectedRelease || !selectedProjectKey || !projectsPage?.projects?.length) return;
    const row = projectsPage.projects.find((p) => p.key === selectedProjectKey);
    if (!row) return;
    if (releaseTickets && releaseTickets.length > 0 && bootstrap?.gateDates) {
      const bundleDetail = deriveRetroDetailFromBundle(releaseTickets, selectedRelease, row.key, bootstrap.gateDates);
      if (bundleDetail) {
        setProjectDetail(bundleDetail);
        setError('');
        return;
      }
    }
    setLoadingDetail(true);
    try {
      const { detail } = await fetchRetrospectiveProjectDetail({
        release: selectedRelease,
        productId,
        parentKey: row.key,
        parentType: row.parentType,
        parentSummary: row.summary,
        jiraToken,
        username,
      });
      setProjectDetail(detail);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load project detail');
    } finally {
      setLoadingDetail(false);
    }
  }, [ready, selectedRelease, selectedProjectKey, projectsPage, productId, jiraToken, username, releaseTickets, bootstrap]);

  const loadFallback = useCallback(async () => {
    if (!ready || !selectedRelease) return;
    setLoadingFallback(true);
    try {
      const { retro: data } = await fetchRetrospective({ release: selectedRelease, productId, topN, jiraToken, username });
      setRetroFallback(data);
    } catch (_e) {
      setRetroFallback(null);
    } finally {
      setLoadingFallback(false);
    }
  }, [ready, selectedRelease, productId, topN, jiraToken, username]);

  // No auto-fetch on mount or release change — user must press Fetch.

  // Detail still auto-loads when a project row is selected (that's a deliberate click).
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Fallback only triggers after a user-initiated fetch has errored.
  useEffect(() => {
    if (
      hasFetched &&
      error &&
      selectedRelease &&
      fallbackAttemptedForRelease !== selectedRelease &&
      !loadingBootstrap &&
      !loadingProjects &&
      !loadingDetail &&
      !retroFallback
    ) {
      setFallbackAttemptedForRelease(selectedRelease);
      loadFallback();
    }
  }, [hasFetched, error, selectedRelease, fallbackAttemptedForRelease, loadingBootstrap, loadingProjects, loadingDetail, retroFallback, loadFallback]);

  const onSelectRelease = useCallback((name) => {
    setSelectedRelease(name);
    setSelectedProjectKey('');
    setProjectDetail(null);
    setBootstrap(null);
    setProjectsPage(null);
    setRetroFallback(null);
    setError('');
    setHasFetched(false);
    setFallbackAttemptedForRelease('');
  }, [setSelectedRelease]);

  const selectProject = useCallback((key) => {
    setProjectDetail(null);
    setSelectedProjectKey(key);
  }, []);

  // Called when user presses Fetch.
  const refresh = useCallback(() => {
    setHasFetched(true);
    setFallbackAttemptedForRelease('');
    loadBootstrap();
    loadProjects();
  }, [loadBootstrap, loadProjects]);

  useEffect(() => {
    // Only surface the "not synced" message when there is genuinely nothing to show.
    // If bootstrap data has already loaded (page has content), suppress it — the
    // retrospective endpoint works independently of the release dataset cache.
    if (releaseError === 'not_synced' && !bootstrap) {
      setError(`Release ${selectedRelease || ''} is not synced yet. Run Sync to load per-release data.`);
    } else if (releaseError !== 'not_synced') {
      // Clear a stale not_synced message when the release changes or data arrives.
      setError((prev) => (prev?.includes('not synced') ? '' : prev));
    }
  }, [releaseError, selectedRelease, bootstrap]);

  return useMemo(
    () => ({
      ready,
      versions,
      activeVersions,
      inactiveVersions,
      hasFetched,
      bootstrap,
      projectsPage,
      selectedProjectKey,
      setSelectedProjectKey,
      selectProject,
      projectDetail,
      retroFallback,
      selectedRelease,
      setSelectedRelease: onSelectRelease,
      loading: loadingVersions || loadingBootstrap || loadingProjects || loadingDetail || loadingFallback,
      loadingBootstrap,
      loadingProjects,
      loadingDetail,
      error,
      refresh,
    }),
    [ready, versions, activeVersions, inactiveVersions, hasFetched, bootstrap, projectsPage, selectedProjectKey,
     projectDetail, retroFallback, selectedRelease, onSelectRelease, selectProject,
     loadingVersions, loadingBootstrap, loadingProjects, loadingDetail, loadingFallback, error, refresh]
  );
}
