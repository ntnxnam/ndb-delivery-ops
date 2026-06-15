import { useCallback, useMemo } from 'react';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';

/**
 * Custom hook for managing release versions with team context
 * @returns {object} - { versions, selectedVersion, loadingVersions, showVersionDropdown, defaultVersion, fetchVersions, handleVersionChange, setSelectedVersion }
 */
export function useReleaseVersions() {
  const {
    versions,
    selectedRelease,
    setSelectedRelease,
    refreshVersions,
    loadingVersions,
    versionsError,
  } = useSelectedRelease();

  const fetchVersions = useCallback(async () => {
    await refreshVersions();
  }, [refreshVersions]);

  const handleVersionChange = useCallback((event) => {
    setSelectedRelease(event.target.value);
  }, [setSelectedRelease]);

  return useMemo(() => ({
    versions,
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

