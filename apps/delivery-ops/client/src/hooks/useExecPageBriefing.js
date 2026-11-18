/**
 * useExecPageBriefing — auto-fetch "What ails the team" for exec audience.
 *
 * POST /api/ai/page-briefing
 * Only runs when enabled (caller gates on isExecAudience).
 *
 * Pass a stable `snapshotKey` (not the snapshot object) in the effect deps so
 * parent re-renders do not storm NAI.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { authenticatedPost } from '../shared/services/apiService';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

/**
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {'release'|'oncall'|'kpi'|'feature'} opts.surface
 * @param {string} [opts.version]
 * @param {string} [opts.teamId]
 * @param {string} [opts.featureKey]
 * @param {object|null} [opts.snapshot]
 * @param {string} [opts.snapshotKey] - stable key for kpi/feature/oncall snapshot identity
 * @param {boolean} [opts.ready=true]
 */
export function useExecPageBriefing({
  enabled = false,
  surface,
  version,
  teamId,
  featureKey,
  snapshot = null,
  snapshotKey = '',
  ready = true,
} = {}) {
  const [state, setState] = useState('idle');
  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState(null);
  const [intelligence, setIntelligence] = useState(null);
  const [facets, setFacets] = useState(null);
  const [error, setError] = useState(null);
  const lastKeyRef = useRef('');
  const stateRef = useRef('idle');
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  stateRef.current = state;

  const reset = useCallback(() => {
    setState('idle');
    setSummary(null);
    setMeta(null);
    setIntelligence(null);
    setFacets(null);
    setError(null);
    lastKeyRef.current = '';
  }, []);

  const fetchBriefing = useCallback(async () => {
    if (!enabled || !surface || !ready) return;

    const snap = snapshotRef.current;
    // oncall: pass dashboard snapshot so AI tiles = on-screen asOf (same as kpi/feature)
    const needsSnapshot = surface === 'kpi' || surface === 'feature' || surface === 'oncall';
    if (needsSnapshot && !snap) return;
    if (surface === 'release' && !version) return;
    if ((surface === 'oncall' || surface === 'kpi') && !teamId) return;
    if (surface === 'feature' && !featureKey && !snap?.key) return;

    const key = [
      surface,
      version || '',
      teamId || '',
      featureKey || '',
      snapshotKey || '',
    ].join('|');
    // Only skip duplicate in-flight/success keys — errors must allow Retry
    if (key === lastKeyRef.current && stateRef.current !== 'error') return;

    setState('loading');
    setError(null);
    try {
      const body = {
        surface,
        ...(version ? { version } : {}),
        ...(teamId ? { teamId } : {}),
        ...(featureKey ? { featureKey } : {}),
        ...(needsSnapshot ? { snapshot: snap } : {}),
      };
      const resp = await authenticatedPost('/api/ai/page-briefing', body, creds(), {
        timeout: 180000,
      });
      lastKeyRef.current = key;
      setSummary(resp.data?.summary || null);
      setMeta(resp.data?.meta || null);
      setIntelligence(resp.data?.intelligence || null);
      setFacets(resp.data?.facets || null);
      setState('done');
    } catch (err) {
      lastKeyRef.current = ''; // allow Retry with same key
      setSummary(null);
      setMeta(null);
      setIntelligence(null);
      setFacets(null);
      setError(err.response?.data?.error || err.message || 'Page briefing failed');
      setState('error');
    }
  }, [enabled, surface, version, teamId, featureKey, snapshotKey, ready]);

  useEffect(() => {
    if (!enabled) {
      reset();
      return undefined;
    }
    fetchBriefing();
    return undefined;
  }, [enabled, fetchBriefing, reset]);

  return {
    state,
    summary,
    meta,
    intelligence,
    facets,
    error,
    refresh: fetchBriefing,
    reset,
  };
}

export default useExecPageBriefing;
