/**
 * useOncallsV2 — timeframe-aware OnCalls dashboard + AI concern.
 * GET /api/jira/oncalls/v2?teamId=&timeframe=
 * POST /api/ai/oncall-concern
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { authenticatedGet, authenticatedPost } from '../shared/services/apiService';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export const TIMEFRAMES = ['7d', '15d', '1M', '1Q', '2Q', '1Y', '18M', 'Overall'];

export function useOncallsV2(teamId, initialTimeframe = '7d') {
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [aiConcern, setAiConcern] = useState(null);
  const [aiConcernState, setAiConcernState] = useState('idle'); // idle | loading | done | error
  const [aiConcernError, setAiConcernError] = useState(null);
  const lastConcernAsOfRef = useRef(null);

  const [aiSlice, setAiSlice] = useState(null);
  const [aiSliceState, setAiSliceState] = useState('idle'); // idle | loading | done | error
  const [aiSliceError, setAiSliceError] = useState(null);
  const [aiSliceView, setAiSliceView] = useState(null);

  const resetAiConcern = useCallback(() => {
    setAiConcernState('idle');
    setAiConcern(null);
    setAiConcernError(null);
    lastConcernAsOfRef.current = null;
  }, []);

  const resetAiSlice = useCallback(() => {
    setAiSliceState('idle');
    setAiSlice(null);
    setAiSliceError(null);
    setAiSliceView(null);
  }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!teamId) {
      setData(null);
      setLoading(false);
      setError(null);
      resetAiConcern();
      return;
    }
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const params = { teamId, timeframe, v2: '1' };
      let resp;
      if (force) {
        resp = await authenticatedPost('/api/jira/oncalls/refresh', { teamId, timeframe, v2: '1' }, creds(), { timeout: 180000 });
      } else {
        resp = await authenticatedGet('/api/jira/oncalls', params, creds(), { timeout: 180000 });
      }
      setData(resp.data);
    } catch (err) {
      setData(null);
      resetAiConcern();
      setError(err.response?.data?.error || err.message || 'Failed to load OnCalls V2 data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teamId, timeframe, resetAiConcern]);

  useEffect(() => {
    resetAiConcern();
    setData(null);
    load({ force: false });
  }, [load, resetAiConcern]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  const generateConcern = useCallback(async (dashboardSnapshot) => {
    if (!teamId) return;
    const snap = dashboardSnapshot || data;
    if (!snap) return;
    setAiConcernState('loading');
    setAiConcernError(null);
    try {
      const resp = await authenticatedPost('/api/ai/oncall-concern', { teamId, timeframe, dashboard: snap }, creds(), { timeout: 180000 });
      setAiConcern(resp.data?.summary || '');
      setAiConcernState('done');
      if (snap?.asOf) lastConcernAsOfRef.current = snap.asOf;
    } catch (err) {
      setAiConcernError(err.response?.data?.error || err.message || 'AI concern failed');
      setAiConcernState('error');
    }
  }, [teamId, timeframe, data]);

  const generateSlice = useCallback(async (view, keys, meta = {}) => {
    if (!teamId || !view) return null;
    const sliceKeys = Array.isArray(keys) ? keys.slice(0, 20) : [];
    const sliceMeta = meta && typeof meta === 'object' ? meta : {};
    setAiSliceView(view);
    setAiSliceState('loading');
    setAiSliceError(null);
    try {
      const resp = await authenticatedPost('/api/ai/oncall-slice', { teamId, timeframe, view, keys: sliceKeys, meta: sliceMeta }, creds(), { timeout: 120000 });
      const summary = resp.data?.summary || '';
      setAiSlice(summary);
      setAiSliceState('done');
      return summary;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'AI slice failed';
      setAiSliceError(msg);
      setAiSliceState('error');
      return null;
    }
  }, [teamId, timeframe]);

  // Auto-generate after metrics load
  useEffect(() => {
    if (!teamId || loading || refreshing || !data?.asOf) return;
    if (lastConcernAsOfRef.current === data.asOf) return;
    generateConcern(data);
  }, [teamId, data?.asOf, data, loading, refreshing, generateConcern]);

  return {
    timeframe,
    setTimeframe,
    data,
    loading,
    refreshing,
    error,
    refresh,
    aiConcern,
    aiConcernState,
    aiConcernError,
    generateConcern: () => generateConcern(data),
    resetAiConcern,
    aiSlice,
    aiSliceState,
    aiSliceError,
    aiSliceView,
    generateSlice,
    resetAiSlice,
  };
}
