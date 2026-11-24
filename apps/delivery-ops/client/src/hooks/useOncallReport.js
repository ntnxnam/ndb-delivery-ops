import { useCallback, useState } from 'react';
import { authenticatedPost, getApiBase } from '../shared/services/apiService';

const API = () => `${getApiBase()}/api/jira/oncalls/report`;

function creds() {
  return {
    jiraToken: localStorage.getItem('jiraToken') || '',
    username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
  };
}

export function useOncallReport({ teamId, timeframe, dashboard, aiConcern }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async ({ previewOnly, to, dashOverride } = {}) => {
    setBusy(true);
    setError('');
    try {
      const body = {
        teamId,
        timeframe,
        to,
        previewOnly: Boolean(previewOnly),
        dashboard: dashOverride || dashboard,
        aiConcern: aiConcern || undefined,
      };
      const resp = await authenticatedPost(API(), body, { ...creds(), ignoreFailureCooldown: true }, { timeout: 180000 });
      if (resp?.data?.success === false) throw new Error(resp.data.error || 'Report failed');
      return resp?.data?.data;
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Report failed';
      setError(msg);
      throw Object.assign(new Error(msg), { cause: e });
    } finally {
      setBusy(false);
    }
  }, [teamId, timeframe, dashboard?.asOf, aiConcern]);

  const preview = useCallback((opts = {}) => run({ ...opts, previewOnly: true }), [run]);
  const send = useCallback((opts = {}) => run({ ...opts, previewOnly: false }), [run]);

  return { busy, error, preview, send, setError };
}
