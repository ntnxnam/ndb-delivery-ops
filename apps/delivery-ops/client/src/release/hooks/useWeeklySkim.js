/**
 * useWeeklySkim — type filter + multi-select + generate.
 * Versions come from SelectedReleaseContext (same as Release Brief).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';
import { generateWeeklySkim } from '../services/weeklySkimService';
import {
  RELEASE_TYPE,
  filterVersionsByType,
} from '../utils/releaseTypeUtils';

export function useWeeklySkim({ productId, jiraToken, username }) {
  const { versions, versionsError, loadingVersions } = useSelectedRelease();
  const [releaseType, setReleaseType] = useState(RELEASE_TYPE.MAJOR_MINOR);
  const [selected, setSelected] = useState([]);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  const filteredVersions = useMemo(
    () => filterVersionsByType(versions || [], releaseType),
    [versions, releaseType]
  );

  // When type changes, pre-select all filtered (skim defaults to “all of this type”).
  useEffect(() => {
    const names = filteredVersions.map((v) => (typeof v === 'string' ? v : v.name));
    setSelected(names);
    setPayload(null);
    setError('');
  }, [filteredVersions]);

  const toggleRelease = useCallback((name) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelected(
      filteredVersions.map((v) => (typeof v === 'string' ? v : v.name))
    );
  }, [filteredVersions]);

  const clearSelected = useCallback(() => setSelected([]), []);

  const generate = useCallback(async () => {
    if (!jiraToken || !selected.length) return;
    setLoading(true);
    setError('');
    // Server runs NAI serially; no streamed progress yet — name the queue so wait feels intentional.
    const queue = selected.join(' → ');
    setProgress(
      `Serial NAI (~15–30s each): ${queue}. Stay on this page…`
    );
    try {
      const data = await generateWeeklySkim({
        productId: productId || 'ndb',
        releases: selected,
        jiraToken,
        username,
      });
      setPayload(data);
      setProgress('');
    } catch (e) {
      const msg =
        e?.response?.data?.error || e?.message || 'Weekly skim generation failed';
      setError(msg);
      setProgress('');
    } finally {
      setLoading(false);
    }
  }, [jiraToken, username, productId, selected]);

  return {
    versions,
    filteredVersions,
    loadingVersions,
    versionsError,
    releaseType,
    setReleaseType,
    selected,
    toggleRelease,
    selectAllFiltered,
    clearSelected,
    payload,
    loading,
    error,
    progress,
    generate,
  };
}
