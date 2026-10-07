/**
 * useSprintPerformance — latest Sprint Performance report HTML + generation job.
 *
 * GET  /api/jira/sprint-performance/reports   list + current job
 * GET  /api/jira/sprint-performance/report    report HTML
 * POST /api/jira/sprint-performance/generate  start a background job
 * GET  /api/jira/sprint-performance/status    job state (polled only while running)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { authenticatedGet, authenticatedPost } from '../utils/api';

const POLL_MS = 5000;
const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export function useSprintPerformance(teamId = 'ndb') {
  const [reports, setReports] = useState([]);
  const [html, setHtml] = useState('');
  const [selected, setSelected] = useState(null);
  const [job, setJob] = useState({ state: 'idle' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const loadReport = useCallback(async (file) => {
    setLoading(true);
    setError(null);
    try {
      const list = await authenticatedGet('/api/jira/sprint-performance/reports', { teamId }, creds());
      const all = list.data.reports || [];
      setReports(all);
      setJob(list.data.job || { state: 'idle' });
      const target = file || all[0]?.file;
      if (!target) {
        setHtml('');
        setSelected(null);
        return;
      }
      const resp = await authenticatedGet('/api/jira/sprint-performance/report', { teamId, file: target }, creds(), { responseType: 'text' });
      setHtml(resp.data);
      setSelected(target);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const generate = useCallback(async () => {
    setError(null);
    try {
      const resp = await authenticatedPost('/api/jira/sprint-performance/generate', { teamId }, creds());
      setJob(resp.data.job);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }, [teamId]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const running = job.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const resp = await authenticatedGet('/api/jira/sprint-performance/status', { teamId }, creds());
        const next = resp.data.job;
        setJob(next);
        if (next.state === 'done') loadReport(next.file);
      } catch (err) {
        setJob({ state: 'error', error: err.message });
      }
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [running, teamId, loadReport]);

  return { reports, html, selected, job, loading, error, loadReport, generate };
}

export default useSprintPerformance;
