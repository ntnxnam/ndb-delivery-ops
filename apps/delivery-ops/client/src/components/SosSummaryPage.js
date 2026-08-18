/**
 * SoS Summary Page — Scrum of Scrums status view for engineering leadership.
 *
 * Shows all active releases in one scrollable view. Each release section has:
 *   - Features subsection with AI exec summary + task breakdown per row
 *   - Initiatives subsection (same columns)
 *   - KPI widgets subsection (lazy-loaded)
 * A compose panel at the bottom handles drafting and sending the SoS email.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useReleaseVersions } from '../hooks/useReleaseVersions';
import { useAllVersionsConfig } from '../hooks/useGanttConfig';
import { useSosItems } from '../hooks/useSosItems';
import { useJiraConfig } from '../utils/jiraConfig';
import ExecSummaryCell from './ExecSummaryCell';
import TaskBreakdownCell from './TaskBreakdownCell';

/* ─────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────── */

const SOS_COLUMNS = [
  { key: 'key',        label: 'Key',        width: '90px' },
  { key: 'summary',    label: 'Summary',    width: '220px' },
  { key: 'status',     label: 'Status',     width: '100px' },
  { key: 'risk',       label: 'Risk',       width: '70px' },
  { key: 'ccDate',     label: 'CC',         width: '90px' },
  { key: 'cgDate',     label: 'CG',         width: '90px' },
  { key: 'pgDate',     label: 'PG',         width: '90px' },
  { key: 'assignee',   label: 'Assignee',   width: '110px' },
  { key: 'aiSummary',  label: 'AI Summary', width: '260px' },
  { key: 'breakdown',  label: 'Breakdown',  width: '180px' },
];

const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c' };

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */

function formatDate(val) {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }); }
  catch { return val; }
}

function getRagColor(riskIndicator) {
  if (!riskIndicator) return '#9e9e9e';
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '');
  return RAG_COLORS[val] || '#9e9e9e';
}

function getRagLabel(riskIndicator) {
  if (!riskIndicator) return '?';
  return typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '?');
}

