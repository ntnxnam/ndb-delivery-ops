import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchFeatureDashboard,
  listReleaseFeatures,
  reparentFeatureTicket,
} from '../services/featureDashboardService';

export function useFeatureDashboard({
  release,
  featureKey,
  jiraToken,
  username,
}) {
  const [features, setFeatures] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [savingReparent, setSavingReparent] = useState(false);
  const [error, setError] = useState('');

  const loadFeatures = useCallback(async () => {
    if (!release || !jiraToken) {
      setFeatures([]);
      return;
    }
    setLoadingFeatures(true);
    setError('');
    try {
      const data = await listReleaseFeatures({ release, jiraToken, username });
      setFeatures(data.features || []);
    } catch (e) {
      setError(e.message || 'Failed to load features');
      setFeatures([]);
    } finally {
      setLoadingFeatures(false);
    }
  }, [release, jiraToken, username]);

  const loadDashboard = useCallback(async () => {
    if (!release || !featureKey || !jiraToken) {
      setDashboard(null);
      return;
    }
    setLoadingDashboard(true);
    setError('');
    try {
      const data = await fetchFeatureDashboard({
        release,
        featureKey,
        jiraToken,
        username,
      });
      setDashboard(data);
    } catch (e) {
      setError(e.message || 'Failed to load feature dashboard');
      setDashboard(null);
    } finally {
      setLoadingDashboard(false);
    }
  }, [release, featureKey, jiraToken, username]);

  const reparentTicket = useCallback(
    async ({ ticketKey, newParent, reason }) => {
      setSavingReparent(true);
      setError('');
      try {
        await reparentFeatureTicket({
          ticketKey,
          newParent,
          reason,
          jiraToken,
          username,
        });
        await loadDashboard();
      } catch (e) {
        setError(e.message || 'Failed to re-parent ticket');
      } finally {
        setSavingReparent(false);
      }
    },
    [jiraToken, username, loadDashboard]
  );

  useEffect(() => {
    loadFeatures();
  }, [loadFeatures]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return useMemo(
    () => ({
      features,
      dashboard,
      loadingFeatures,
      loadingDashboard,
      savingReparent,
      error,
      reloadDashboard: loadDashboard,
      reparentTicket,
    }),
    [
      features,
      dashboard,
      loadingFeatures,
      loadingDashboard,
      savingReparent,
      error,
      loadDashboard,
      reparentTicket,
    ]
  );
}
