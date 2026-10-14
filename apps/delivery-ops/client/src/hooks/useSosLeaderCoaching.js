/**
 * useSosLeaderCoaching — per-leader Asks via POST /api/ai/sos-leader-coaching.
 * Store keyed by scopeKey (leader id / unmapped).
 */

import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';

export function useSosLeaderCoaching() {
  const [asksByLeader, setAsksByLeader] = useState({});
  const [generatingLeader, setGeneratingLeader] = useState(null);
  const [errorByLeader, setErrorByLeader] = useState({});

  const generateForLeader = useCallback(async ({
    scopeKey,
    leaderId,
    leaderName,
    role,
    items,
    gateDataByRelease = {},
    breakdownDataMap = {},
    checkpointHistory = {},
    expectedManagerNames = [],
  }) => {
    const key = scopeKey || leaderId || leaderName;
    if (!key) return null;

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setGeneratingLeader(key);
    setErrorByLeader((prev) => ({ ...prev, [key]: null }));
    setAsksByLeader((prev) => ({
      ...prev,
      [key]: { state: 'loading', asks: null, text: null, source: null, generatedAt: null },
    }));

    try {
      const resp = await authenticatedPost(
        '/api/ai/sos-leader-coaching',
        {
          leaderId: leaderId || key,
          leaderName,
          role,
          items: items || [],
          gateDataByRelease,
          breakdownDataMap,
          checkpointHistory,
          expectedManagerNames,
        },
        { jiraToken, username }
      );
      const data = resp.data || {};
      const entry = {
        state: 'done',
        asks: data.asks || [],
        text: data.text || '',
        source: data.source || 'ai',
        generatedAt: data.generatedAt || new Date().toISOString(),
        packet: data.packet || null,
      };
      setAsksByLeader((prev) => ({ ...prev, [key]: entry }));
      return entry;
    } catch (err) {
      const msg = getUserFacingMessage(err, {
        context: 'sos-leader-coaching',
        fallback: err.response?.data?.error || err.message || 'Coaching generation failed',
      });
      setErrorByLeader((prev) => ({ ...prev, [key]: msg }));
      setAsksByLeader((prev) => ({
        ...prev,
        [key]: { state: 'error', asks: null, text: null, source: null, generatedAt: null, error: msg },
      }));
      return null;
    } finally {
      setGeneratingLeader(null);
    }
  }, []);

  const clearLeader = useCallback((scopeKey) => {
    setAsksByLeader((prev) => {
      const next = { ...prev };
      delete next[scopeKey];
      return next;
    });
    setErrorByLeader((prev) => {
      const next = { ...prev };
      delete next[scopeKey];
      return next;
    });
  }, []);

  return {
    asksByLeader,
    generatingLeader,
    errorByLeader,
    generateForLeader,
    clearLeader,
  };
}
