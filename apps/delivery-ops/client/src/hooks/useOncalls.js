/**
 * useOncalls — OnCalls dashboard metrics + AI briefing (auto after metrics load).
 *
 * GET  /api/jira/oncalls?teamId=
 * POST /api/jira/oncalls/refresh
 * POST /api/ai/oncall-summary
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { authenticatedGet, authenticatedPost } from '../shared/services/apiService';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

/**
 * @param {string} teamId
 * @param {{ skipAutoBriefing?: boolean }} [options] - when true (exec audience),
 *   skip legacy auto oncall-summary so only "What ails the team" auto-loads
 */
export function useOncalls(teamId, options = {}) {
  const skipAutoBriefing = Boolean(options.skipAutoBriefing);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [aiState, setAiState] = useState('idle'); // idle | loading | done | error
  const [aiSummary, setAiSummary] = useState(null);
  const [aiIntelligence, setAiIntelligence] = useState(null);
  const [aiError, setAiError] = useState(null);
  const lastBriefedAsOfRef = useRef(null);

  const resetAi = useCallback(() => {
    setAiState('idle');
    setAiSummary(null);
    setAiIntelligence(null);
    setAiError(null);
    lastBriefedAsOfRef.current = null;
  }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!teamId) {
      setData(null);
      setLoading(false);
      setError(null);
      resetAi();
      return;
    }
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      if (force) {
        const resp = await authenticatedPost(
          '/api/jira/oncalls/refresh',
          { teamId },
          creds(),
          { timeout: 180000 }
        );
        setData(resp.data);
      } else {
        const resp = await authenticatedGet(
          '/api/jira/oncalls',
          { teamId },
          creds(),
          { timeout: 180000 }
        );
        setData(resp.data);
      }
    } catch (err) {
      setData(null);
      resetAi();
      setError(err.response?.data?.error || err.message || 'Failed to load OnCalls data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teamId, resetAi]);

  useEffect(() => {
    resetAi();
    setData(null);
    load({ force: false });
  }, [load, resetAi]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  const generateBriefing = useCallback(async (dashboardSnapshot) => {
    if (!teamId) return;
    const snap = dashboardSnapshot || null;
    setAiState('loading');
    setAiError(null);
    try {
      const body = { teamId };
      if (snap?.asOf) body.dashboard = snap;
      const resp = await authenticatedPost(
        '/api/ai/oncall-summary',
        body,
        creds(),
        { timeout: 300000 }
      );
      setAiSummary(resp.data?.summary || '');
      setAiIntelligence(resp.data?.intelligence || null);
      setAiState('done');
      if (snap?.asOf) lastBriefedAsOfRef.current = snap.asOf;
    } catch (err) {
      setAiError(err.response?.data?.error || err.message || 'AI briefing failed');
      setAiState('error');
    }
  }, [teamId]);

  // Auto-generate after each successful metrics load (stamp only on AI success).
  // Skip when exec audience uses the page-briefing band instead (one succinct story).
  useEffect(() => {
    if (skipAutoBriefing) return;
    if (!teamId || loading || refreshing || !data?.asOf) return;
    if (lastBriefedAsOfRef.current === data.asOf) return;
    generateBriefing(data);
  }, [teamId, data?.asOf, data, loading, refreshing, generateBriefing, skipAutoBriefing]);

  return {
    data,
    loading,
    refreshing,
    error,
    refresh,
    aiState,
    aiSummary,
    aiIntelligence,
    aiError,
    generateBriefing: () => generateBriefing(data),
  };
}
