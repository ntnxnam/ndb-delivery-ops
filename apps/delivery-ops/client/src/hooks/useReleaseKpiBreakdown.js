/**
 * useReleaseKpiBreakdown — lazily fetch KPI resolution breakdown for a single
 * release version.
 *
 * Calls POST /api/jira/release-kpi-breakdown-batch  { releaseVersion, teamId }
 * Returns { kpiId: { name, total, done, open, links } | { error } }
 *
 * Fetch is triggered explicitly via `load()` — the caller (ReleaseSection) can
 * kick it off on mount or on user demand.
 */

import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';

export function useReleaseKpiBreakdown() {
  const [dataByRelease, setDataByRelease] = useState({});
  const [loadingRelease, setLoadingRelease] = useState({});
  const [errorByRelease, setErrorByRelease] = useState({});

  const load = useCallback(async (releaseVersion, teamId) => {
    if (!releaseVersion || !teamId) return;
    // Skip if already loaded or in-flight
    if (dataByRelease[releaseVersion] || loadingRelease[releaseVersion]) return;

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setLoadingRelease((prev) => ({ ...prev, [releaseVersion]: true }));
    setErrorByRelease((prev) => ({ ...prev, [releaseVersion]: null }));

    try {
      const resp = await authenticatedPost(
        '/api/jira/release-kpi-breakdown-batch',
        { releaseVersion, teamId },
        { jiraToken, username }
      );
      const results = resp.data?.results || {};
      setDataByRelease((prev) => ({ ...prev, [releaseVersion]: results }));
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'KPI load failed';
      setErrorByRelease((prev) => ({ ...prev, [releaseVersion]: msg }));
    } finally {
      setLoadingRelease((prev) => ({ ...prev, [releaseVersion]: false }));
    }
  }, [dataByRelease, loadingRelease]);

  return { dataByRelease, loadingRelease, errorByRelease, load };
}
