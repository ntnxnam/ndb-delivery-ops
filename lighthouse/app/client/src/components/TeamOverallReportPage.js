/**
 * Team Overall Report page.
 * Consumes GET /api/reports/team-overall and renders KPI cards, a grouped
 * bar chart (Work Type distribution), a data table, and NAI summaries.
 * Team from the shared sidebar selector; date window + inclusion mode +
 * groupBy are user-controlled.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useTeam } from '../contexts/TeamContext';
import { authenticatedGet, getApiBase } from '../shared/services/apiService';
import { TeamRequiredGate } from '../layout/components/TeamRequiredGate';
import './ReleaseVersionTab.css';

const API_BASE = (typeof getApiBase === 'function' ? getApiBase() : '') || '';

const INCLUSION_MODES = [
  { value: 'closed', label: 'Closed (resolved in window)' },
  { value: 'touched', label: 'Touched (updated or resolved in window)' },
  { value: 'worklogged', label: 'Worklogged (worklog in window)' },
];

const GROUP_BY_OPTIONS = [
  { value: 'issuetype', label: 'Work Type (issuetype)' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
];

const PERIOD_TYPES = [
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom Range' },
];

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const CHART_COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

export default function TeamOverallReportPage() {
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  const { selectedTeamId: teamId, hasTeamSelected, isTransitioning, selectedTeam } = useTeam();

  // Controls
  const [periodType, setPeriodType] = useState('quarter');
  const [quarter, setQuarter] = useState('Q2');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [inclusionMode, setInclusionMode] = useState('closed');
  const [groupBy, setGroupBy] = useState('issuetype');
  const [includeCompanions, setIncludeCompanions] = useState(true);
  const [drillOpen, setDrillOpen] = useState(false);

  // Data
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchReport = useCallback(async (forceRefresh = false) => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const params = {
        teamId,
        periodType,
      };
      if (periodType === 'quarter') {
        params.quarter = `${year}-${quarter}`;
      } else if (periodType === 'year') {
        params.year = year;
      } else {
        params.startDate = startDate;
        params.endDate = endDate;
      }
      params.inclusionMode = inclusionMode;
      params.groupBy = groupBy;
      params.includeCompanions = String(includeCompanions);
      params.multiProject = String(includeCompanions);
      params.summarizeWithNAI = 'true';
      if (forceRefresh) params.forceRefresh = 'true';

      const res = await authenticatedGet(
        `${API_BASE}/api/reports/team-overall`,
        params,
        { jiraToken, username },
        { timeout: 180000 }
      );
      const data = res && res.data;
      if (!data || data.success === false) {
        throw new Error((data && (data.error || data.message)) || `HTTP ${res ? res.status : 0}`);
      }
      setReport(data);
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Failed to fetch report');
    } finally {
      setLoading(false);
    }
  }, [teamId, periodType, quarter, year, startDate, endDate, inclusionMode, groupBy, includeCompanions, jiraToken, username]);

  // Auto-fetch on team change
  useEffect(() => {
    if (hasTeamSelected && teamId) {
      fetchReport(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const handleRun = () => fetchReport(false);
  const handleRefresh = () => fetchReport(true);

  // Chart data
  const chartData = useMemo(() => {
    if (!report || !report.aggregation || !Array.isArray(report.aggregation.groups)) return [];
    return report.aggregation.groups.map(g => ({
      name: g.label,
      count: g.count,
      storyPoints: g.storyPoints,
    }));
  }, [report]);

  const issuesSample = useMemo(() => {
    if (!report || !Array.isArray(report.issuesSample)) return [];
    return report.issuesSample;
  }, [report]);

  const pieData = useMemo(() => {
    if (!report || !report.kpis || !report.kpis.byStatus) return [];
    return Object.entries(report.kpis.byStatus).map(([name, value]) => ({ name, value }));
  }, [report]);

  if (!hasTeamSelected) {
    return <TeamRequiredGate />;
  }

  if (isTransitioning) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ backgroundColor: '#e7f3ff', padding: '2rem', borderRadius: '8px', maxWidth: '400px', margin: '0 auto' }}>
          <h3 style={{ color: '#0c5460', margin: '0 0 1rem 0' }}>Switching Teams</h3>
          <p style={{ color: '#0c5460', margin: 0 }}>Please wait while we load data for the selected team...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tor-page" data-audience="portfolio_mgr" style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '8px' }}>Overall Team Report</h2>
      <p style={{ color: '#666', marginBottom: '16px', fontSize: '14px' }}>
        {selectedTeam?.displayName || teamId} — {report?.meta?.period?.label || 'Select a period and run'}
        {report?.meta?.isCached && <span data-testid="cache-indicator" style={{ marginLeft: '8px', color: '#10B981', fontWeight: 600 }}> (cached)</span>}
      </p>

      {/* Controls */}
      <div className="tor-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', padding: '12px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Period Type</label>
          <select aria-label="Period type" value={periodType} onChange={e => setPeriodType(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db' }}>
            {PERIOD_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        {periodType === 'quarter' && (
          <>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Year</label>
              <input type="number" value={year} onChange={e => setYear(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db', width: '80px' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Quarter</label>
              <select aria-label="Quarter" value={quarter} onChange={e => setQuarter(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db' }}>
                {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
          </>
        )}

        {periodType === 'year' && (
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Year</label>
            <input type="number" value={year} onChange={e => setYear(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db', width: '80px' }} />
          </div>
        )}

        {periodType === 'custom' && (
          <>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Start</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>End</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db' }} />
            </div>
          </>
        )}

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Inclusion</label>
          <select aria-label="Inclusion mode" value={inclusionMode} onChange={e => setInclusionMode(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db' }}>
            {INCLUSION_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Group By</label>
          <select aria-label="Group by" value={groupBy} onChange={e => setGroupBy(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db' }}>
            {GROUP_BY_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="checkbox" aria-label="Multi-project toggle" data-testid="multi-project-toggle" checked={includeCompanions} onChange={e => setIncludeCompanions(e.target.checked)} />
            Include companion projects
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <button aria-label="Run report" onClick={handleRun} disabled={loading} style={{ padding: '6px 16px', borderRadius: '4px', border: 'none', background: '#4F46E5', color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
            {loading ? 'Loading...' : 'Run Report'}
          </button>
          <button onClick={handleRefresh} disabled={loading} title="Bypass cache and re-fetch" style={{ padding: '6px 16px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', cursor: loading ? 'not-allowed' : 'pointer' }}>
            Force Refresh
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" data-testid="error-state" style={{ padding: '12px', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', color: '#991B1B', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {loading && !report && (
        <div data-testid="loading-state" style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading report...</div>
      )}

      {!loading && !report && !error && (
        <div data-testid="empty-state" style={{ textAlign: 'center', padding: '40px', color: '#666', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #d1d5db' }}>
          No report loaded yet. Select a period and click Run Report.
        </div>
      )}

      {report && (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <button type="button" onClick={() => setDrillOpen(true)} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} aria-label="Drill into issues (opens in-app panel, not JIRA)">
              <KpiCard label="Total Issues (click to drill)" value={report?.kpis?.totalIssues ?? 0} />
            </button>
            <KpiCard label="Story Points" value={report?.kpis?.totalStoryPoints ?? 0} />
            <KpiCard label="Avg Cycle Time (days)" value={report?.kpis?.avgCycleTimeDays ?? '—'} />
            <KpiCard label="Throughput / Week" value={report?.kpis?.throughputPerWeek ?? 0} />
            <KpiCard label="Work Types" value={report?.aggregation?.totalGroups ?? 0} />
            {report.meta?.multiProjectEnabled && (
              <KpiCard label="Companion Issues" value={report.meta?.companionIssueCount} />
            )}
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', minWidth: 0 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Work Type Distribution</h4>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px 0' }}>Shows how work is distributed across types for the selected window.</p>
              <ResponsiveContainer width="100%" height={300} aria-label="Work type distribution chart">
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" fill="#4F46E5" name="Count" />
                  <Bar dataKey="storyPoints" fill="#10B981" name="Story Points" />
                </BarChart>
              </ResponsiveContainer>
              <small style={{ fontSize: '10px', color: '#9ca3af' }}>Source: JIRA via /api/reports/team-overall. Count + story points per work type.</small>
            </div>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', minWidth: 0 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Status Breakdown</h4>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px 0' }}>Distribution of issues by resolution status in the window.</p>
              <ResponsiveContainer width="100%" height={300} aria-label="Status breakdown chart">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                    {pieData.map((_, idx) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* JQL Executed */}
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>JQL Executed</span>
              <button aria-label="Copy JQL"
                onClick={() => navigator.clipboard?.writeText(report.meta?.jqlExecuted)}
                style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
              >
                Copy
              </button>
            </div>
            <code style={{ fontSize: '11px', wordBreak: 'break-all', color: '#374151' }}>{report.meta?.jqlExecuted}</code>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
              Generated: {new Date(report.meta?.generatedAt).toLocaleString()} | Issues: {report.meta?.issueCount}
              {report.meta?.companionProjects && report.meta?.companionProjects.length > 0 && (
                <span> | Companions: {report.meta?.companionProjects.join(', ')}</span>
              )}
            </div>
          </div>

          {/* Issues Table */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'auto', marginBottom: '16px' }}>
            <h4 style={{ margin: '12px 12px 8px', fontSize: '14px' }}>Issues Sample ({issuesSample.length})</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <caption style={{ captionSide: 'top', textAlign: 'left', fontSize: '12px', color: '#6b7280', padding: '4px 12px' }}>Issues sample from JIRA</caption>
              <thead>
                <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
                  <th scope="col" style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Key</th>
                  <th scope="col" style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Summary</th>
                  <th scope="col" style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Type</th>
                  <th scope="col" style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                  <th scope="col" style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>SP</th>
                  <th scope="col" style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {issuesSample.map(issue => (
                  <tr key={issue.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <a href={issue.url || `https://jira.nutanix.com/browse/${issue.key}`} target="_blank" rel="noreferrer" style={{ color: '#4F46E5', textDecoration: 'none', fontWeight: 600 }}>
                        {issue.key}
                      </a>
                    </td>
                    <td style={{ padding: '8px 12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.summary}</td>
                    <td style={{ padding: '8px 12px' }}>{issue.issuetype}</td>
                    <td style={{ padding: '8px 12px' }}>{issue.status}</td>
                    <td style={{ padding: '8px 12px' }}>{issue.storyPoints ?? '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: '11px', color: '#6b7280' }}>{issue.sourceProject || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>



          {/* In-app drill panel (metric dual-action: count -> panel) */}
          {drillOpen && (
            <div role="dialog" aria-label="Issues drill-down" style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', width: '80%', maxWidth: '900px', maxHeight: '70vh', overflow: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 1000 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '14px' }}>Issues Drill-Down ({report.issuesSample.length} of {report.kpis.totalIssues})</h4>
                <a href={`https://jira.nutanix.com/issues/?jql=${encodeURIComponent(report.meta?.jqlExecuted || '')}`} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: '#4F46E5' }}>Open in JIRA ↗</a>
                <button aria-label="Close drill-down" onClick={() => setDrillOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', marginLeft: '8px' }}>×</button>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {report.issuesSample.map(issue => (
                  <li key={issue.key} style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px' }}>
                    <a href={issue.url} target="_blank" rel="noreferrer" style={{ color: '#4F46E5', fontWeight: 600, marginRight: '8px' }}>{issue.key}</a>
                    <span>{issue.summary}</span>
                    <span style={{ color: '#6b7280', marginLeft: '8px', fontSize: '11px' }}>({issue.issuetype} · {issue.status})</span>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280' }}>
                Showing {report.issuesSample.length} of {report.kpis.totalIssues} issues. Open in JIRA for full set.
              </div>
            </div>
          )}

          {/* Open in JIRA link */}
          {report.meta?.jqlExecuted && (
            <div style={{ textAlign: 'right', marginBottom: '16px' }}>
              <a
                href={`${report.meta?.jiraBaseUrl || 'https://jira.nutanix.com'}/issues/?jql=${encodeURIComponent(report.meta?.jqlExecuted)}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '12px', color: '#4F46E5', textDecoration: 'none' }}
              >
                Open in JIRA ↗
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  );
}
