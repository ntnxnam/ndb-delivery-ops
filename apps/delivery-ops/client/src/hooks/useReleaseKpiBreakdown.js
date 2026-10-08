/**
 * useReleaseKpiBreakdown — lazily fetch KPI resolution breakdown for a release.
 *
 * Calls POST /api/jira/release-kpi-breakdown-batch
 *   { releaseVersion, teamId, jqlExtra? }
 *
 * Cache key is `${releaseVersion}` or `${releaseVersion}::${scopeKey}` when
 * a scopeKey / jqlExtra is provided (leader-scoped SoS).
 */

import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';

function cacheKey(releaseVersion, scopeKey) {
  if (scopeKey) return `${releaseVersion}::${scopeKey}`;
  return releaseVersion;
}

export function useReleaseKpiBreakdown() {
  const [dataByRelease, setDataByRelease] = useState({});
  const [loadingRelease, setLoadingRelease] = useState({});
  const [errorByRelease, setErrorByRelease] = useState({});

  const load = useCallback(async (releaseVersion, teamId, opts = {}) => {
    if (!releaseVersion || !teamId) return;
    const { jqlExtra = null, scopeKey = null } = opts;
    const key = cacheKey(releaseVersion, scopeKey);

    // Skip if already loaded or in-flight
    if (dataByRelease[key] || loadingRelease[key]) return;

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setLoadingRelease((prev) => ({ ...prev, [key]: true }));
    setErrorByRelease((prev) => ({ ...prev, [key]: null }));

    try {
      const body = { releaseVersion, teamId };
      if (jqlExtra) body.jqlExtra = jqlExtra;
      const resp = await authenticatedPost(
        '/api/jira/release-kpi-breakdown-batch',
        body,
        { jiraToken, username }
      );
      const results = resp.data?.results || {};
      setDataByRelease((prev) => ({ ...prev, [key]: results }));
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'KPI load failed';
      setErrorByRelease((prev) => ({ ...prev, [key]: msg }));
    } finally {
      setLoadingRelease((prev) => ({ ...prev, [key]: false }));
    }
  }, [dataByRelease, loadingRelease]);

  return { dataByRelease, loadingRelease, errorByRelease, load };
}
