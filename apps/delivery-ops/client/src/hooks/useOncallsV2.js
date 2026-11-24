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

export const TIMEFRAMES = ['15d', '1M', '1Q', '2Q', '1Y', '18M', 'Overall'];

export function useOncallsV2(teamId, initialTimeframe = '2Q') {
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [aiConcern, setAiConcern] = useState(null);
  const [aiConcernState, setAiConcernState] = useState('idle'); // idle | loading | done | error
  const [aiConcernError, setAiConcernError] = useState(null);
  const lastConcernAsOfRef = useRef(null);

  const resetAiConcern = useCallback(() => {
    setAiConcernState('idle');
    setAiConcern(null);
    setAiConcernError(null);
    lastConcernAsOfRef.current = null;
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
      const params = { teamId, timeframe };
      let resp;
      if (force) {
        resp = await authenticatedPost('/api/jira/oncalls/v2/refresh', { teamId, timeframe }, creds(), { timeout: 180000 });
      } else {
        resp = await authenticatedGet('/api/jira/oncalls/v2', params, creds(), { timeout: 180000 });
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
  };
}
