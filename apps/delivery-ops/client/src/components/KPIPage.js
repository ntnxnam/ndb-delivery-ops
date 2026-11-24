/**
 * KPIs page: per-team KPI list (name + base query + display type) and admin add/delete.
 * Widget section: trendy cards showing count or list per KPI.
 * Team is taken from the shared sidebar selector (TeamContext).
 * KPI query = team.baseFilter AND kpi.baseQuery.
 * Only visible to users in kpiTabAllowedUsers.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageLoading } from '../shared/components/PageLoading';
import { authenticatedGet, authenticatedPost, authenticatedDelete, getApiBase } from '../shared/services/apiService';
import { useTeam } from '../contexts/TeamContext';
import { TeamRequiredGate } from '../layout/components/TeamRequiredGate';
import { usePermissions } from '../auth/hooks/usePermissions';
import { useExecPageBriefing } from '../hooks/useExecPageBriefing';
import ExecPageBriefing from './ExecPageBriefing';
import './ProjectStatusPage.css';

const API_BASE = getApiBase();

const CARD_STYLES = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '1.25rem',
    marginTop: '1.5rem'
  },
  card: {
    background: 'linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%)',
    borderRadius: '12px',
    boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
    border: '1px solid rgba(0,0,0,0.06)',
    overflow: 'hidden'
  },
  cardHeader: {
    padding: '0.5rem 0.75rem',
    background: 'linear-gradient(180deg, #f1f3f5 0%, #e9ecef 100%)',
    color: '#212529',
    fontSize: '0.8125rem',
    fontWeight: 600,
    letterSpacing: '0.01em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    borderBottom: '1px solid #dee2e6'
  },
  cardBody: {
    padding: '1rem'
  },
  countBig: {
    fontSize: '2.5rem',
    fontWeight: 700,
    color: '#0d6efd',
    lineHeight: 1.2
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.8rem'
  },
  th: {
    textAlign: 'left',
    padding: '0.35rem 0.5rem',
    borderBottom: '1px solid #dee2e6',
    color: '#6c757d',
    fontWeight: 600
  },
  td: {
    padding: '0.4rem 0.5rem',
    borderBottom: '1px solid #f1f3f5'
  },
  keyLink: {
    color: '#0d6efd',
    textDecoration: 'none',
    fontWeight: 500
  },
  loading: {
    color: '#6c757d',
    fontSize: '0.875rem'
  },
  error: {
    color: '#dc3545',
    fontSize: '0.875rem'
  }
};

const PHASE_LABELS = {
  postRelease: 'Post-release',
  execution: 'During Execution',
  release: 'At Release',
  overall: 'Overall',
};
const PHASE_ORDER = ['postRelease', 'execution', 'release', 'overall'];
const PHASE_SUBTITLE = {
  postRelease: 'CFDs / CFIs / OnCalls — did we ship cleanly?',
  execution: 'P0 / P1 / E-W Projects — is the build on track?',
  release: 'Regression / System Test / Pre-Commits — can we ship?',
  overall: 'SLA / CVE / Deferral — are we meeting promises?',
};

const LIST_PAGE_SIZE = 5;

function KPIWidgetCard({ kpi, data, onRefresh, isRefreshing }) {
  const isSuperImportant = kpi.isSuperImportant === true;
  const displayType = kpi.displayType === 'list' ? 'list' : 'count';
  const [listPage, setListPage] = useState(1);
  const jiraBase = (typeof process !== 'undefined' && process.env?.REACT_APP_JIRA_BASE) || 'https://jira.nutanix.com';
  const err = data && data.error;
  const hasData = data && !data.error;
  const loading = isRefreshing;
  const noDataYet = data === undefined && !isRefreshing;
  // Prefer combined JQL (team base + KPI query) for link so JIRA opens the same query as the widget count
  const combinedJql = data && data.combinedJql;
  const jiraSearchUrl = combinedJql
    ? `${jiraBase}/issues/?jql=${encodeURIComponent(combinedJql)}`
    : null;
  const isOnCallsKpi = /oncalls?/i.test(kpi?.name || '');
  const isCfdCfiKpi = /CFD|CFI/i.test(kpi?.name || '') && !isOnCallsKpi;
  const deepLink = isOnCallsKpi ? '/oncalls' : isCfdCfiKpi ? `/cfdcfi?kpi=${encodeURIComponent(kpi?.id || '')}` : null;

  const issues = hasData && displayType === 'list' && data.issues ? data.issues : [];
  const totalCount = hasData && displayType === 'list' && data.total != null ? data.total : issues.length;
  const totalListPages = Math.max(1, Math.ceil(issues.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, totalListPages);
  const pageStart = (safeListPage - 1) * LIST_PAGE_SIZE;
  const pageIssues = issues.slice(pageStart, pageStart + LIST_PAGE_SIZE);
  useEffect(() => {
    if (displayType === 'list' && hasData) setListPage((p) => Math.min(p, totalListPages));
  }, [displayType, hasData, totalListPages]);

  return (
    <div style={isSuperImportant ? { ...CARD_STYLES.card, borderColor: '#ff9800', borderWidth: '2px', boxShadow: '0 4px 14px rgba(255,152,0,0.18)' } : CARD_STYLES.card}>
      <div style={CARD_STYLES.cardHeader}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0, flexWrap: 'wrap' }}>"

          {deepLink ? (
            <Link
              to={deepLink}
              title={isOnCallsKpi ? 'Open OnCalls info page' : 'Open CFD/CFI pulse page'}
              style={{ color: '#0d6efd', textDecoration: 'none', fontWeight: 600 }}
            >
              {kpi.name}
            </Link>
          ) : jiraSearchUrl ? (
            <a
              href={jiraSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open query in JIRA (team base + KPI filter)"
              style={{ color: '#0d6efd', textDecoration: 'none', fontWeight: 600 }}
            >
              {kpi.name}
            </a>
          ) : (
            <span>{kpi.name}</span>
          )}
        </span>
        {isSuperImportant && (
          <span
            title="Super-important — E-W projects in release (labels ndb-ew / global-ew / nutanix-ew)"
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              color: '#e65100',
              background: '#fff3e0',
              border: '1px solid #ffcc80',
              borderRadius: '999px',
              padding: '0.1rem 0.4rem',
              whiteSpace: 'nowrap',
              letterSpacing: '0.02em',
            }}
          >
            🔶 Super-important
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>"

          {deepLink && (
            <Link
              to={deepLink}
              title={isOnCallsKpi ? 'OnCalls info page' : 'CFD/CFI pulse page'}
              style={{ fontSize: '0.7rem', color: '#0f766e', textDecoration: 'none' }}
            >
              Info
            </Link>
          )}
          {jiraSearchUrl && (
            <a
              href={jiraSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in JIRA"
              style={{ fontSize: '0.7rem', color: '#6c757d', textDecoration: 'none' }}
            >
              JIRA
            </a>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={() => onRefresh(kpi.id)}
              disabled={isRefreshing}
              title="Refresh this widget"
              style={{
                padding: '0.15rem 0.4rem',
                fontSize: '0.7rem',
                background: '#fff',
                color: '#495057',
                border: '1px solid #ced4da',
                borderRadius: '4px',
                cursor: isRefreshing ? 'not-allowed' : 'pointer'
              }}
            >
              {isRefreshing ? '…' : 'Refresh'}
            </button>
          )}
        </span>
      </div>
      <div style={CARD_STYLES.cardBody}>
        {loading && <div style={CARD_STYLES.loading}>Loading…</div>}
        {noDataYet && <div style={{ ...CARD_STYLES.loading, color: '#6c757d' }}>No data — click Load widgets to load</div>}
        {err && !noDataYet && <div style={CARD_STYLES.error}>{err}</div>}
        {hasData && displayType === 'count' && (
          <div style={CARD_STYLES.countBig}>{data.total != null ? data.total : 0}</div>
        )}
        {hasData && displayType === 'list' && (
          <>
            <div style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: '#6c757d' }}>
              {issues.length === 0
                ? '0 issues'
                : totalCount <= LIST_PAGE_SIZE
                  ? `${totalCount} of ${totalCount}`
                  : `Showing ${pageStart + 1}-${pageStart + pageIssues.length} of ${totalCount}`}
            </div>
            {issues.length === 0 ? (
              <div style={CARD_STYLES.loading}>No issues</div>
            ) : (
              <>
                <div style={{ overflowX: 'auto', margin: '0 -0.25rem', minWidth: 0 }}>
                  <table style={CARD_STYLES.table}>
                    <thead>
                      <tr>
                        <th style={CARD_STYLES.th}>Key</th>
                        <th style={CARD_STYLES.th}>Summary</th>
                        <th style={CARD_STYLES.th}>Priority</th>
                        <th style={CARD_STYLES.th}>Assignee</th>
                        <th style={CARD_STYLES.th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageIssues.map((row, i) => (
                        <tr key={row.key || i}>
                          <td style={CARD_STYLES.td}>
                            <a href={`${jiraBase}/browse/${row.key}`} target="_blank" rel="noopener noreferrer" style={CARD_STYLES.keyLink}>
                              {row.key}
                            </a>
                          </td>
                          <td style={CARD_STYLES.td}>{row.summary || '—'}</td>
                          <td style={CARD_STYLES.td}>{row.priority || '—'}</td>
                          <td style={CARD_STYLES.td}>{row.assignee || '—'}</td>
                          <td style={CARD_STYLES.td}>{row.status || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalListPages > 1 && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#6c757d' }}>
                      Page {safeListPage} of {totalListPages}
                    </span>
                    <span style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        type="button"
                        onClick={() => setListPage((p) => Math.max(1, p - 1))}
                        disabled={safeListPage <= 1}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff', cursor: safeListPage <= 1 ? 'not-allowed' : 'pointer', opacity: safeListPage <= 1 ? 0.6 : 1 }}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setListPage((p) => Math.min(totalListPages, p + 1))}
                        disabled={safeListPage >= totalListPages}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff', cursor: safeListPage >= totalListPages ? 'not-allowed' : 'pointer', opacity: safeListPage >= totalListPages ? 0.6 : 1 }}
                      >
                        Next
                      </button>
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function KPIPage() {
  const { selectedTeamId, selectedTeam, hasTeamSelected } = useTeam();
  const [kpis, setKpis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addName, setAddName] = useState('');
  const [addQuery, setAddQuery] = useState('');
  const [addDisplayType, setAddDisplayType] = useState('count');
  const [editingKpiId, setEditingKpiId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [widgetResults, setWidgetResults] = useState(null);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [loadingWidgetId, setLoadingWidgetId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const teamId = selectedTeamId;
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  const currentTeam = selectedTeam;
  const currentTeamBaseFilter = (currentTeam && currentTeam.baseFilter) ? String(currentTeam.baseFilter) : '';
  const { isExecAudience } = usePermissions();

  const kpiBriefingSnapshot = useMemo(() => {
    if (!widgetResults || widgetResults._error) return null;
    const rows = (kpis || []).map((k) => {
      const w = widgetResults[k.id];
      const count =
        w && !w.error
          ? (typeof w.count === 'number' ? w.count : (w.total != null ? w.total : (w.issues || []).length))
          : null;
      return { id: k.id, name: k.name, count };
    }).filter((r) => r.count != null);
    if (!rows.length) return null;
    return { label: currentTeam?.name || teamId, kpis: rows };
  }, [widgetResults, kpis, currentTeam, teamId]);

  const kpiSnapshotKey = useMemo(() => {
    if (!kpiBriefingSnapshot) return '';
    return kpiBriefingSnapshot.kpis.map((k) => `${k.id}:${k.count}`).join(',');
  }, [kpiBriefingSnapshot]);

  const {
    state: execBriefState,
    summary: execBriefSummary,
    meta: execBriefMeta,
    error: execBriefError,
    refresh: refreshExecBrief,
  } = useExecPageBriefing({
    enabled: isExecAudience,
    surface: 'kpi',
    teamId,
    snapshot: kpiBriefingSnapshot,
    snapshotKey: kpiSnapshotKey,
    ready: Boolean(kpiBriefingSnapshot),
  });

  const fetchKpis = useCallback(async () => {
    if (!teamId) {
      setKpis([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const opts = { jiraToken, username };
      const res = await authenticatedGet(`${API_BASE}/api/config/kpi`, { teamId }, opts);
      setKpis(res.data.kpis || []);
      setIsAdmin(res.data.isAdmin === true);
    } catch (err) {
      const apiError = err.response?.data?.error || '';
      const apiMessage = err.response?.data?.message || '';
      const msg = apiMessage || apiError || err.message || 'Failed to load KPIs';
      const isNoKpiConfig = apiError === 'Team KPIs not found' || (typeof msg === 'string' && msg.includes('No KPI config'));
      setError(isNoKpiConfig ? 'No KPIs configured for this team. Add KPIs below or select another team.' : msg);
      setKpis([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, jiraToken, username]);

  useEffect(() => {
    setWidgetResults(null);
  }, [teamId]);

  useEffect(() => {
    fetchKpis();
  }, [fetchKpis]);

  const fetchWidgetResults = useCallback(async () => {
    if (!teamId || !kpis.length || !jiraToken) {
      setWidgetResults(null);
      return;
    }
    setWidgetsLoading(true);
    setWidgetResults(null);
    try {
      const res = await authenticatedPost(`${API_BASE}/api/jira/kpi-results-batch`, { teamId }, { jiraToken, username });
      if (res.data && res.data.success && res.data.results) {
        setWidgetResults(res.data.results);
      } else {
        setWidgetResults({});
      }
    } catch (e) {
      setWidgetResults({ _error: e.response?.data?.error || e.message || 'Failed to load widgets' });
    } finally {
      setWidgetsLoading(false);
    }
  }, [teamId, kpis.length, jiraToken, username]);

  const refreshSingleWidget = useCallback(async (kpiId) => {
    if (!teamId || !kpiId || !jiraToken) return;
    setLoadingWidgetId(kpiId);
    try {
      const res = await authenticatedPost(`${API_BASE}/api/jira/kpi-results`, { teamId, kpiId }, { jiraToken, username });
      if (res.data && res.data.success) {
        const payload = { total: res.data.total, issues: res.data.issues, combinedJql: res.data.combinedJql };
        setWidgetResults((prev) => (prev && !prev._error ? { ...prev, [kpiId]: payload } : { [kpiId]: payload }));
      } else {
        setWidgetResults((prev) => (prev && !prev._error ? { ...prev, [kpiId]: { error: res.data?.error || 'Failed' } } : { [kpiId]: { error: res.data?.error || 'Failed' } }));
      }
    } catch (e) {
      setWidgetResults((prev) => (prev && !prev._error ? { ...prev, [kpiId]: { error: e.response?.data?.error || e.message || 'Failed' } } : { [kpiId]: { error: e.response?.data?.error || e.message || 'Failed' } }));
    } finally {
      setLoadingWidgetId(null);
    }
  }, [teamId, jiraToken, username]);

  const handleAddOrUpdate = async (e) => {
    e.preventDefault();
    const name = addName.trim();
    const baseQuery = addQuery.trim();
    if (!name || !baseQuery || !teamId) return;
    setSaving(true);
    setError('');
    try {
      const body = editingKpiId
        ? { teamId, id: editingKpiId, name, baseQuery, displayType: addDisplayType }
        : { teamId, name, baseQuery, displayType: addDisplayType };
      await authenticatedPost(`${API_BASE}/api/config/kpi`, body, { jiraToken, username });
      setAddName('');
      setAddQuery('');
      setAddDisplayType('count');
      setEditingKpiId(null);
      await fetchKpis();
    } catch (err) {
      setError(err.response?.data?.error || err.message || (editingKpiId ? 'Failed to update KPI' : 'Failed to add KPI'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (k) => {
    setAddName(k.name || '');
    setAddQuery(k.baseQuery || '');
    setAddDisplayType(k.displayType === 'list' ? 'list' : 'count');
    setEditingKpiId(k.id || null);
    setError('');
  };

  const handleCancelEdit = () => {
    setAddName('');
    setAddQuery('');
    setAddDisplayType('count');
    setEditingKpiId(null);
    setError('');
  };



  const [reorderingId, setReorderingId] = useState(null);

  const handleReorder = async (kpiId, direction) => {
    if (!teamId || !kpiId || !jiraToken) return;
    setReorderingId(kpiId);
    setError('');
    try {
      await authenticatedPost(
        `${API_BASE}/api/config/kpi-reorder`,
        { teamId, kpiId, direction },
        { jiraToken, username }
      );
      await fetchKpis();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reorder');
    } finally {
      setReorderingId(null);
    }
  };

  const handleDelete = async (k) => {
    const id = k.id;
    if (!teamId || !id) return;
    setDeleting(id);
    setError('');
    try {
      await authenticatedDelete(`${API_BASE}/api/config/kpi`, { teamId, id }, { jiraToken, username });
      await fetchKpis();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete KPI');
    } finally {
      setDeleting(null);
    }
  };

  const teamName = currentTeam?.name || teamId;

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        selectorId="kpi-team-select"
        description="KPI widgets run as (team base filter) AND (KPI base query) for the selected team."
      />
    );
  }

  return (
    <div className="kpi-page" style={{ padding: '1.25rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.5rem', fontWeight: 600 }}>Team KPIs</h2>
      <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#6c757d' }}>
        Team: <strong>{teamName || '—'}</strong>
        {' — KPIs use this team’s base filter'}
      </p>

      <ExecPageBriefing
        state={execBriefState}
        summary={execBriefSummary}
        meta={execBriefMeta}
        error={execBriefError}
        onRetry={refreshExecBrief}
      />

      {teamId && (
        <div style={{ marginBottom: '1.25rem', padding: '1rem', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #dee2e6' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.35rem' }}>Team base filter <span style={{ fontWeight: 400, color: '#6c757d', fontSize: '0.75rem' }}>(read-only — managed in Admin)</span></label>
          {currentTeamBaseFilter ? (
            <div style={{ fontSize: '0.85rem', wordBreak: 'break-all', whiteSpace: 'pre-wrap', color: '#212529', background: '#fff', border: '1px solid #e9ecef', borderRadius: '6px', padding: '0.5rem 0.6rem' }}>{currentTeamBaseFilter}</div>
          ) : (
            <span style={{ fontSize: '0.9rem', color: '#6c757d' }}>Not set</span>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f8d7da', color: '#721c24', borderRadius: '8px', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <PageLoading message="Loading KPIs…" />
      ) : (
        <>
          {(() => {
            const standardKpis = kpis.filter((k) => k.locked);
            const teamKpis = kpis.filter((k) => !k.locked);
            const renderRows = (list) => list.map((k, index) => (
                <tr key={k.id} style={{ borderBottom: '1px solid #eee', ...(k.locked ? { background: '#f1f3f5', opacity: 0.85 } : {}) }}>
                  {isAdmin && (
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {k.locked ? (
                        <span style={{ fontSize: '0.65rem', color: '#adb5bd' }} title="Standard KPI order is fixed">—</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReorder(k.id, 'up')}
                            disabled={index === 0 || reorderingId === k.id}
                            title="Move up"
                            style={{ padding: '2px 6px', fontSize: '0.7rem', marginRight: '2px', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff', cursor: index === 0 || reorderingId === k.id ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.5 : 1 }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReorder(k.id, 'down')}
                            disabled={index === kpis.length - 1 || reorderingId === k.id}
                            title="Move down"
                            style={{ padding: '2px 6px', fontSize: '0.7rem', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff', cursor: index === kpis.length - 1 || reorderingId === k.id ? 'not-allowed' : 'pointer', opacity: index === kpis.length - 1 ? 0.5 : 1 }}
                          >
                            ↓
                          </button>
                        </>
                      )}
                    </td>
                  )}
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.875rem', ...(k.locked ? { color: '#868e96' } : {}) }}>{k.name}{k.locked && <span title="Company-standard — same JQL for every team, not editable. Team scope comes from team.baseFilter." style={{ marginLeft: '0.35rem', fontSize: '0.7rem', color: '#495057', border: '1px solid #adb5bd', borderRadius: '999px', padding: '0.1rem 0.4rem', background: '#e9ecef' }}>⛔ blocked — standard</span>}</td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.875rem', wordBreak: 'break-all', ...(k.locked ? { color: '#868e96', background: '#e9ecef' } : {}) }}>{k.baseQuery}</td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.875rem', ...(k.locked ? { color: '#868e96' } : {}) }}>{k.displayType === 'list' ? 'List' : 'Count'}</td>
                  {isAdmin && (
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {k.locked ? (
                        <span style={{ fontSize: '0.7rem', color: '#868e96', background: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px', padding: '0.2rem 0.4rem' }} title="Standard KPI — JQL is fixed company-wide">⛔ Blocked</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleEdit(k)}
                            style={{ padding: '4px 10px', fontSize: '0.75rem', marginRight: '6px', color: '#0d6efd', background: 'transparent', border: '1px solid #0d6efd', borderRadius: '6px', cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(k)}
                            disabled={deleting === k.id}
                            style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#dc3545', background: 'transparent', border: '1px solid #dc3545', borderRadius: '6px', cursor: deleting === k.id ? 'not-allowed' : 'pointer' }}
                          >
                            {deleting === k.id ? '…' : 'Remove'}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))
            );
            const renderTable = (list, title) => (
              <>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 700, color: title === 'Standard' ? '#495057' : '#212529' }}>{title} <span style={{ fontWeight: 400, color: '#6c757d', fontSize: '0.75rem' }}>({list.length})</span>{title === 'Standard' && <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', background: '#e9ecef', border: '1px solid #ced4da', borderRadius: '999px', padding: '0.15rem 0.4rem', color: '#868e96' }}>\u26d4 blocked \u2014 read-only</span>}</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderRadius: '8px', overflow: 'hidden' }}>
                  <thead>
                    <tr style={{ background: title === 'Standard' ? '#e9ecef' : '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                      {isAdmin && <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.875rem', width: '40px' }}>Order</th>}
                      <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.875rem' }}>KPI</th>
                      <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.875rem' }}>Base Query</th>
                      <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.875rem' }}>Widget</th>
                      {isAdmin && <th style={{ width: 200, padding: '0.6rem 0.75rem', fontSize: '0.875rem' }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 ? (
                      <tr><td colSpan={isAdmin ? 5 : 3} style={{ padding: '1.25rem', color: '#6c757d', fontSize: '0.875rem' }}>{title === 'Standard' ? 'No standard KPIs.' : (isAdmin ? 'No team KPIs. Add one below.' : 'No team KPIs.')}</td></tr>
                    ) : renderRows(list)}
                  </tbody>
                </table>
              </>
            );
            return (
              <>
                {renderTable(standardKpis, 'Standard')}
                {renderTable(teamKpis, 'Team Specific')}
              </>
            );
          })()}

          {teamId && isAdmin && (
            <form onSubmit={handleAddOrUpdate} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '2rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.875rem' }}>
                KPI name
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. CFDs"
                  style={{ padding: '0.5rem 0.6rem', minWidth: '120px', border: '1px solid #ced4da', borderRadius: '6px' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.875rem', flex: '1 1 200px' }}>
                Base query
                <input
                  type="text"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="e.g. filter=142539"
                  style={{ padding: '0.5rem 0.6rem', width: '100%', border: '1px solid #ced4da', borderRadius: '6px' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.875rem' }}>
                Widget display
                <select
                  value={addDisplayType}
                  onChange={(e) => setAddDisplayType(e.target.value)}
                  style={{ padding: '0.5rem 0.6rem', minWidth: '100px', border: '1px solid #ced4da', borderRadius: '6px' }}
                >
                  <option value="count">Count</option>
                  <option value="list">List</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={saving || !addName.trim() || !addQuery.trim()}
                style={{ padding: '0.5rem 1.25rem', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
              >
                {saving ? (editingKpiId ? 'Updating…' : 'Adding…') : (editingKpiId ? 'Update KPI' : 'Add KPI')}
              </button>
              {editingKpiId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  style={{ padding: '0.5rem 1rem', background: '#6c757d', color: '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem' }}
                >
                  Cancel
                </button>
              )}
            </form>
          )}

          {teamId && kpis.length > 0 && jiraToken && (
            <>
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1.1rem', fontWeight: 600 }}>Widgets</h3>
              {!widgetResults && !widgetsLoading && (
                <button
                  type="button"
                  onClick={() => fetchWidgetResults()}
                  style={{ padding: '0.5rem 1.25rem', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
                >
                  Load widgets
                </button>
              )}
              {(widgetResults || widgetsLoading) && !(widgetResults && widgetResults._error) && (
                <>
                  {widgetResults && (
                    <button
                      type="button"
                      onClick={() => fetchWidgetResults()}
                      disabled={widgetsLoading}
                      style={{ marginBottom: '0.75rem', padding: '0.35rem 0.75rem', background: 'transparent', color: '#0d6efd', border: '1px solid #0d6efd', borderRadius: '6px', cursor: widgetsLoading ? 'not-allowed' : 'pointer', fontSize: '0.8rem' }}
                    >
                      {widgetsLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  )}
                  {widgetsLoading && !widgetResults && <PageLoading message="Loading widget data…" />}
                  {(() => {
                    const grouped = {};
                    PHASE_ORDER.forEach((ph) => { grouped[ph] = []; });
                    const uncategorized = [];
                    kpis.forEach((k) => {
                      const ph = k.lifecyclePhase;
                      if (ph && grouped[ph]) grouped[ph].push(k);
                      else uncategorized.push(k);
                    });
                    const hasGrouped = PHASE_ORDER.some((ph) => grouped[ph].length > 0);
                    if (!hasGrouped && uncategorized.length === 0) return null;
                    // Fallback: if no lifecyclePhase at all, render flat grid as before
                    if (!hasGrouped) {
                      return (
                        <div style={CARD_STYLES.grid}>
                          {uncategorized.map((k) => (
                            <KPIWidgetCard
                              key={k.id}
                              kpi={k}
                              data={widgetResults && !widgetResults._error ? widgetResults[k.id] : undefined}
                              onRefresh={refreshSingleWidget}
                              isRefreshing={loadingWidgetId === k.id}
                            />
                          ))}
                        </div>
                      );
                    }
                    return (
                      <>
                        {PHASE_ORDER.map((phase) => {
                          const items = grouped[phase];
                          if (!items.length) return null;
                          return (
                            <div key={phase} style={{ marginBottom: '1.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#212529' }}>
                                  {PHASE_LABELS[phase]}
                                </h4>
                                <span style={{ fontSize: '0.75rem', color: '#6c757d' }}>
                                  {PHASE_SUBTITLE[phase]}
                                </span>
                                <span
                                  style={{
                                    marginLeft: 'auto',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    color: '#495057',
                                    background: '#e9ecef',
                                    borderRadius: '999px',
                                    padding: '0.15rem 0.5rem',
                                  }}
                                >
                                  {items.length} KPI{items.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                              <div style={CARD_STYLES.grid}>
                                {items.map((k) => (
                                  <KPIWidgetCard
                                    key={k.id}
                                    kpi={k}
                                    data={widgetResults && !widgetResults._error ? widgetResults[k.id] : undefined}
                                    onRefresh={refreshSingleWidget}
                                    isRefreshing={loadingWidgetId === k.id}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {uncategorized.length > 0 && (
                          <div style={{ marginBottom: '1.5rem' }}>
                            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 600, color: '#6c757d' }}>Other</h4>
                            <div style={CARD_STYLES.grid}>
                              {uncategorized.map((k) => (
                                <KPIWidgetCard
                                  key={k.id}
                                  kpi={k}
                                  data={widgetResults && !widgetResults._error ? widgetResults[k.id] : undefined}
                                  onRefresh={refreshSingleWidget}
                                  isRefreshing={loadingWidgetId === k.id}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
              {widgetResults && widgetResults._error && (
                <>
                  <p style={CARD_STYLES.error}>
                    {widgetResults._error === 'Team KPIs not found' || (typeof widgetResults._error === 'string' && widgetResults._error.includes('No KPI config'))
                      ? 'No KPIs configured for this team. Add KPIs below or select another team.'
                      : widgetResults._error}
                  </p>
                  <button
                    type="button"
                    onClick={() => fetchWidgetResults()}
                    style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}
                  >
                    Try again
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export { KPIWidgetCard, CARD_STYLES };
