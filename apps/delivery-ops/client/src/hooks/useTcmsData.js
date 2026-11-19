import { useState, useCallback } from 'react';
import { authenticatedPost } from '../shared/services/apiService';
import { useTeam } from '../contexts/TeamContext';

/**
 * Hook to fetch TCMS QI + component data for release items.
 * Designed to be called after items load — non-blocking background fetch.
 *
 * Returns a tcmsDataMap: { [key]: { tcmsQI: { master, branch }, tcmsQueryUrl } }
 * Caller merges this onto items by key.
 */
export function useTcmsData() {
  const [tcmsDataMap, setTcmsDataMap] = useState({});
  const [loadingTcms, setLoadingTcms] = useState(false);

  const { selectedTeam, selectedTeamId } = useTeam();
  const tcms = selectedTeam?.tcms;
  const releasePrefixes = selectedTeam?.releasePrefixes;
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  /**
   * Fetch TCMS data for commit items (master + branch QI).
   * @param {string}   fixVersion - e.g. "NDB-2.11"
   * @param {string[]} itemKeys   - commit item keys
   */
  const fetchCommitTcmsData = useCallback(async (fixVersion, itemKeys) => {
    if (!fixVersion || !itemKeys?.length) return;
    setLoadingTcms(true);
    try {
      const res = await authenticatedPost(
        '/api/jira/release-items-tcms',
        { fixVersion, itemKeys, isLongTerm: false, teamId: selectedTeamId, tcms, releasePrefixes },
        { jiraToken, username }
      );
      if (res.data?.success && res.data?.data) {
        setTcmsDataMap(prev => ({ ...prev, ...res.data.data }));
      }
    } catch (err) {
      console.warn('[useTcmsData] Commit TCMS fetch failed:', err?.response?.data || err.message);
    } finally {
      setLoadingTcms(false);
    }
  }, [jiraToken, username, tcms, releasePrefixes, selectedTeamId]);

  /**
   * Fetch TCMS data for long-term funded items (master QI only).
   * @param {string}   fixVersion - e.g. "NDB-2.11"
   * @param {string[]} itemKeys   - long-term item keys
   */
  const fetchLongTermTcmsData = useCallback(async (fixVersion, itemKeys) => {
    if (!fixVersion || !itemKeys?.length) return;
    try {
      const res = await authenticatedPost(
        '/api/jira/release-items-tcms',
        { fixVersion, itemKeys, isLongTerm: true, teamId: selectedTeamId, tcms, releasePrefixes },
        { jiraToken, username }
      );
      if (res.data?.success && res.data?.data) {
        setTcmsDataMap(prev => ({ ...prev, ...res.data.data }));
      }
    } catch (err) {
      console.warn('[useTcmsData] Long-term TCMS fetch failed:', err?.response?.data || err.message);
    }
  }, [jiraToken, username, tcms, releasePrefixes, selectedTeamId]);

  const resetTcmsData = useCallback(() => {
    setTcmsDataMap({});
  }, []);

  return {
    tcmsDataMap,
    loadingTcms,
    fetchCommitTcmsData,
    fetchLongTermTcmsData,
    resetTcmsData
  };
}
