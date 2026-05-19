/**
 * Trends & risk section: snapshot save, risk pie chart, tasks-over-time trend, risk indicator changes.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import { authenticatedPost, authenticatedGet } from '../utils/api';

const RISK_COLORS = {
  Green: '#28a745',
  Yellow: '#ffc107',
  Red: '#dc3545',
  'Not Set': '#adb5bd'
};

const COMPLETED_STATUSES = ['DONE', 'CLOSED', 'RESOLVED', 'COMPLETED'];

function getStatusDisplay(item) {
  const raw = item?.status;
  if (raw == null) return '';
  return typeof raw === 'string' ? raw : (raw?.name || raw?.value || '');
}

function isCompleted(item) {
  const s = String(getStatusDisplay(item)).toUpperCase().trim();
  return COMPLETED_STATUSES.some((c) => s === c);
}

function getIssueType(item) {
  const raw = item?.issuetype;
  if (raw == null) return '';
  return typeof raw === 'string' ? raw : (raw?.name || raw?.value || '');
}

function getRiskLabel(item) {
  const raw = item && item.customfield_23560;
  if (!raw) return 'Not Set';
  const value = typeof raw === 'object' ? (raw.value || raw.name || '') : String(raw);
  const color = typeof raw === 'object' ? (raw.color || '').toLowerCase() : '';
  const v = (value || '').toLowerCase();
  if (color === '#dc3545' || color === 'red' || v.includes('red') || v.includes('high') || v.includes('critical')) return 'Red';
  if (color === '#ffc107' || color === 'yellow' || v.includes('yellow') || v.includes('medium') || v.includes('at risk')) return 'Yellow';
  if (color === '#28a745' || color === 'green' || v.includes('green') || v.includes('on track') || v.includes('low')) return 'Green';
  return 'Not Set';
}

function buildPieData(items) {
  const counts = { Green: 0, Yellow: 0, Red: 0, 'Not Set': 0 };
  (items || []).forEach((item) => {
    const label = getRiskLabel(item);
    if (counts[label] !== undefined) counts[label]++;
  });
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, value]) => ({ name, value, fill: RISK_COLORS[name] || '#adb5bd' }));
}

export default function ReleaseVersionTrends({
  selectedVersion,
  items,
  jiraToken,
  username
}) {
  const allItems = [...(items?.commit || []), ...(items?.longTermFunded || [])];
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  const [snapshotSuccess, setSnapshotSuccess] = useState(false);
  const [trends, setTrends] = useState(null);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [riskChanges, setRiskChanges] = useState(null);
  const [riskChangesLoading, setRiskChangesLoading] = useState(false);

  const handleSaveSnapshot = useCallback(async () => {
    if (!selectedVersion || !allItems.length) {
      setSnapshotError('Select a version and load items first.');
      return;
    }
    setSnapshotError('');
    setSnapshotSuccess(false);
    setSavingSnapshot(true);
    try {
      await authenticatedPost(
        '/api/status-snapshots',
        { fixVersion: selectedVersion, items: allItems },
        { jiraToken, username }
      );
      setSnapshotSuccess(true);
      setTrends(null);
      setTimeout(() => setSnapshotSuccess(false), 3000);
    } catch (err) {
      setSnapshotError(err.response?.data?.error || err.message || 'Failed to save snapshot');
    } finally {
      setSavingSnapshot(false);
    }
  }, [selectedVersion, allItems, jiraToken, username]);

  const loadTrends = useCallback(async () => {
    if (!selectedVersion) return;
    setTrendsLoading(true);
    setTrends(null);
    try {
      const res = await authenticatedGet(
        '/api/status-snapshots/trends',
        { fixVersion: selectedVersion },
        { jiraToken, username }
      );
      if (res.data && res.data.success && res.data.data) setTrends(res.data.data);
    } catch (err) {
      console.warn('Failed to load trends', err);
    } finally {
      setTrendsLoading(false);
    }
  }, [selectedVersion, jiraToken, username]);

  const loadRiskChanges = useCallback(async () => {
    if (!selectedVersion) return;
    setRiskChangesLoading(true);
    setRiskChanges(null);
    try {
      const res = await authenticatedPost(
        '/api/jira/risk-indicator-changes',
        { fixVersion: selectedVersion },
        { jiraToken, username }
      );
      if (res.data && res.data.success && res.data.data) setRiskChanges(res.data.data);
    } catch (err) {
      console.warn('Failed to load risk changes', err);
    } finally {
      setRiskChangesLoading(false);
    }
  }, [selectedVersion, jiraToken, username]);

  const pieData = buildPieData(allItems);
  const hasCharts = pieData.length > 0;

  const vpMetrics = useMemo(() => {
    const total = allItems.length;
    const completed = allItems.filter(isCompleted).length;
    const outstanding = total - completed;
    const bugs = allItems.filter((i) => getIssueType(i) === 'Bug').length;
    const improvements = allItems.filter((i) => getIssueType(i) === 'Improvement').length;
    const inCurrentSprint = allItems.filter((i) => i.sprintState === 'active').length;
    const forgotten = allItems.filter((i) => !isCompleted(i) && i.sprintState === 'closed').length;
    return { total, completed, outstanding, bugs, improvements, inCurrentSprint, forgotten };
  }, [allItems]);

  return (
    <div className="release-version-trends" style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #dee2e6', borderRadius: '8px', backgroundColor: '#f8f9fa' }}>
      <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem' }}>Trends & risk</h3>

      {allItems.length > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.875rem' }}>
          <span><strong>Scope:</strong> {vpMetrics.total}</span>
          <span><strong>Outstanding:</strong> {vpMetrics.outstanding}</span>
          <span><strong>Bugs:</strong> {vpMetrics.bugs}</span>
          <span><strong>Improvements:</strong> {vpMetrics.improvements}</span>
          <span><strong>In current sprint:</strong> {vpMetrics.inCurrentSprint}</span>
          {vpMetrics.forgotten > 0 && (
            <span style={{ color: '#856404', fontWeight: 600 }}><strong>Forgotten (open in past sprint):</strong> {vpMetrics.forgotten}</span>
          )}
        </div>
      )}

      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleSaveSnapshot}
          disabled={savingSnapshot || !selectedVersion || !allItems.length}
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem' }}
        >
          {savingSnapshot ? 'Saving…' : 'Save snapshot'}
        </button>
        {snapshotSuccess && <span style={{ color: '#28a745', fontSize: '0.875rem' }}>Snapshot saved.</span>}
        {snapshotError && <span style={{ color: '#dc3545', fontSize: '0.875rem' }}>{snapshotError}</span>}
        <button
          type="button"
          onClick={loadTrends}
          disabled={trendsLoading || !selectedVersion}
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem' }}
        >
          {trendsLoading ? 'Loading…' : 'Load trends'}
        </button>
        <button
          type="button"
          onClick={loadRiskChanges}
          disabled={riskChangesLoading || !selectedVersion}
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem' }}
        >
          {riskChangesLoading ? 'Loading…' : 'Risk moves'}
        </button>
      </div>

      {hasCharts && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Risk distribution (current)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {trends && trends.points && trends.points.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Tasks over time</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={trends.points.map((p) => ({
                ...p,
                dateShort: new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
              }))}
              margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dateShort" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value, name) => [value, name === 'total' ? 'Total tasks' : name]}
                labelFormatter={(label, payload) => payload[0]?.payload?.date ? new Date(payload[0].payload.date).toLocaleString() : label}
              />
              <Bar dataKey="total" name="total" fill="#0d6efd" radius={[4, 4, 0, 0]} />
              {trends.prediction && trends.prediction.nextTotal != null && (
                <Legend payload={[{ value: `Next (pred.): ${trends.prediction.nextTotal}`, type: 'line' }]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {trendsLoading && !trends && <p style={{ color: '#6c757d', fontSize: '0.875rem' }}>Loading trends…</p>}
      {!trendsLoading && trends && (!trends.points || trends.points.length === 0) && (
        <p style={{ color: '#6c757d', fontSize: '0.875rem' }}>No snapshots yet. Save a snapshot to see trends.</p>
      )}

      {riskChanges && riskChanges.changes && (
        <div>
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Risk indicator changes</h4>
          {riskChanges.changes.length === 0 ? (
            <p style={{ color: '#6c757d', fontSize: '0.875rem' }}>No risk changes found for this version.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '280px', overflowY: 'auto' }}>
              {riskChanges.changes.map((c, i) => (
                <li
                  key={`${c.key}-${c.changedAt}-${i}`}
                  style={{
                    padding: '0.35rem 0',
                    borderBottom: '1px solid #eee',
                    fontSize: '0.8rem'
                  }}
                >
                  <strong>{c.key}</strong> — {c.fromRisk} → {c.toRisk}
                  <span style={{ color: '#6c757d', marginLeft: '0.5rem' }}>
                    {new Date(c.changedAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {riskChangesLoading && !riskChanges && <p style={{ color: '#6c757d', fontSize: '0.875rem' }}>Loading risk changes…</p>}
    </div>
  );
}