function getReleaseGanttConfig(allVersionsConfig, version) {
  if (!allVersionsConfig || !version) return null;
  return allVersionsConfig[version] || null;
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: release header gate-date strip
───────────────────────────────────────────────────────────── */

function GateDateStrip({ version, ganttConfig }) {
  if (!ganttConfig) return null;
  const gates = [];
  const addGate = (label, key) => {
    const entries = Object.values(ganttConfig).filter(g => g[key]);
    if (entries.length > 0) gates.push({ label, date: entries[0][key] });
  };
  addGate('CC', 'codeCompleteDate');
  addGate('CG', 'commitGateDate');
  addGate('PG', 'promotionGateDate');
  addGate('GA', 'gaDate');

  if (gates.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
      {gates.map(({ label, date }) => (
        <span key={label} style={{ fontSize: '11px', color: '#555' }}>
          <strong style={{ color: '#333' }}>{label}</strong> {formatDate(date)}
        </span>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: single item row
───────────────────────────────────────────────────────────── */

function SosItemRow({ item, version, ganttConfig, breakdownDataMap, jiraBaseUrl }) {
  const breakdown = breakdownDataMap[item.key] || null;
  const ragColor = getRagColor(item.customfield_23560);
  const ragLabel = getRagLabel(item.customfield_23560);

  return (
    <tr style={{ borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
      {/* Key */}
      <td style={{ padding: '6px 8px', width: '90px', whiteSpace: 'nowrap' }}>
        <a
          href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${item.key}` : `#`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1565c0', fontSize: '12px', fontWeight: 600 }}
        >
          {item.key}
        </a>
      </td>
      {/* Summary */}
      <td style={{ padding: '6px 8px', fontSize: '12px', maxWidth: '220px' }}>
        <span title={item.summary}>{item.summary}</span>
      </td>
      {/* Status */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#444' }}>
        {item.status || '—'}
      </td>
      {/* Risk */}
      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: ragColor,
            verticalAlign: 'middle',
            title: ragLabel,
          }}
          title={ragLabel}
        />
      </td>
      {/* CC */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
        {formatDate(item.customfield_11067)}
      </td>
      {/* CG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
        {formatDate(item.customfield_35863)}
      </td>
      {/* PG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
        {formatDate(item.customfield_35864)}
      </td>
      {/* Assignee */}
      <td style={{ padding: '6px 8px', fontSize: '11px', color: '#444', whiteSpace: 'nowrap' }}>
        {item.assignee || '—'}
      </td>
      {/* AI Exec Summary */}
      <td style={{ padding: '6px 8px', minWidth: '260px' }}>
        <ExecSummaryCell
          item={item}
          selectedVersion={version}
          ganttConfig={ganttConfig}
          breakdownData={breakdown}
          releaseContext={null}
        />
      </td>
      {/* Task Breakdown */}
      <td style={{ padding: '6px 8px', minWidth: '180px' }}>
        <TaskBreakdownCell
          jiraKey={item.key}
          breakdownData={breakdown}
          loading={!breakdown}
          compact={true}
        />
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: items table (Features or Initiatives)
───────────────────────────────────────────────────────────── */

function SosItemsTable({ items, version, ganttConfig, breakdownDataMap, jiraBaseUrl, loading, error, onRetry }) {
  if (loading) {
    return <p style={{ color: '#888', fontSize: '12px', padding: '8px 0' }}>Loading…</p>;
  }
  if (error) {
    return (
      <p style={{ color: '#d32f2f', fontSize: '12px', padding: '8px 0' }}>
        {error}&nbsp;
        <button
          onClick={onRetry}
          style={{ fontSize: '11px', border: 'none', background: 'none', color: '#1565c0', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Retry
        </button>
      </p>
    );
  }
  if (!items || items.length === 0) {
    return <p style={{ color: '#aaa', fontSize: '12px', padding: '8px 0' }}>No tickets found.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '1100px' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
            {SOS_COLUMNS.map((col) => (
              <th key={col.key} style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <SosItemRow
              key={item.key}
              item={item}
              version={version}
              ganttConfig={ganttConfig}
              breakdownDataMap={breakdownDataMap}
              jiraBaseUrl={jiraBaseUrl}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: collapsible section
───────────────────────────────────────────────────────────── */

function CollapsibleSection({ title, count, defaultOpen = true, children, accentColor = '#1565c0' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '16px' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '13px', fontWeight: 600, color: accentColor, padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px' }}>{open ? '▾' : '▸'}</span>
        {title}
        {count != null && (
          <span style={{
            background: accentColor, color: '#fff', borderRadius: '10px',
            padding: '1px 7px', fontSize: '10px', fontWeight: 600,
          }}>
            {count}
          </span>
        )}
      </button>
      {open && <div style={{ marginTop: '8px' }}>{children}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: per-release section
───────────────────────────────────────────────────────────── */

function ReleaseSection({ version, allVersionsConfig, itemsByRelease, loadingByRelease, errorByRelease, breakdownDataMap, jiraBaseUrl, onRetry }) {
  const items = itemsByRelease[version] || [];
  const loading = !!loadingByRelease[version];
  const error = errorByRelease[version] || null;

  const ganttConfig = useMemo(() => getReleaseGanttConfig(allVersionsConfig, version), [allVersionsConfig, version]);

  const features = useMemo(() => items.filter((i) => i.issuetype?.toLowerCase() === 'feature'), [items]);
  const initiatives = useMemo(() => items.filter((i) => i.issuetype?.toLowerCase() === 'initiative'), [items]);

  // Derive a rough RAG from items
  const ragCounts = useMemo(() => {
    const counts = { Red: 0, Yellow: 0, Green: 0 };
    items.forEach((i) => {
      const v = typeof i.customfield_23560 === 'string' ? i.customfield_23560 : (i.customfield_23560?.value || '');
      if (v in counts) counts[v]++;
    });
    return counts;
  }, [items]);

  const overallRag = ragCounts.Red > 0 ? 'Red' : ragCounts.Yellow > 0 ? 'Yellow' : 'Green';
  const ragColor = RAG_COLORS[overallRag] || '#9e9e9e';

  return (
    <div style={{
      border: '1px solid #ddd', borderRadius: '8px', marginBottom: '24px',
      padding: '16px', background: '#fafafa',
    }}>
      {/* Release header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#1a1a2e', fontWeight: 700 }}>{version}</h3>
            {!loading && items.length > 0 && (
              <span style={{
                background: ragColor, color: '#fff', borderRadius: '4px',
                padding: '1px 8px', fontSize: '11px', fontWeight: 700,
              }}>
                {overallRag}
              </span>
            )}
          </div>
          <GateDateStrip version={version} ganttConfig={ganttConfig} />
        </div>
        <button
          onClick={() => onRetry(version)}
          title="Refresh from JIRA"
          style={{
            fontSize: '11px', border: '1px solid #ccc', borderRadius: '4px',
            background: '#fff', color: '#555', cursor: 'pointer', padding: '3px 8px',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Features */}
      <CollapsibleSection title="Features" count={loading ? null : features.length} accentColor="#1565c0">
        <SosItemsTable
          items={features}
          version={version}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          jiraBaseUrl={jiraBaseUrl}
          loading={loading}
          error={error}
          onRetry={() => onRetry(version)}
        />
      </CollapsibleSection>

      {/* Initiatives */}
      <CollapsibleSection title="Initiatives" count={loading ? null : initiatives.length} defaultOpen={false} accentColor="#6a1b9a">
        <SosItemsTable
          items={initiatives}
          version={version}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          jiraBaseUrl={jiraBaseUrl}
          loading={loading}
          error={error}
          onRetry={() => onRetry(version)}
        />
      </CollapsibleSection>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */

function SosSummaryPage() {
  const { activeVersions, loadingVersions } = useReleaseVersions();
  const { allVersionsConfig } = useAllVersionsConfig();
  const { jiraBaseUrl } = useJiraConfig();

  const {
    itemsByRelease,
    loadingByRelease,
    errorByRelease,
    breakdownDataMap,
    fetchAll,
    refreshRelease,
  } = useSosItems();

  // Filter to real release versions (skip catch-all like "master", "Era Future")
  const releaseVersions = useMemo(
    () => (activeVersions || []).filter((v) => /^[A-Z]+-\d/.test(v)),
    [activeVersions]
  );

  // Fetch all on mount (and when the version list changes)
  useEffect(() => {
    if (releaseVersions.length > 0) {
      fetchAll(releaseVersions, 'ndb');
    }
  }, [releaseVersions, fetchAll]);

  const handleRefresh = useCallback(async (version) => {
    await refreshRelease(version, 'ndb');
  }, [refreshRelease]);

  const handleRefreshAll = useCallback(() => {
    if (releaseVersions.length > 0) {
      fetchAll(releaseVersions, 'ndb');
    }
  }, [releaseVersions, fetchAll]);

  const anyLoading = useMemo(
    () => loadingVersions || releaseVersions.some((v) => !!loadingByRelease[v]),
    [loadingVersions, releaseVersions, loadingByRelease]
  );

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#1a1a2e', fontWeight: 700 }}>
            📡 SoS Summary
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
            Live Feature &amp; Initiative status across all active releases · data fetched directly from JIRA
          </p>
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={anyLoading}
          style={{
            padding: '6px 14px', fontSize: '12px', borderRadius: '5px',
            border: '1px solid #1565c0', background: '#1565c0', color: '#fff',
            cursor: anyLoading ? 'not-allowed' : 'pointer', opacity: anyLoading ? 0.6 : 1,
          }}
        >
          {anyLoading ? 'Loading…' : '↻ Refresh All'}
        </button>
      </div>

      {/* Versions list */}
      {loadingVersions ? (
        <p style={{ color: '#888', fontSize: '13px' }}>Loading release versions…</p>
      ) : releaseVersions.length === 0 ? (
        <p style={{ color: '#aaa', fontSize: '13px' }}>No active release versions found.</p>
      ) : (
        releaseVersions.map((version) => (
          <ReleaseSection
            key={version}
            version={version}
            allVersionsConfig={allVersionsConfig}
            itemsByRelease={itemsByRelease}
            loadingByRelease={loadingByRelease}
            errorByRelease={errorByRelease}
            breakdownDataMap={breakdownDataMap}
            jiraBaseUrl={jiraBaseUrl}
            onRetry={handleRefresh}
          />
        ))
      )}
    </div>
  );
}

export default SosSummaryPage;
