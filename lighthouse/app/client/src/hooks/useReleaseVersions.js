import { useCallback, useMemo } from 'react';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';


/**
 * Custom hook for managing release versions with team context
 * @returns {object} - { versions, selectedVersion, loadingVersions, showVersionDropdown, defaultVersion, fetchVersions, handleVersionChange, setSelectedVersion }
 */
export function useReleaseVersions() {
  const {
    versions,
    activeVersions,
    inactiveVersions,
    selectedRelease,
    setSelectedRelease,
    fetchVersions: ctxFetchVersions,
    refreshVersions,
    loadingVersions,
    versionsError,
  } = useSelectedRelease();

  // fetchVersions is cache-respecting (no-op if still fresh).
  // refreshVersions force-busts the cache — only for explicit user "refresh" actions.
  const fetchVersions = useCallback(async () => {
    await ctxFetchVersions();
  }, [ctxFetchVersions]);

  const handleVersionChange = useCallback((event) => {
    setSelectedRelease(event.target.value);
  }, [setSelectedRelease]);

  return useMemo(() => ({
    versions,
    activeVersions,
    inactiveVersions,
    selectedVersion: selectedRelease,
    loadingVersions,
    showVersionDropdown: versions.length > 0,
    defaultVersion: '',
    setDefaultVersion: () => {},
    setSelectedVersion: setSelectedRelease,
    fetchVersions,
    refreshVersions,
    handleVersionChange,
    error: versionsError || '',
    setError: () => {},
  }), [
    activeVersions,
    inactiveVersions,
    versions,
    selectedRelease,
    loadingVersions,
    setSelectedRelease,
    fetchVersions,
    refreshVersions,
    handleVersionChange,
    versionsError,
  ]);
}

