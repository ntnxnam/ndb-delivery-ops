import { useCallback, useEffect, useState } from 'react';
import { authenticatedGet, authenticatedPost, getApiBase } from '../utils/api';

const API = () => `${getApiBase()}/api/release-outstanding-work`;

function creds() {
  return {
    jiraToken: localStorage.getItem('jiraToken') || '',
    username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
  };
}

export function useReleaseOutstandingWork({ teamId, release }) {
  const [data, setData] = useState(null);
  const [outstanding, setOutstanding] = useState(null);
  const [loading, setLoading] = useState(false);
  const [outstandingLoading, setOutstandingLoading] = useState(false);
  const [error, setError] = useState('');
  const [outstandingError, setOutstandingError] = useState('');
  const [actionKey, setActionKey] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

  const loadOutstanding = useCallback(async () => {
    if (!teamId || !release) {
      setOutstanding(null);
      return;
    }
    setOutstandingLoading(true);
    setOutstandingError('');
    try {
      const resp = await authenticatedGet(
        `${API()}/outstanding`,
        { teamId, release },
        { ...creds(), ignoreFailureCooldown: true },
        { timeout: 180000 }
      );
      const body = resp?.data;
      if (body?.success === false) throw new Error(body.error || 'Failed to load outstanding');
      setOutstanding(body?.data || null);
    } catch (e) {
      setOutstandingError(e?.response?.data?.error || e.message || 'Failed to load outstanding');
      setOutstanding(null);
    } finally {
      setOutstandingLoading(false);
    }
  }, [teamId, release]);

  const load = useCallback(async () => {
    if (!teamId || !release) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await authenticatedGet(
        `${API()}/workbench`,
        { teamId, release },
        { ...creds(), ignoreFailureCooldown: true },
        { timeout: 180000 }
      );
      const body = resp?.data;
      if (body?.success === false) throw new Error(body.error || 'Failed to load workbench');
      setData(body?.data || null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load workbench');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, release]);

  useEffect(() => {
    load();
    loadOutstanding();
  }, [load, loadOutstanding]);

  const reload = useCallback(async () => {
    await Promise.all([load(), loadOutstanding()]);
  }, [load, loadOutstanding]);

  const previewOutstandingReport = useCallback(
    async ({ to, cc } = {}) => {
      setReportBusy(true);
      setOutstandingError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/outstanding-report`,
          {
            teamId,
            release,
            to,
            cc,
            previewOnly: true,
            outstandingData: outstanding?.release === release ? outstanding : undefined,
          },
          { ...creds(), ignoreFailureCooldown: true },
          { timeout: 180000 }
        );
        if (resp?.data?.success === false) {
          throw new Error(resp.data.error || 'Preview failed');
        }
        return resp?.data?.data;
      } catch (e) {
        setOutstandingError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setReportBusy(false);
      }
    },
    [teamId, release, outstanding]
  );

  const sendOutstandingReport = useCallback(
    async ({ to, cc } = {}) => {
      setReportBusy(true);
      setOutstandingError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/outstanding-report`,
          {
            teamId,
            release,
            to,
            cc,
            previewOnly: false,
            outstandingData: outstanding?.release === release ? outstanding : undefined,
          },
          { ...creds(), ignoreFailureCooldown: true },
          { timeout: 180000 }
        );
        if (resp?.data?.success === false) {
          throw new Error(resp.data.error || 'Send failed');
        }
        return resp?.data?.data;
      } catch (e) {
        setOutstandingError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setReportBusy(false);
      }
    },
    [teamId, release, outstanding]
  );

  const move = useCallback(
    async (issueKey, comment) => {
      setActionKey(`move:${issueKey}`);
      setError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/move`,
          { teamId, release, issueKey, comment: comment || '' },
          creds()
        );
        const body = resp?.data;
        if (body?.success === false) {
          const err = new Error(body.error || 'Move failed');
          err.code = body.code;
          err.target = body.target;
          throw err;
        }
        await load();
        return body?.data;
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setActionKey('');
      }
    },
    [teamId, release, load]
  );

  const defer = useCallback(
    async (issueKey, comment) => {
      setActionKey(`defer:${issueKey}`);
      setError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/defer`,
          { release, issueKey, comment: comment || '' },
          creds()
        );
        if (resp?.data?.success === false) throw new Error(resp.data.error || 'Defer failed');
        await load();
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setActionKey('');
      }
    },
    [release, load]
  );

  const mustFix = useCallback(
    async (issueKey, comment) => {
      setActionKey(`mustfix:${issueKey}`);
      setError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/mustfix`,
          { release, issueKey, comment: comment || '' },
          creds()
        );
        if (resp?.data?.success === false) throw new Error(resp.data.error || 'Must-fix failed');
        await load();
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setActionKey('');
      }
    },
    [release, load]
  );

  const patchLastComment = useCallback((issueKey, lastComment) => {
    if (!lastComment) return;
    setData((prev) => {
      if (!prev) return prev;
      const patch = (rows) =>
        (rows || []).map((r) => (r.key === issueKey ? { ...r, lastComment } : r));
      return {
        ...prev,
        needsJustification: patch(prev.needsJustification),
        candidates: patch(prev.candidates),
        awaitingDeferral: patch(prev.awaitingDeferral),
        mustFix: patch(prev.mustFix),
      };
    });
  }, []);

  const postComment = useCallback(
    async (issueKey, comment) => {
      setActionKey(`comment:${issueKey}`);
      setError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/comment`,
          { release, issueKey, comment: comment || '' },
          creds()
        );
        if (resp?.data?.success === false) throw new Error(resp.data.error || 'Comment failed');
        const result = resp?.data?.data;
        if (result?.lastComment) patchLastComment(issueKey, result.lastComment);
        return result;
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setActionKey('');
      }
    },
    [release, patchLastComment]
  );

  const chaseJustification = useCallback(
    async (issueKey) => {
      setActionKey(`chase:${issueKey}`);
      setError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/chase-justification`,
          { release, issueKey },
          creds()
        );
        if (resp?.data?.success === false) {
          throw new Error(resp.data.error || 'Could not tag for justification');
        }
        // Refresh so last-nudge age updates on the card
        await load();
        return resp?.data?.data;
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setActionKey('');
      }
    },
    [release, load]
  );

  const chaseStatusUpdate = useCallback(
    async (issueKey) => {
      setActionKey(`status:${issueKey}`);
      setError('');
      try {
        const resp = await authenticatedPost(
          `${API()}/chase-status-update`,
          { release, issueKey },
          creds()
        );
        if (resp?.data?.success === false) {
          throw new Error(resp.data.error || 'Could not ask for status update');
        }
        await load();
        return resp?.data?.data;
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
        throw e;
      } finally {
        setActionKey('');
      }
    },
    [release, load]
  );

  return {
    data,
    outstanding,
    loading,
    outstandingLoading,
    error,
    outstandingError,
    setError,
    actionKey,
    reportBusy,
    reload,
    move,
    defer,
    mustFix,
    postComment,
    chaseJustification,
    chaseStatusUpdate,
    previewOutstandingReport,
    sendOutstandingReport,
  };
}
