/**
 * Sprint Report page: past sprint report, current sprint report, or trends by team.
 * Team from header; base query from config; user selects sprint(s) and runs report.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line
} from 'recharts';
import { formatters } from '../shared/utils/formatters';
import { useTeam } from '../contexts/TeamContext';
import { authenticatedPost, authenticatedGet, getApiBase, getAuthHeaders } from '../utils/api';
import { useTeams } from '../hooks/useTeams';
import { useTeamDataset } from '../hooks/useTeamDataset';
import { derivePastSprintReportFromBundle } from '../release/utils/bundleUtils';
import './ReleaseVersionTab.css';

const API_BASE = getApiBase();

const MODES = {
  PAST: 'past',
  CURRENT: 'current',
  TRENDS: 'trends'
};

/** Trends by team are WIP — keep inactive in UI. Past sprint report is now active. */
const INACTIVE_MODES = [MODES.TRENDS];

function countWorkingDays(start, end) {
  let count = 0;
  const cur = new Date(start);
  const endDate = new Date(end);
  while (cur <= endDate) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Nutanix fiscal: Q1 starts 01-Aug. Returns { startDate, endDate } as YYYY-MM-DD. */
function getNutanixQuarterRange(fiscalYear, quarter) {
  const y = Number(fiscalYear);
  if (Number.isNaN(y) || !quarter) return null;
  switch (quarter) {
    case 'Q1': return { startDate: `${y}-08-01`, endDate: `${y}-10-31` };
    case 'Q2': return { startDate: `${y}-11-01`, endDate: `${y + 1}-01-31` };
    case 'Q3': return { startDate: `${y + 1}-02-01`, endDate: `${y + 1}-04-30` };
    case 'Q4': return { startDate: `${y + 1}-05-01`, endDate: `${y + 1}-07-31` };
    default: return null;
  }
}

export default function SprintReportPage() {
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  const { selectedTeamId: teamId, hasTeamSelected, isTransitioning, selectedTeam } = useTeam();
  const { bundle, syncMeta } = useTeamDataset();

  const [teams, setTeams] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [mode, setMode] = useState(MODES.CURRENT);
  const [selectedSprintId, setSelectedSprintId] = useState('');
  const [selectedSprintIds, setSelectedSprintIds] = useState([]);
  const [reportResult, setReportResult] = useState(null);
  const [trendsResult, setTrendsResult] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [spFields, setSpFields] = useState(null);
  const [loadingSpFields, setLoadingSpFields] = useState(false);
  const chartsRowRef = useRef(null);
  // Past sprint report: period and components
  const [periodType, setPeriodType] = useState('custom');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [fiscalQuarter, setFiscalQuarter] = useState('');
  const [components, setComponents] = useState([]);
  const [selectedComponentNames, setSelectedComponentNames] = useState([]);
  const [pastReportResult, setPastReportResult] = useState(null);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [loadingPastReport, setLoadingPastReport] = useState(false);
  const [pastValidationError, setPastValidationError] = useState(null);
  const [refreshingLive, setRefreshingLive] = useState(false);

  const team = teams.find((t) => t.id === teamId) || null;
  const baseFilter = team?.baseFilter || '';

  const { teams: fetchedTeams } = useTeams();

  useEffect(() => {
    if (fetchedTeams.length) setTeams(fetchedTeams);
  }, [fetchedTeams]);

  // The team context is now handled by TeamProvider with automatic cleanup


  /**
   * Fetch sprints for the current team. Only used when mode is CURRENT or TRENDS (sprint dropdown / trend picker).
   * - Current: POST /api/jira/sprints with { teamId, state: 'active' } → one small page from Jira.
   * - Past: we do NOT call this; Past report uses date range and POST /api/jira/sprint-report-by-range (which fetches closed sprints server-side). Calling with no state would request ALL sprints (many pages) and often hit the 45s client timeout.
   */
  const fetchSprints = useCallback(async () => {
    if (!teamId || !jiraToken) {
      setSprints([]);
      return;
    }
    setLoadingSprints(true);
    setError(null);
    try {
      const body = { teamId };
      if (mode === MODES.CURRENT) body.state = 'active';
      if (mode === MODES.TRENDS) body.state = 'closed'; // trends use closed sprints; avoid fetching all
      const res = await authenticatedPost(
        `${API_BASE}/api/jira/sprints`,
        body,
        { jiraToken, username }
      );
      if (res.data && res.data.success && Array.isArray(res.data.sprints)) {
        setSprints(res.data.sprints);
      } else {
        setSprints([]);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load sprints');
      setSprints([]);
    } finally {
      setLoadingSprints(false);
    }
  }, [teamId, jiraToken, username, mode]);

  useEffect(() => {
    if (!teamId) {
      setSprints([]);
      return;
    }
    if (mode === MODES.PAST) {
      setSprints([]);
      return;
    }
    fetchSprints();
  }, [teamId, mode, fetchSprints]);

  const runReport = useCallback(async () => {
    if (!teamId || !selectedSprintId || !jiraToken) return;
    setLoadingReport(true);
    setError(null);
    setReportResult(null);
    try {
      const res = await authenticatedPost(
        `${API_BASE}/api/jira/sprint-report`,
        { teamId, sprintId: Number(selectedSprintId) },
        { jiraToken, username }
      );
      if (res.data && res.data.success) {
        setReportResult(res.data);
      } else {
        setError(res.data?.error || 'Failed to load report');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load report');
    } finally {
      setLoadingReport(false);
    }
  }, [teamId, selectedSprintId, jiraToken, username]);

  const runTrends = useCallback(async () => {
    const ids = selectedSprintIds.length > 0 ? selectedSprintIds : sprints.slice(0, 10).map((s) => s.id);
    if (!teamId || ids.length === 0 || !jiraToken) return;
    setLoadingTrends(true);
    setError(null);
    setTrendsResult(null);
    try {
      const res = await authenticatedPost(
        `${API_BASE}/api/jira/sprint-report-trends`,
        { teamId, sprintIds: ids },
        { jiraToken, username }
      );
      if (res.data && res.data.success) {
        setTrendsResult(res.data);
      } else {
        setError(res.data?.error || 'Failed to load trends');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load trends');
    } finally {
      setLoadingTrends(false);
    }
  }, [teamId, selectedSprintIds, sprints, jiraToken, username]);

  const toggleSprintForTrends = (id) => {
    setSelectedSprintIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return next;
    });
  };

  const fetchProjectComponents = useCallback(async () => {
    if (!teamId || !jiraToken) {
      setComponents([]);
      return;
    }
    setLoadingComponents(true);
    try {
      const res = await authenticatedGet(
        `${API_BASE}/api/jira/project-components`,
        { teamId },
        { jiraToken, username }
      );
      if (res.data?.success && Array.isArray(res.data.components)) {
        setComponents(res.data.components);
      } else {
        setComponents([]);
      }
    } catch (err) {
      console.error('Failed to load components:', err);
      setComponents([]);
    } finally {
      setLoadingComponents(false);
    }
  }, [teamId, jiraToken, username]);

  useEffect(() => {
    if (mode === MODES.PAST && teamId) {
      fetchProjectComponents();
    } else {
      setComponents([]);
    }
  }, [mode, teamId, fetchProjectComponents]);

  const runPastReport = useCallback(async () => {
    setPastValidationError(null);
    let from = startDate;
    let to = endDate;
    if (periodType === 'quarter') {
      const range = getNutanixQuarterRange(fiscalYear, fiscalQuarter);
      if (!range) {
        setPastValidationError('Select year and quarter.');
        return;
      }
      from = range.startDate;
      to = range.endDate;
    } else {
      if (!from || !to) {
        setPastValidationError('Select start and end date.');
        return;
      }
      if (new Date(from) > new Date(to)) {
        setPastValidationError('Start date must be before or equal to end date.');
        return;
      }
    }

    // Bundle-first: derive past sprint report from synced data (instant, no loading state)
    const compNames = selectedComponentNames.length > 0 ? selectedComponentNames : undefined;
    const bundleDerived = derivePastSprintReportFromBundle(bundle, from, to, compNames);
    if (bundleDerived) {
      setPastReportResult(bundleDerived);
      setError(null);
      return;
    }

    // Original fallback — unchanged:
    if (!teamId || !jiraToken) return;
    setLoadingPastReport(true);
    setError(null);
    setPastReportResult(null);
    try {
      const res = await authenticatedPost(
        `${API_BASE}/api/jira/sprint-report-by-range`,
        { teamId, startDate: from, endDate: to, componentNames: selectedComponentNames.length > 0 ? selectedComponentNames : undefined },
        { jiraToken, username }
      );
      if (res.data && res.data.success) {
        setPastReportResult(res.data);
      } else {
        setError(res.data?.error || 'Failed to load past report');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load past report');
    } finally {
      setLoadingPastReport(false);
    }
  }, [teamId, jiraToken, username, periodType, startDate, endDate, fiscalYear, fiscalQuarter, selectedComponentNames, bundle]);

  const toggleComponent = (name) => {
    setSelectedComponentNames((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : (prev.length >= 5 ? prev : [...prev, name])
    );
  };

  const discoverSpFields = useCallback(async () => {
    setLoadingSpFields(true);
    setSpFields(null);
    try {
      const res = await authenticatedGet(
        `${API_BASE}/api/jira/fields`,
        { search: 'story' },
        { jiraToken, username }
      );
      if (res.data?.success) setSpFields(res.data.fields || []);
      else setSpFields([]);
    } catch {
      setSpFields([]);
    } finally {
      setLoadingSpFields(false);
    }
  }, [jiraToken, username]);

  const escapeHtml = (v) => {
    const s = String(v ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  const getSprintReportCsvText = useCallback((result) => {
    if (!result) return '';
    const escape = (v) => {
      const s = String(v ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const issues = result.issues || [];
    const byStatus = {};
    const byStatusPts = {};
    let totalPts = 0;
    issues.forEach((iss) => {
      const s = iss.status || 'Unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
      const pts = typeof iss.storyPoints === 'number' && !Number.isNaN(iss.storyPoints) ? iss.storyPoints : 0;
      byStatusPts[s] = (byStatusPts[s] || 0) + pts;
      totalPts += pts;
    });
    const m = result.metrics || {};
    const lines = [];
    lines.push('Sprint Report', result.sprint?.name || result.sprint?.id || '', '');
    lines.push('Scope change,Count');
    lines.push('Added after sprint started,' + (m.addedAfterStart ?? 0));
    lines.push('Removed from sprint,' + (m.removedFromSprint ?? 0));
    lines.push('');
    lines.push('Work in sprint (by status),Count,Story Points');
    Object.entries(byStatus)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => lines.push(escape(status) + ',' + count + ',' + (byStatusPts[status] || 0)));
    lines.push('Total in sprint,' + issues.length + ',' + totalPts);
    lines.push('');
    lines.push('Key,Summary,Type,Priority,Assignee,Status,Resolution,Story Points,Classification');
    issues.forEach((iss) => {
      lines.push([escape(iss.key), escape(iss.summary), escape(iss.issuetype), escape(iss.priority), escape(iss.assignee), escape(iss.status), escape(iss.resolution ?? ''), iss.storyPoints ?? '', escape(iss.classification)].join(','));
    });
    return lines.join('\r\n');
  }, []);

  const getSprintReportHtml = useCallback((result) => {
    if (!result) return '';
    const m = result.metrics || {};
    const sprint = result.sprint || {};
    const start = sprint.startDate ? new Date(sprint.startDate) : null;
    const end = sprint.endDate ? new Date(sprint.endDate) : null;
    const now = new Date();
    let timeElapsedPct = 0;
    let daysLeft = 0;
    let totalWorkingDays = 1;
    let elapsedWorkingDays = 0;
    let closedPct = m.completionRate ?? 0;
    let nearCompPct = 0;
    let closedPtsPct = null;
    let nearCompPtsPct = null;
    let opinionLabel = 'On track';
    let opinionColor = '#28a745';
    const issuesForProgress = result.issues || [];
    const totalIssues = issuesForProgress.length;
    if (totalIssues > 0) {
      const closed = issuesForProgress.filter((i) => i.classification === 'completedInSprint');
      const nearComp = issuesForProgress.filter((i) => i.classification === 'pendingQA');
      closedPct = Math.round((closed.length / totalIssues) * 100);
      nearCompPct = Math.round((nearComp.length / totalIssues) * 100);
      const totalPts = issuesForProgress.reduce((s, i) => s + (i.storyPoints || 0), 0);
      if (totalPts > 0) {
        const closedPts = closed.reduce((s, i) => s + (i.storyPoints || 0), 0);
        const nearCompPts = nearComp.reduce((s, i) => s + (i.storyPoints || 0), 0);
        closedPtsPct = Math.round((closedPts / totalPts) * 100);
        nearCompPtsPct = Math.round((nearCompPts / totalPts) * 100);
      }
    }
    if (start && end) {
      totalWorkingDays = Math.max(1, countWorkingDays(start, end));
      elapsedWorkingDays = Math.min(totalWorkingDays, countWorkingDays(start, now));
      daysLeft = Math.max(0, totalWorkingDays - elapsedWorkingDays);
      timeElapsedPct = Math.round((elapsedWorkingDays / totalWorkingDays) * 100);
      const gap = timeElapsedPct - closedPct;
      if (gap <= 0) { opinionLabel = 'On track'; opinionColor = '#28a745'; }
      else if (gap <= 15) { opinionLabel = 'Slightly behind'; opinionColor = '#e6a817'; }
      else if (gap <= 30) { opinionLabel = 'At risk'; opinionColor = '#fd7e14'; }
      else { opinionLabel = 'Critical'; opinionColor = '#dc3545'; }
    }
    const scopePct = m.scopeCreepRate ?? 0;
    const isStale = sprint.state === 'active' && sprint.endDate && new Date(sprint.endDate) < now;
    const sprintName = escapeHtml(sprint.name || `Sprint ${sprint.id || ''}`);
    const startStr = start ? (formatters.date(start) || '') : '';
    const endStr = end ? (formatters.date(end) || '') : '';

    let html = '<div style="font-family: Segoe UI, sans-serif; font-size: 14px; max-width: 720px;">';
    html += `<h3 style="margin: 0 0 4px 0; font-size: 18px;">${sprintName}</h3>`;
    if (startStr && endStr) html += `<p style="margin: 0 0 8px 0; color: #6c757d; font-size: 13px;">${startStr} – ${endStr}</p>`;
    if (sprint.state) html += `<span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: ${sprint.state === 'active' ? '#d4edda' : '#e2e3e5'}; color: #155724;">${escapeHtml(sprint.state.toUpperCase())}</span>`;

    if (isStale) {
      html += '<div style="margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: #fff3cd; border: 1px solid #ffc107; color: #856404; font-size: 13px;">Stale sprint — End date has passed but this sprint is still active in Jira. Consider closing it.</div>';
    }

    if (start && end) {
      html += '<div style="margin: 16px 0; padding: 12px; border: 1px solid #dee2e6; border-radius: 8px; background: #f8f9fa;">';
      html += '<div style="font-weight: 600; margin-bottom: 8px; font-size: 13px;">Sprint Progress</div>';
      html += `<div style="margin-bottom: 6px;"><div style="font-size: 12px; color: #495057;">Time elapsed — Day ${elapsedWorkingDays} of ${totalWorkingDays} (${daysLeft} working days left) ${timeElapsedPct}%</div>`;
      html += '<div style="background: #dee2e6; border-radius: 4px; height: 10px;"><div style="width: ' + timeElapsedPct + '%; background: #6c757d; height: 10px; border-radius: 4px;"></div></div></div>';
      html += `<div style="margin-bottom: 6px;"><div style="font-size: 12px; color: #495057;">Completion (by issue count) — Closed ${closedPct}% · Near completion ${nearCompPct}%</div>`;
      html += '<div style="background: #dee2e6; border-radius: 4px; height: 10px; display: flex;"><div style="width: ' + closedPct + '%; background: #28a745; height: 10px;"></div><div style="width: ' + nearCompPct + '%; background: #e6a817; height: 10px;"></div></div></div>';
      if (closedPtsPct != null) {
        html += `<div style="margin-bottom: 8px;"><div style="font-size: 12px; color: #495057;">Completion (story points) — Closed ${closedPtsPct}% · Near completion ${nearCompPtsPct}%</div>`;
        html += '<div style="background: #dee2e6; border-radius: 4px; height: 10px; display: flex;"><div style="width: ' + closedPtsPct + '%; background: #28a745; height: 10px;"></div><div style="width: ' + nearCompPtsPct + '%; background: #e6a817; height: 10px;"></div></div></div>';
      }
      html += `<div style="font-size: 13px; font-weight: 600; color: ${opinionColor};">${escapeHtml(opinionLabel)}</div></div>`;
    }

    html += `<p style="margin: 12px 0; font-size: 13px; color: #495057;"><strong>${timeElapsedPct}%</strong> Time elapsed (working days) · <strong>${closedPct}%</strong> Closed · <strong style="color: ${scopePct > 20 ? '#dc3545' : 'inherit'}">${scopePct}%</strong> Scope change</p>`;

    const issuesForHtml = result.issues || [];
    const byStatusHtml = {};
    const byStatusHtmlPts = {};
    let totalHtmlPts = 0;
    issuesForHtml.forEach((iss) => {
      const s = iss.status || 'Unknown';
      byStatusHtml[s] = (byStatusHtml[s] || 0) + 1;
      const pts = typeof iss.storyPoints === 'number' && !Number.isNaN(iss.storyPoints) ? iss.storyPoints : 0;
      byStatusHtmlPts[s] = (byStatusHtmlPts[s] || 0) + pts;
      totalHtmlPts += pts;
    });
    html += '<div style="margin-bottom: 12px; font-weight: 600; font-size: 13px;">Scope change</div>';
    html += '<table style="border-collapse: collapse; margin-bottom: 16px;" cellpadding="6" cellspacing="0"><tbody>';
    html += `<tr><td style="border: 1px solid #dee2e6; font-weight: 600;">Added after start</td><td style="border: 1px solid #dee2e6;">${Number(m.addedAfterStart ?? 0)}</td></tr>`;
    html += `<tr><td style="border: 1px solid #dee2e6; font-weight: 600;">Removed from sprint</td><td style="border: 1px solid #dee2e6;">${Number(m.removedFromSprint ?? 0)}</td></tr>`;
    html += '</tbody></table>';
    html += '<div style="margin-bottom: 12px; font-weight: 600; font-size: 13px;">Work in sprint (by status)</div>';
    html += '<table style="border-collapse: collapse; margin-bottom: 16px;" cellpadding="6" cellspacing="0">';
    html += '<thead><tr style="background: #f8f9fa;"><th style="border: 1px solid #dee2e6; text-align: left;">Status</th><th style="border: 1px solid #dee2e6; text-align: right;">Count</th><th style="border: 1px solid #dee2e6; text-align: right;">Story Points</th></tr></thead>';
    html += '<tbody>';
    Object.entries(byStatusHtml)
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, val]) => {
        html += `<tr><td style="border: 1px solid #dee2e6; font-weight: 600;">${escapeHtml(label)}</td><td style="border: 1px solid #dee2e6; text-align: right;">${Number(val)}</td><td style="border: 1px solid #dee2e6; text-align: right;">${byStatusHtmlPts[label] || 0}</td></tr>`;
      });
    html += `<tr style="background: #f8f9fa;"><td style="border: 1px solid #dee2e6; font-weight: 700;">Total in sprint</td><td style="border: 1px solid #dee2e6; font-weight: 700; text-align: right;">${issuesForHtml.length}</td><td style="border: 1px solid #dee2e6; font-weight: 700; text-align: right;">${totalHtmlPts}</td></tr>`;
    html += '</tbody></table>';

    html += '<table style="border-collapse: collapse; width: 100%; font-size: 13px;" cellpadding="6" cellspacing="0"><thead><tr style="background: #f8f9fa;">';
    ['Key', 'Summary', 'Type', 'Priority', 'Assignee', 'Status', 'Resolution', 'Story Points', 'Bucket'].forEach((h, _i) => {
      const align = h === 'Story Points' ? 'right' : 'left';
      html += `<th style="border: 1px solid #dee2e6; text-align: ${align};">${escapeHtml(h)}</th>`;
    });
    html += '</tr></thead><tbody>';
    issuesForHtml.forEach((iss) => {
      html += '<tr>';
      const cells = [iss.key, iss.summary, iss.issuetype, iss.priority, iss.assignee, iss.status, iss.resolution ?? '', iss.storyPoints ?? '', iss.classification];
      cells.forEach((cell, i) => {
        const align = i === 7 ? 'right' : 'left';
        html += `<td style="border: 1px solid #eee; text-align: ${align};">${escapeHtml(String(cell ?? ''))}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }, []);

  const downloadReportCsv = useCallback(() => {
    if (!reportResult) return;
    const csv = getSprintReportCsvText(reportResult);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sprint-report-${reportResult.sprint?.name || reportResult.sprint?.id || 'sprint'}.csv`.replace(/\s+/g, '-');
    a.click();
    URL.revokeObjectURL(url);
  }, [reportResult, getSprintReportCsvText]);

  const copyReportToClipboard = useCallback(async () => {
    if (!reportResult) return;
    const plain = getSprintReportCsvText(reportResult);
    const html = getSprintReportHtml(reportResult);
    try {
      if (html && typeof navigator.clipboard.write === 'function' && window.ClipboardItem) {
        const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const plainBlob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
        await navigator.clipboard.write([new window.ClipboardItem({ 'text/html': htmlBlob, 'text/plain': plainBlob })]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      try {
        await navigator.clipboard.writeText(plain);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e2) {
        console.error('Copy failed:', e2);
      }
    }
  }, [reportResult, getSprintReportCsvText, getSprintReportHtml]);

  const getPastReportCsvText = useCallback((result) => {
    if (!result || !result.aggregatedIssues) return '';
    const escape = (v) => {
      const s = String(v ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const issues = result.aggregatedIssues;
    const header = ['Sprint', 'Key', 'Summary', 'Type', 'Priority', 'Assignee', 'Status', 'Resolution', 'Story Points', 'Classification'];
    const lines = [header.join(',')];
    issues.forEach((iss) => {
      lines.push([escape(iss.sprintName ?? ''), escape(iss.key), escape(iss.summary), escape(iss.issuetype), escape(iss.priority), escape(iss.assignee), escape(iss.status), escape(iss.resolution ?? ''), iss.storyPoints ?? '', escape(iss.classification)].join(','));
    });
    return lines.join('\r\n');
  }, []);

  const handleRefreshNow = useCallback(async () => {
    setRefreshingLive(true);
    setError(null);
    try {
      const productId = selectedTeam?.productId || 'ndb';
      const headers = getAuthHeaders(jiraToken, username).headers;
      const res = await fetch(
        `${API_BASE}/api/release-dataset/refresh-now?productId=${encodeURIComponent(productId)}`,
        { method: 'POST', headers }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      if (mode === MODES.CURRENT && selectedSprintId) {
        await runReport();
      } else if (mode === MODES.PAST) {
        await runPastReport();
      }
    } catch (err) {
      setError(err?.message || 'Failed to refresh live data');
    } finally {
      setRefreshingLive(false);
    }
  }, [jiraToken, mode, runPastReport, runReport, selectedSprintId, selectedTeam?.productId, username]);

  const lastSyncLabel = useMemo(() => {
    if (!syncMeta?.lastSyncIso) return 'not synced';
    const ageMs = Date.now() - new Date(syncMeta.lastSyncIso).getTime();
    if (ageMs < 60000) return 'just now';
    const mins = Math.floor(ageMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }, [syncMeta?.lastSyncIso]);

  const downloadPastReportCsv = useCallback(() => {
    if (!pastReportResult) return;
    const csv = getPastReportCsvText(pastReportResult);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const rangeLabel = periodType === 'quarter' && fiscalYear && fiscalQuarter
      ? `quarter-${fiscalYear}-${fiscalQuarter}`
      : `${startDate || 'start'}-${endDate || 'end'}`;
    a.download = `past-sprint-report-${rangeLabel}.csv`.replace(/\s+/g, '-');
    a.click();
    URL.revokeObjectURL(url);
  }, [pastReportResult, getPastReportCsvText, periodType, fiscalYear, fiscalQuarter, startDate, endDate]);

  if (!hasTeamSelected) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ backgroundColor: '#fff3cd', padding: '2rem', borderRadius: '8px', maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{ color: '#856404', margin: '0 0 1rem 0' }}>Select a Team</h2>
          <p style={{ color: '#856404', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>
            Please select a team from the header to access sprint reports and analytics.
          </p>
          <p style={{ color: '#856404', margin: 0, fontSize: '0.9rem' }}>
            The Sprint Report page provides detailed sprint analytics, progress tracking, and team performance metrics.
          </p>
        </div>
      </div>
    );
  }

  if (isTransitioning) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ backgroundColor: '#e7f3ff', padding: '2rem', borderRadius: '8px', maxWidth: '400px', margin: '0 auto' }}>
          <h3 style={{ color: '#0c5460', margin: '0 0 1rem 0' }}>Switching Teams</h3>
          <p style={{ color: '#0c5460', margin: 0 }}>
            ⏳ Please wait while we load sprint data for the selected team...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="release-version-tab" style={{ padding: '1rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>Sprint Report</h2>
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.85rem', color: '#495057' }}>
          Dataset freshness: <strong>{lastSyncLabel}</strong>
        </span>
        <button
          type="button"
          onClick={handleRefreshNow}
          disabled={refreshingLive || loadingReport || loadingPastReport || loadingTrends}
          style={{ padding: '0.35rem 0.75rem' }}
        >
          {refreshingLive ? 'Refreshing live…' : 'Refresh Now'}
        </button>
      </div>

      {team && (
        <p style={{ marginBottom: '1rem', color: '#6c757d', fontSize: '0.875rem' }}>
          Team: <strong>{team.name}</strong>
          {team.boardId != null && (
            <span style={{ marginLeft: '1rem' }}>Board: {team.boardId}</span>
          )}
        </p>
      )}

      {baseFilter && (
        <p style={{ marginBottom: '1rem', fontSize: '0.8rem', color: '#495057' }}>
          Base filter: <code style={{ background: '#f1f3f5', padding: '2px 6px', borderRadius: '4px' }}>{baseFilter}</code>
        </p>
      )}

      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>Report type:</span>
        {[MODES.CURRENT, MODES.PAST, MODES.TRENDS].map((m) => {
          const inactive = INACTIVE_MODES.includes(m);
          return (
            <label
              key={m}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: inactive ? 'not-allowed' : 'pointer',
                opacity: inactive ? 0.6 : 1
              }}
            >
              <input
                type="radio"
                name="sprint-report-mode"
                checked={mode === m}
                onChange={() => !inactive && setMode(m)}
                disabled={inactive}
              />
              {m === MODES.CURRENT && 'Current sprint report'}
              {m === MODES.PAST && 'Past sprint report (WIP)'}
              {m === MODES.TRENDS && 'Trends by team (WIP)'}
            </label>
          );
        })}
      </div>

      {mode === MODES.CURRENT && (
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ marginRight: '0.5rem', fontWeight: 500 }}>Sprint:</label>
          <select
            value={selectedSprintId}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            disabled={loadingSprints}
            style={{ minWidth: '220px', padding: '0.35rem 0.5rem' }}
          >
            <option value="">{loadingSprints ? 'Loading…' : 'Select sprint'}</option>
            {sprints.map((s) => {
              const isStale = s.state === 'active' && s.endDate && new Date(s.endDate) < new Date();
              return (
                <option key={s.id} value={s.id}>
                  {s.name || `Sprint ${s.id}`} {s.state ? `(${s.state})` : ''}{isStale ? ' — stale' : ''}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={runReport}
            disabled={loadingReport || !selectedSprintId}
            style={{ marginLeft: '0.75rem', padding: '0.35rem 0.75rem' }}
          >
            {loadingReport ? 'Loading…' : 'Run report'}
          </button>
        </div>
      )}

      {mode === MODES.PAST && (
        <div style={{ marginBottom: '1.5rem', width: '100%', maxWidth: '100%' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem 2rem', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: '1 1 280px', minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontWeight: 600 }}>Period:</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input type="radio" name="past-period-type" checked={periodType === 'custom'} onChange={() => setPeriodType('custom')} />
                  Custom date range
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input type="radio" name="past-period-type" checked={periodType === 'quarter'} onChange={() => setPeriodType('quarter')} />
                  Nutanix quarter
                </label>
              </div>
              {periodType === 'custom' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                  <label style={{ fontWeight: 500 }}>Start:</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: '0.35rem 0.5rem' }} />
                  <label style={{ fontWeight: 500 }}>End:</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: '0.35rem 0.5rem' }} />
                </div>
              )}
              {periodType === 'quarter' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                  <label style={{ fontWeight: 500 }}>Fiscal year:</label>
                  <select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} style={{ padding: '0.35rem 0.5rem', minWidth: '100px' }}>
                    <option value="">Select year</option>
                    {Array.from({ length: 9 }, (_, i) => new Date().getFullYear() - 4 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <label style={{ fontWeight: 500 }}>Quarter:</label>
                  <select value={fiscalQuarter} onChange={(e) => setFiscalQuarter(e.target.value)} style={{ padding: '0.35rem 0.5rem', minWidth: '140px' }}>
                    <option value="">Select quarter</option>
                    <option value="Q1">Q1 (Aug–Oct)</option>
                    <option value="Q2">Q2 (Nov–Jan)</option>
                    <option value="Q3">Q3 (Feb–Apr)</option>
                    <option value="Q4">Q4 (May–Jul)</option>
                  </select>
                  {fiscalYear && fiscalQuarter && getNutanixQuarterRange(fiscalYear, fiscalQuarter) && (
                    <span style={{ fontSize: '0.875rem', color: '#6c757d' }}>
                      {getNutanixQuarterRange(fiscalYear, fiscalQuarter).startDate} – {getNutanixQuarterRange(fiscalYear, fiscalQuarter).endDate}
                    </span>
                  )}
                </div>
              )}
              {pastValidationError && (
                <div style={{ color: '#dc3545', fontSize: '0.875rem' }}>{pastValidationError}</div>
              )}
              <div>
                <button
                  type="button"
                  onClick={runPastReport}
                  disabled={loadingPastReport || (periodType === 'custom' ? !startDate || !endDate : !fiscalYear || !fiscalQuarter)}
                  style={{ padding: '0.35rem 0.75rem' }}
                >
                  {loadingPastReport ? 'Loading…' : 'Run report'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: '1 1 320px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 500 }}>Components (optional, max 5)</span>
                {selectedComponentNames.length > 0 && (
                  <span style={{ fontSize: '0.8rem', color: '#6c757d' }}>{selectedComponentNames.length} selected</span>
                )}
              </div>
              {loadingComponents ? (
                <span style={{ color: '#6c757d' }}>Loading components…</span>
              ) : components.length === 0 ? (
                <span style={{ color: '#6c757d', fontSize: '0.875rem' }}>No components for this project.</span>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: '0.5rem 0.75rem',
                    width: '100%'
                  }}
                >
                  {components.map((c) => (
                    <label key={c.id || c.name} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.875rem', minWidth: 0 }} title={c.name}>
                      <input
                        type="checkbox"
                        checked={selectedComponentNames.includes(c.name)}
                        disabled={selectedComponentNames.length >= 5 && !selectedComponentNames.includes(c.name)}
                        onChange={() => toggleComponent(c.name)}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === MODES.TRENDS && (
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ marginBottom: '0.5rem', fontWeight: 500 }}>Select sprints (or leave empty for last 10):</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {sprints.length === 0 && loadingSprints && <span style={{ color: '#6c757d' }}>Loading sprints…</span>}
            {sprints.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedSprintIds.includes(s.id)}
                  onChange={() => toggleSprintForTrends(s.id)}
                />
                <span>{s.name || `Sprint ${s.id}`}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={runTrends}
            disabled={loadingTrends || sprints.length === 0}
            style={{ padding: '0.35rem 0.75rem' }}
          >
            {loadingTrends ? 'Loading…' : 'Run trends'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: '#dc3545', marginBottom: '1rem' }}>{error}</div>
      )}

      {reportResult && mode === MODES.CURRENT && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>{reportResult.sprint?.name || `Sprint ${reportResult.sprint?.id}`}</h3>
            {reportResult.sprint?.startDate && reportResult.sprint?.endDate && (
              <span style={{ fontSize: '0.875rem', color: '#6c757d' }}>
                {formatters.date(reportResult.sprint.startDate)} – {formatters.date(reportResult.sprint.endDate)}
              </span>
            )}
            {reportResult.sprint?.state && (
              <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: 4, background: reportResult.sprint.state === 'active' ? '#d4edda' : '#e2e3e5', color: '#155724' }}>
                {reportResult.sprint.state.toUpperCase()}
              </span>
            )}
            <button type="button" onClick={downloadReportCsv} style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem' }}>
              Download CSV
            </button>
            <button type="button" onClick={copyReportToClipboard} style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem' }}>
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
          </div>

          {reportResult.sprint?.state === 'active' && reportResult.sprint?.endDate && new Date(reportResult.sprint.endDate) < new Date() && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 8, background: '#fff3cd', border: '1px solid #ffc107', color: '#856404', fontSize: '0.875rem' }}>
              Stale sprint — End date has passed but this sprint is still active in Jira. Consider closing it.
            </div>
          )}

          {mode === MODES.CURRENT && reportResult.sprint?.startDate && reportResult.sprint?.endDate && (() => {
            const start = new Date(reportResult.sprint.startDate);
            const end = new Date(reportResult.sprint.endDate);
            const now = new Date();
            const totalWorkingDays = Math.max(1, countWorkingDays(start, end));
            const elapsedWorkingDays = Math.min(totalWorkingDays, countWorkingDays(start, now));
            const daysLeft = Math.max(0, totalWorkingDays - elapsedWorkingDays);
            const timeElapsedPct = Math.round((elapsedWorkingDays / totalWorkingDays) * 100);

            const issues = reportResult.issues || [];
            const total = issues.length;
            const closed = issues.filter((i) => i.classification === 'completedInSprint');
            const nearComp = issues.filter((i) => i.classification === 'pendingQA');
            const closedPct = total > 0 ? Math.round((closed.length / total) * 100) : 0;
            const nearCompPct = total > 0 ? Math.round((nearComp.length / total) * 100) : 0;

            const totalPts = issues.reduce((s, i) => s + (i.storyPoints || 0), 0);
            const closedPts = closed.reduce((s, i) => s + (i.storyPoints || 0), 0);
            const nearCompPts = nearComp.reduce((s, i) => s + (i.storyPoints || 0), 0);
            const closedPtsPct = totalPts > 0 ? Math.round((closedPts / totalPts) * 100) : null;
            const nearCompPtsPct = totalPts > 0 ? Math.round((nearCompPts / totalPts) * 100) : null;

            const gap = timeElapsedPct - closedPct;
            const opinion =
              gap <= 0  ? { label: 'On track', color: '#28a745' } :
              gap <= 15 ? { label: 'Slightly behind', color: '#e6a817' } :
              gap <= 30 ? { label: 'At risk', color: '#fd7e14' } :
                          { label: 'Critical', color: '#dc3545' };

            return (
              <div style={{ maxWidth: 560, marginBottom: '1.5rem', padding: '1rem', border: '1px solid #dee2e6', borderRadius: 8, background: '#f8f9fa' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.875rem' }}>Sprint Progress</div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.775rem', color: '#495057', marginBottom: '0.2rem' }}>
                    <span>Time elapsed — Day {elapsedWorkingDays} of {totalWorkingDays} ({daysLeft} working days left)</span>
                    <span>{timeElapsedPct}%</span>
                  </div>
                  <div style={{ background: '#dee2e6', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                    <div style={{ width: `${timeElapsedPct}%`, background: '#6c757d', height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
                  </div>
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.775rem', color: '#495057', marginBottom: '0.2rem' }}>
                    <span>Completion (by issue count)</span>
                    <span>Closed {closedPct}% · Near completion {nearCompPct}%</span>
                  </div>
                  <div style={{ background: '#dee2e6', borderRadius: 4, height: 10, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${closedPct}%`, background: '#28a745', height: '100%', transition: 'width 0.3s' }} />
                    <div style={{ width: `${nearCompPct}%`, background: '#e6a817', height: '100%', transition: 'width 0.3s' }} />
                  </div>
                </div>
                {closedPtsPct != null && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.775rem', color: '#495057', marginBottom: '0.2rem' }}>
                      <span>Completion (story points)</span>
                      <span>Closed {closedPtsPct}% · Near completion {nearCompPtsPct}%</span>
                    </div>
                    <div style={{ background: '#dee2e6', borderRadius: 4, height: 10, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${closedPtsPct}%`, background: '#28a745', height: '100%', transition: 'width 0.3s' }} />
                      <div style={{ width: `${nearCompPtsPct}%`, background: '#e6a817', height: '100%', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: opinion.color }}>
                  {opinion.label}
                  {gap !== 0 && (
                    <span style={{ fontWeight: 400, color: '#495057' }}>
                      {' '}— Closed is {Math.abs(gap)}% {gap > 0 ? 'behind' : 'ahead of'} time elapsed
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          {mode === MODES.CURRENT && reportResult.sprint?.startDate && reportResult.sprint?.endDate && reportResult.metrics && (() => {
            const start = new Date(reportResult.sprint.startDate);
            const end = new Date(reportResult.sprint.endDate);
            const now = new Date();
            const totalWorkingDays = Math.max(1, countWorkingDays(start, end));
            const elapsedWorkingDays = Math.min(totalWorkingDays, countWorkingDays(start, now));
            const timeElapsedPct = Math.round((elapsedWorkingDays / totalWorkingDays) * 100);
            const issues = reportResult.issues || [];
            const total = issues.length;
            const closedCount = issues.filter((i) => i.classification === 'completedInSprint').length;
            const closedPct = total > 0 ? Math.round((closedCount / total) * 100) : (reportResult.metrics.completionRate ?? 0);
            const scopePct = reportResult.metrics.scopeCreepRate ?? 0;
            return (
              <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#495057' }}>
                <strong>{timeElapsedPct}%</strong> Time elapsed (working days) · <strong>{closedPct}%</strong> Closed · <strong style={{ color: scopePct > 20 ? '#dc3545' : 'inherit' }}>{scopePct}%</strong> Scope change
              </div>
            );
          })()}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ minWidth: 100, padding: '0.75rem 1rem', border: '1px solid #dee2e6', borderRadius: 8, background: '#f8f9fa' }}>
              <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '0.25rem' }}>Total</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{reportResult.metrics?.totalInSprint ?? 0}</div>
            </div>
            <div style={{ minWidth: 100, padding: '0.75rem 1rem', border: '1px solid #dee2e6', borderRadius: 8, background: (() => { const r = reportResult.metrics?.completionRate ?? 0; return r >= 70 ? '#d4edda' : r >= 40 ? '#fff3cd' : '#f8d7da'; })() }}>
              <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '0.25rem' }}>Completion %</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{reportResult.metrics?.completionRate ?? 0}%</div>
            </div>
            <div style={{ minWidth: 100, padding: '0.75rem 1rem', border: '1px solid #dee2e6', borderRadius: 8, background: (() => { const r = reportResult.metrics?.scopeCreepRate ?? 0; return r <= 10 ? '#d4edda' : r <= 25 ? '#fff3cd' : '#f8d7da'; })() }}>
              <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '0.25rem' }}>Scope creep %</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{reportResult.metrics?.scopeCreepRate ?? 0}%</div>
            </div>
            <div style={{ minWidth: 100, padding: '0.75rem 1rem', border: '1px solid #dee2e6', borderRadius: 8, background: (() => { const r = reportResult.metrics?.carryoverRate ?? 0; return r <= 20 ? '#d4edda' : r <= 40 ? '#fff3cd' : '#f8d7da'; })() }}>
              <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '0.25rem' }}>Carry-over %</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{reportResult.metrics?.carryoverRate ?? 0}%</div>
            </div>
          </div>

          {(() => {
            const issues = reportResult.issues || [];
            const byStatus = {};
            issues.forEach((iss) => {
              const s = iss.status || 'Unknown';
              byStatus[s] = (byStatus[s] || 0) + 1;
            });
            const STATUS_COLORS = ['#28a745', '#ffc107', '#0d6efd', '#6c757d', '#fd7e14', '#6f42c1', '#20c997', '#dc3545', '#e83e8c', '#17a2b8'];
            const statusData = Object.entries(byStatus)
              .map(([name, value]) => ({ name, value }))
              .sort((a, b) => b.value - a.value)
              .map((d, i) => ({ ...d, fill: STATUS_COLORS[i % STATUS_COLORS.length] }));

            const byStatusPoints = {};
            issues.forEach((iss) => {
              const pts = typeof iss.storyPoints === 'number' && !Number.isNaN(iss.storyPoints) ? iss.storyPoints : 0;
              const s = iss.status || 'Unknown';
              byStatusPoints[s] = (byStatusPoints[s] || 0) + pts;
            });
            const totalStoryPoints = Object.values(byStatusPoints).reduce((a, b) => a + b, 0);

            return (
              <>
                <div
                  ref={chartsRowRef}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: '2rem',
                    marginBottom: '1.5rem',
                    alignItems: 'flex-start'
                  }}
                >
                  <div style={{ minHeight: 380, minWidth: 0 }}>
                    <h4 style={{ marginBottom: '0.5rem' }}>Status</h4>
                    <p style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: '0.5rem' }}>
                      Work in this sprint by status (from issues below).
                    </p>
                    {statusData.length === 0 ? (
                      <p style={{ fontSize: '0.875rem', color: '#6c757d' }}>No data</p>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={240}>
                          <PieChart>
                            <Pie data={statusData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value" nameKey="name" label={false}>
                              {statusData.map((entry, _i) => (
                                <Cell key={entry.name} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(val, name) => {
                                const pts = byStatusPoints[name] ?? 0;
                                return [`${val} issues, ${pts} pts`, name];
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', justifyContent: 'center' }}>
                          {statusData.map((entry) => (
                            <span key={entry.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: entry.fill, flexShrink: 0 }} />
                              <span>{entry.name}</span>
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {issues.length > 0 && (() => {
                    const byType = {};
                    const byTypePoints = {};
                    issues.forEach((iss) => {
                      const t = iss.issuetype || 'Unknown';
                      byType[t] = (byType[t] || 0) + 1;
                      const pts = typeof iss.storyPoints === 'number' && !Number.isNaN(iss.storyPoints) ? iss.storyPoints : 0;
                      byTypePoints[t] = (byTypePoints[t] || 0) + pts;
                    });
                    const TYPE_COLORS = ['#6610f2', '#0d6efd', '#198754', '#fd7e14', '#6f42c1', '#20c997'];
                    const typeData = Object.entries(byType)
                      .map(([name, value]) => ({ name, value }))
                      .sort((a, b) => b.value - a.value)
                      .map((d, i) => ({ ...d, fill: TYPE_COLORS[i % TYPE_COLORS.length] }));
                    return (
                      <div style={{ minHeight: 380, minWidth: 0 }}>
                        <h4 style={{ marginBottom: '0.5rem' }}>Issue Type</h4>
                        <p style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: '0.5rem' }}>Share by type (Task, Bug, etc.).</p>
                        <ResponsiveContainer width="100%" height={240}>
                          <PieChart>
                            <Pie data={typeData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value" nameKey="name" label={false}>
                              {typeData.map((entry, _i) => (
                                <Cell key={entry.name} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(val, name) => {
                                const pts = byTypePoints[name] ?? 0;
                                return [`${val} issues, ${pts} pts`, name];
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', justifyContent: 'center' }}>
                          {typeData.map((entry) => (
                            <span key={entry.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: entry.fill, flexShrink: 0 }} />
                              <span>{entry.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {issues.length > 0 && (() => {
                    const byPriority = {};
                    const byPriorityPoints = {};
                    issues.forEach((iss) => {
                      const p = iss.priority || 'Unset';
                      byPriority[p] = (byPriority[p] || 0) + 1;
                      const pts = typeof iss.storyPoints === 'number' && !Number.isNaN(iss.storyPoints) ? iss.storyPoints : 0;
                      byPriorityPoints[p] = (byPriorityPoints[p] || 0) + pts;
                    });
                    const PRIORITY_COLORS = { 'Blocker - P0': '#dc3545', 'Critical - P1': '#fd7e14', 'Major - P2': '#ffc107', 'Minor - P3': '#0d6efd', 'Trivial': '#6c757d' };
                    const priorityOrder = ['Blocker - P0', 'Critical - P1', 'Major - P2', 'Minor - P3', 'Trivial', 'Unset'];
                    const priorityData = Object.entries(byPriority)
                      .map(([name, value]) => ({ name, value, fill: PRIORITY_COLORS[name] || '#6c757d' }))
                      .sort((a, b) => priorityOrder.indexOf(a.name) - priorityOrder.indexOf(b.name) || b.value - a.value);
                    return (
                      <div style={{ minHeight: 380, minWidth: 0 }}>
                        <h4 style={{ marginBottom: '0.5rem' }}>Priority</h4>
                        <p style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: '0.5rem' }}>Share by priority.</p>
                        {priorityData.length === 0 ? (
                          <p style={{ fontSize: '0.875rem', color: '#6c757d' }}>No data</p>
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height={240}>
                              <PieChart>
                                <Pie data={priorityData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value" nameKey="name" label={false}>
                                  {priorityData.map((entry, _i) => (
                                    <Cell key={entry.name} fill={entry.fill} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(val, name) => {
                                    const pts = byPriorityPoints[name] ?? 0;
                                    return [`${val} issues, ${pts} pts`, name];
                                  }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', justifyContent: 'center' }}>
                              {priorityData.map((entry) => (
                                <span key={entry.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
                                  <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: entry.fill, flexShrink: 0 }} />
                                  <span>{entry.name}</span>
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {issues.length > 0 && (() => {
                    const byResolution = {};
                    const byResolutionPoints = {};
                    issues.forEach((iss) => {
                      const r = iss.resolution
                        || (iss.classification === 'completedInSprint' ? 'Done (no resolution set)' : 'Unresolved');
                      byResolution[r] = (byResolution[r] || 0) + 1;
                      const pts = typeof iss.storyPoints === 'number' && !Number.isNaN(iss.storyPoints) ? iss.storyPoints : 0;
                      byResolutionPoints[r] = (byResolutionPoints[r] || 0) + pts;
                    });
                    const RESOLUTION_COLORS = ['#20c997', '#0d6efd', '#ffc107', '#fd7e14', '#6c757d', '#dc3545', '#6f42c1'];
                    const resolutionData = Object.entries(byResolution)
                      .map(([name, value]) => ({ name, value }))
                      .sort((a, b) => b.value - a.value)
                      .map((d, i) => ({ ...d, fill: RESOLUTION_COLORS[i % RESOLUTION_COLORS.length] }));
                    return (
                      <div style={{ minHeight: 380, minWidth: 0 }}>
                        <h4 style={{ marginBottom: '0.5rem' }}>Resolution</h4>
                        <p style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: '0.5rem' }}>Share by Jira resolution field. "Done (no resolution set)" means the ticket is closed but the Jira workflow didn't set a resolution.</p>
                        {resolutionData.length === 0 ? (
                          <p style={{ fontSize: '0.875rem', color: '#6c757d' }}>No data</p>
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height={240}>
                              <PieChart>
                                <Pie data={resolutionData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value" nameKey="name" label={false}>
                                  {resolutionData.map((entry) => (
                                    <Cell key={entry.name} fill={entry.fill} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(val, name) => {
                                    const pts = byResolutionPoints[name] ?? 0;
                                    return [`${val} issues, ${pts} pts`, name];
                                  }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', justifyContent: 'center' }}>
                              {resolutionData.map((entry) => (
                                <span key={entry.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
                                  <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: entry.fill, flexShrink: 0 }} />
                                  <span>{entry.name}</span>
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '0.35rem', fontSize: '0.95rem' }}>Scope change</h4>
                  <p style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: '0.5rem' }}>Issues added or removed from the sprint after it started.</p>
                  <table style={{ width: '100%', maxWidth: 400, borderCollapse: 'collapse', marginBottom: '1rem' }}>
                    <tbody>
                      {[
                        { key: 'addedAfterStart', label: 'Added after sprint started' },
                        { key: 'removedFromSprint', label: 'Removed from sprint' }
                      ].map(({ key, label }) => {
                        const formula = reportResult.jqlByMetric?.[key];
                        const value = reportResult.metrics?.[key] ?? 0;
                        const isRealJql = formula && !formula.startsWith('Computed') && !formula.startsWith('Not available');
                        const jiraSearchUrl = isRealJql && reportResult.jiraBaseUrl
                          ? `${reportResult.jiraBaseUrl}/issues/?jql=${encodeURIComponent(formula)}`
                          : null;
                        return (
                          <tr key={key}>
                            <td style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #dee2e6', fontWeight: 600 }}>{label}</td>
                            <td style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #dee2e6' }}>
                              {jiraSearchUrl ? <a href={jiraSearchUrl} target="_blank" rel="noopener noreferrer" title={formula}>{value}</a> : <span title={formula || undefined}>{value}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '0.35rem', fontSize: '0.95rem' }}>Work in sprint (by status)</h4>
                  <p style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: '0.5rem' }}>Counts from the issues below — one source of truth.</p>
                  {issues.length > 0 && totalStoryPoints === 0 && (
                    <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.85rem', borderRadius: 6, background: '#fff3cd', border: '1px solid #ffc107', color: '#856404', fontSize: '0.8rem' }}>
                      Story points are all 0. The configured field is <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>{reportResult.storyPointsFieldId || 'not set'}</code>.{' '}
                      {!spFields && (
                        <button
                          type="button"
                          onClick={discoverSpFields}
                          disabled={loadingSpFields}
                          style={{ marginLeft: '0.5rem', padding: '0.15rem 0.5rem', fontSize: '0.775rem', cursor: 'pointer' }}
                        >
                          {loadingSpFields ? 'Searching…' : 'Find story points field'}
                        </button>
                      )}
                      {spFields && spFields.length === 0 && <span style={{ marginLeft: '0.5rem' }}>No fields matching "story" found in this Jira instance.</span>}
                      {spFields && spFields.length > 0 && (
                        <div style={{ marginTop: '0.4rem' }}>
                          <span style={{ fontWeight: 600 }}>Matching fields — update <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>storyPointsFieldId</code> in <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>server/config/teamBoardConfig.json</code>:</span>
                          <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0 }}>
                            {spFields.map((f) => (
                              <li key={f.id} style={{ marginBottom: '0.15rem' }}>
                                <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>{f.id}</code> — {f.name} {f.type ? `(${f.type})` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  <table style={{ width: '100%', maxWidth: 480, borderCollapse: 'collapse', marginBottom: '0.5rem' }}>
                    <thead>
                      <tr style={{ background: '#f8f9fa' }}>
                        <th style={{ padding: '0.4rem 0.35rem', borderBottom: '2px solid #dee2e6', textAlign: 'left', fontSize: '0.8rem', color: '#6c757d', fontWeight: 600 }}>Status</th>
                        <th style={{ padding: '0.4rem 0.35rem', borderBottom: '2px solid #dee2e6', textAlign: 'right', fontSize: '0.8rem', color: '#6c757d', fontWeight: 600 }}>Count</th>
                        <th style={{ padding: '0.4rem 0.35rem', borderBottom: '2px solid #dee2e6', textAlign: 'right', fontSize: '0.8rem', color: '#6c757d', fontWeight: 600 }}>Story Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusData.map(({ name, value }) => (
                        <tr key={name}>
                          <td style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #dee2e6', fontWeight: 600 }}>{name}</td>
                          <td style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #dee2e6', textAlign: 'right' }}>{value}</td>
                          <td style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #dee2e6', textAlign: 'right', color: byStatusPoints[name] ? 'inherit' : '#adb5bd' }}>
                            {byStatusPoints[name] || 0}
                          </td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid #495057', background: '#f8f9fa' }}>
                        <td style={{ padding: '0.5rem 0.35rem', fontWeight: 700, fontSize: '0.95rem' }}>Total in sprint</td>
                        <td style={{ padding: '0.5rem 0.35rem', fontWeight: 700, fontSize: '0.95rem', textAlign: 'right' }}>
                          {reportResult.jiraBaseUrl && reportResult.jqlByMetric?.totalInSprint ? (
                            <a href={`${reportResult.jiraBaseUrl}/issues/?jql=${encodeURIComponent(reportResult.jqlByMetric.totalInSprint)}`} target="_blank" rel="noopener noreferrer">{issues.length}</a>
                          ) : (
                            issues.length
                          )}
                        </td>
                        <td style={{ padding: '0.5rem 0.35rem', fontWeight: 700, fontSize: '0.95rem', textAlign: 'right' }}>
                          {totalStoryPoints || 0}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {reportResult.note && (
                  <p style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: '1rem' }}>{reportResult.note}</p>
                )}
                <p style={{ fontSize: '0.75rem', color: '#868e96', marginTop: '0.5rem' }}>
                  &quot;Removed from sprint&quot; counts issues that left the sprint during the timebox; the Jira API does not return those, so this is often 0 unless your instance supports history JQL.
                </p>
              </>
            );
          })()}
          {reportResult.issues && reportResult.issues.length > 0 && (
            <div>
              <h4>Issues ({reportResult.issues.length})</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Key</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Summary</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Priority</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Assignee</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Resolution</th>
                    <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Story Points</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {reportResult.issues.map((iss) => (
                    <tr key={iss.key}>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>
                        {reportResult.jiraBaseUrl ? (
                          <a href={`${reportResult.jiraBaseUrl}/browse/${iss.key}`} target="_blank" rel="noopener noreferrer">{iss.key}</a>
                        ) : (
                          iss.key
                        )}
                      </td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.summary}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.issuetype || '-'}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.priority || '-'}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.assignee || '-'}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.status}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.resolution ?? '-'}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{iss.storyPoints ?? '-'}</td>
                      <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.classification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {pastReportResult && mode === MODES.PAST && (
        <div style={{ marginTop: '1.5rem', width: '100%', maxWidth: '100%', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Past sprint report</h3>
            {pastReportResult.sprints && pastReportResult.sprints.length > 0 && (
              <span style={{ fontSize: '0.875rem', color: '#6c757d' }}>
                {pastReportResult.sprints.length} sprint(s)
                {(() => {
                  const range = periodType === 'quarter' && fiscalYear && fiscalQuarter
                    ? getNutanixQuarterRange(fiscalYear, fiscalQuarter)
                    : periodType === 'custom' && startDate && endDate
                      ? { startDate, endDate }
                      : null;
                  if (range) {
                    const startStr = formatters.date(range.startDate) || '';
                    const endStr = formatters.date(range.endDate) || '';
                    return ` · ${startStr} – ${endStr}`;
                  }
                  const first = pastReportResult.sprints[0].endDate;
                  const last = pastReportResult.sprints[pastReportResult.sprints.length - 1].endDate;
                  const firstStr = first ? (formatters.date(first) || '') : '';
                  const lastStr = last ? (formatters.date(last) || '') : '';
                  return firstStr && lastStr ? ` · Sprint end dates: ${firstStr} – ${lastStr}` : '';
                })()}
              </span>
            )}
            <button type="button" onClick={downloadPastReportCsv} style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem' }}>
              Download CSV
            </button>
          </div>
          {pastReportResult.reports && pastReportResult.reports.length > 0 && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ minWidth: 100, padding: '0.75rem 1rem', border: '1px solid #dee2e6', borderRadius: 8, background: '#f8f9fa' }}>
                  <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '0.25rem' }}>Sprints</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{pastReportResult.reports.length}</div>
                </div>
                <div style={{ minWidth: 100, padding: '0.75rem 1rem', border: '1px solid #dee2e6', borderRadius: 8, background: '#f8f9fa' }}>
                  <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '0.25rem' }}>Total issues</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{pastReportResult.aggregatedIssues?.length ?? 0}</div>
                </div>
                <div style={{ minWidth: 100, padding: '0.75rem 1rem', border: '1px solid #dee2e6', borderRadius: 8, background: '#f8f9fa' }}>
                  <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '0.25rem' }}>Avg completion %</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                    {pastReportResult.reports.length > 0
                      ? Math.round(pastReportResult.reports.reduce((s, r) => s + (r.metrics?.completionRate ?? 0), 0) / pastReportResult.reports.length)
                      : 0}%
                  </div>
                </div>
              </div>
              {selectedComponentNames.length > 0 && pastReportResult.aggregatedIssues && pastReportResult.aggregatedIssues.length > 0 && (() => {
                const range = periodType === 'quarter' && fiscalYear && fiscalQuarter
                  ? getNutanixQuarterRange(fiscalYear, fiscalQuarter)
                  : (startDate && endDate ? { startDate, endDate } : null);
                const rangeStart = range ? new Date(range.startDate).getTime() : null;
                const rangeEnd = range ? new Date(range.endDate).getTime() + 86400000 - 1 : null;
                return (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ marginBottom: '0.75rem' }}>By component (5 areas)</h4>
                    {selectedComponentNames.map((componentName) => {
                      const issuesForComponent = pastReportResult.aggregatedIssues.filter(
                        (issue) => issue.components && issue.components.includes(componentName)
                      );
                      const delivery = issuesForComponent.filter((i) => i.classification === 'completedInSprint').length;
                      const newDemand = rangeStart != null && rangeEnd != null
                        ? issuesForComponent.filter((i) => {
                            const t = i.created ? new Date(i.created).getTime() : null;
                            return t != null && t >= rangeStart && t <= rangeEnd;
                          }).length
                        : null;
                      const wip = issuesForComponent.filter((i) => i.classification === 'pendingQA' || i.classification === 'inProgress').length;
                      const cycleTimes = issuesForComponent
                        .filter((i) => i.resolutiondate && i.created)
                        .map((i) => (new Date(i.resolutiondate).getTime() - new Date(i.created).getTime()) / (24 * 60 * 60 * 1000));
                      const avgCycleDays = cycleTimes.length > 0
                        ? (cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length).toFixed(1)
                        : null;
                      return (
                        <div key={componentName} style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #dee2e6', borderRadius: 8, background: '#f8f9fa' }}>
                          <h5 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>{componentName}</h5>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                            <div style={{ minWidth: 90, padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 6, border: '1px solid #e9ecef' }}>
                              <div style={{ fontSize: '0.7rem', color: '#6c757d' }}>Delivery (closed)</div>
                              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{delivery}</div>
                            </div>
                            <div style={{ minWidth: 90, padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 6, border: '1px solid #e9ecef' }}>
                              <div style={{ fontSize: '0.7rem', color: '#6c757d' }}>New demand (opened in range)</div>
                              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{newDemand !== null ? newDemand : '—'}</div>
                            </div>
                            <div style={{ minWidth: 90, padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 6, border: '1px solid #e9ecef' }}>
                              <div style={{ fontSize: '0.7rem', color: '#6c757d' }}>Flow balance</div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{newDemand !== null ? `${newDemand} opened, ${delivery} closed` : `${delivery} closed`}</div>
                            </div>
                            <div style={{ minWidth: 90, padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 6, border: '1px solid #e9ecef' }}>
                              <div style={{ fontSize: '0.7rem', color: '#6c757d' }}>WIP at period end</div>
                              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{wip}</div>
                            </div>
                            <div style={{ minWidth: 90, padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 6, border: '1px solid #e9ecef' }}>
                              <div style={{ fontSize: '0.7rem', color: '#6c757d' }}>Avg cycle time</div>
                              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{avgCycleDays != null ? `${avgCycleDays} days` : '—'}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Timeline — outcome by sprint</h4>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={pastReportResult.reports.map((r) => ({
                      name: r.sprintName || `Sprint ${r.sprintId}`,
                      completed: r.metrics?.completedInSprint ?? 0,
                      pendingQA: r.metrics?.pendingQA ?? 0,
                      inProgress: r.metrics?.inProgress ?? 0,
                      completionRate: r.metrics?.completionRate ?? 0,
                      scopeCreep: r.metrics?.addedAfterStart ?? 0
                    }))}
                    margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-35} textAnchor="end" height={60} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="completed" stackId="a" fill="#28a745" name="Closed" />
                    <Bar dataKey="pendingQA" stackId="a" fill="#ffc107" name="Pending QA" />
                    <Bar dataKey="inProgress" stackId="a" fill="#6c757d" name="In Progress" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Completion rate % over sprints</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart
                    data={pastReportResult.reports.map((r) => ({
                      name: r.sprintName || `Sprint ${r.sprintId}`,
                      completionRate: r.metrics?.completionRate ?? 0
                    }))}
                    margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-35} textAnchor="end" height={60} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="completionRate" stroke="#007bff" name="Completion %" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Scope creep (added after start) by sprint</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart
                    data={pastReportResult.reports.map((r) => ({
                      name: r.sprintName || `Sprint ${r.sprintId}`,
                      scopeCreep: r.metrics?.addedAfterStart ?? 0
                    }))}
                    margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-35} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="scopeCreep" stroke="#dc3545" name="Added after start" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
          {pastReportResult.aggregatedIssues && pastReportResult.aggregatedIssues.length > 0 && (
            <div>
              <h4>Issues ({pastReportResult.aggregatedIssues.length})</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Sprint</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Key</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Summary</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Priority</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Assignee</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Resolution</th>
                      <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Story Points</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Bucket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastReportResult.aggregatedIssues
                      .sort((a, b) => (a.sprintName || '').localeCompare(b.sprintName || '') || (a.key || '').localeCompare(b.key || ''))
                      .map((iss) => (
                        <tr key={`${iss.sprintId}-${iss.key}`}>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.sprintName ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>
                            {pastReportResult.jiraBaseUrl ? (
                              <a href={`${pastReportResult.jiraBaseUrl}/browse/${iss.key}`} target="_blank" rel="noopener noreferrer">{iss.key}</a>
                            ) : (
                              iss.key
                            )}
                          </td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.summary}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.issuetype || '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.priority || '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.assignee || '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.status}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.resolution ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{iss.storyPoints ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{iss.classification}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {pastReportResult.sprints && pastReportResult.sprints.length === 0 && (
            <p style={{ color: '#6c757d', marginTop: '1rem' }}>No closed sprints in this date range. Try a different period or custom range.</p>
          )}
        </div>
      )}

      {trendsResult && mode === MODES.TRENDS && trendsResult.trends && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3>Trends by team</h3>
          {(() => {
            const chartData = trendsResult.trends.map((row) => ({
              name: row.sprintName || `Sprint ${row.sprintId}`,
              completed: row.metrics?.completedInSprint ?? 0,
              pendingQA: row.metrics?.pendingQA ?? 0,
              inProgress: row.metrics?.inProgress ?? 0,
              completionRate: row.metrics?.completionRate ?? 0,
              scopeCreep: row.metrics?.addedAfterStart ?? 0
            }));
            return (
              <>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ marginBottom: '0.5rem' }}>Outcome by sprint (stacked)</h4>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-35} textAnchor="end" height={60} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="completed" stackId="a" fill="#28a745" name="Closed" />
                      <Bar dataKey="pendingQA" stackId="a" fill="#ffc107" name="Pending QA" />
                      <Bar dataKey="inProgress" stackId="a" fill="#6c757d" name="In Progress" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ marginBottom: '0.5rem' }}>Completion rate %</h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-35} textAnchor="end" height={60} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="completionRate" stroke="#007bff" name="Completion %" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ marginBottom: '0.5rem' }}>Scope creep (added after start)</h4>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-35} textAnchor="end" height={60} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="scopeCreep" stroke="#dc3545" name="Added after start" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Sprint</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Total</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Added after start</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Completed</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Pending QA</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>In Progress</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem', borderBottom: '1px solid #dee2e6' }}>Completion %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendsResult.trends.map((row) => (
                        <tr key={row.sprintId}>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5' }}>{row.sprintName || row.sprintId}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{row.metrics?.totalInSprint ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{row.metrics?.addedAfterStart ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{row.metrics?.completedInSprint ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{row.metrics?.pendingQA ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{row.metrics?.inProgress ?? '-'}</td>
                          <td style={{ padding: '0.35rem', borderBottom: '1px solid #f1f3f5', textAlign: 'right' }}>{row.metrics?.completionRate != null ? `${row.metrics.completionRate}%` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
