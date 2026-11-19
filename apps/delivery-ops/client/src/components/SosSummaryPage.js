import React, { useState, useMemo } from 'react';
import { getFieldValue } from '../utils/jiraFields';
import { PageLoading } from '../shared/components/PageLoading';
import { useJiraConfig } from '../utils/jiraConfig';
import { formatDateWithHistory } from '../utils/dateHistoryDisplay';
import { formatRiskWithHistory } from '../utils/riskHistoryDisplay';
import ExecSummaryCell from './ExecSummaryCell';
import TaskBreakdownCell from './TaskBreakdownCell';
import ReleaseVersionGantt from './ReleaseVersionGantt';
import SosEmailBar from './SosEmailBar';
import SosTierSummaryBox from './SosTierSummaryBox';
import SosReleaseCharts, { SosRagHeatmap, KpiBreakdownStrip } from './SosReleaseCharts';
import ReleaseVersionFilterBar from './ReleaseVersionFilterBar';
import { useSosSummary, RAG_COLORS } from '../hooks/useSosSummary';
import { SOS_TIERS } from '../hooks/useSosTierSummary';

const STALE_DAYS = 7;

function BulkReviewPanel() { return null; }

function personName(value) {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : (value.displayName || value.name || value.emailAddress || value.email || '');
  const trimmed = String(text).trim();
  if (!trimmed || trimmed === 'N/A' || trimmed === '—') return null;
  return trimmed;
}
function daysOld(dateVal) {
  if (!dateVal) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
const SOS_COLUMNS = [
  { key: 'identity',   label: 'Feature / Initiative', width: '200px' },
  { key: 'state',      label: 'State',                width: '160px' },
  { key: 'dates',      label: 'Dates',                width: '130px' },
  { key: 'aiSummary',  label: 'AI Summary',           width: '300px' },
  { key: 'breakdown',  label: 'Breakdown',            width: '180px' },
];

/** Plain text for Risk Assessment / Path to Green (string or { value }). */
function riskTextField(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return !t || t === 'Not Set' || t === 'N/A' ? null : t;
  }
  if (typeof raw === 'object') {
    const v = raw.value ?? raw.display ?? raw.name ?? null;
    return riskTextField(v);
  }
  return null;
}

// RAG_COLORS imported from hook

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */

function formatDate(val) {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }); }
  catch { return val; }
}

function getRagColor(riskIndicator) {
  if (!riskIndicator) return RAG_COLORS.NotSet;
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '');
  const key = val.split(' ')[0];
  return RAG_COLORS[key] || RAG_COLORS.NotSet;
}

function getRagLabel(riskIndicator) {
  if (!riskIndicator) return 'not set';
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '');
  const key = val.split(' ')[0];
  if (key === 'Red' || key === 'Yellow' || key === 'Green') return key;
  return 'not set';
}


/* ─────────────────────────────────────────────────────────────
   Sub-component: release header gate-date strip
───────────────────────────────────────────────────────────── */

function GateDateStrip({ ganttConfig }) {
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

const SosItemRow = React.memo(function SosItemRow({ item, version, ganttConfig, breakdownDataMap, loadingBreakdowns = false, jiraBaseUrl, checkpointHistory = {} }) {
  const breakdown = breakdownDataMap[item.key] || null;
  const ragColor = getRagColor(getFieldValue(item, 'riskIndicator'));
  const ragLabel = getRagLabel(getFieldValue(item, 'riskIndicator'));
  const riskAssessment = riskTextField(getFieldValue(item, 'riskAssessment'));
  const pathToGreen = riskTextField(getFieldValue(item, 'pathToGreen'));
  const riskTrail = formatRiskWithHistory(item.key, getFieldValue(item, 'riskIndicator'), checkpointHistory);
  const testLead = personName(getFieldValue(item, 'testLead') ?? item.customfield_11065);
  const qaContact = personName(getFieldValue(item, 'qaContact'));
  const pmOwner = personName(getFieldValue(item, 'pmOwner'));
  const programMgr = personName(getFieldValue(item, 'tpmOwner'));

  // Date rows: label → field mapping for the stacked Dates cell
  const DATE_ROWS = [
    { label: 'FS/DS', field: 'fsdsDone',     raw: getFieldValue(item, 'fsdsDone') },
    { label: 'CCM',   field: 'codeComplete',  raw: getFieldValue(item, 'codeComplete') },
    { label: 'CG',    field: 'commitGate',    raw: getFieldValue(item, 'commitGate') },
    { label: 'PG',    field: 'promotionGate', raw: getFieldValue(item, 'promotionGate') },
  ];

  return (
    <tr style={{ borderBottom: '1px solid #eee', verticalAlign: 'top' }}>

      {/* ── Identity: key + summary + assignee stacked ── */}
      <td style={{ padding: '8px 10px', width: '200px' }}>
        <a
          href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${item.key}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1565c0', fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '3px' }}
        >
          {item.key}
        </a>
        <div style={{ fontSize: '11px', color: '#333', lineHeight: '1.4', marginBottom: '4px' }}
             title={item.summary}>
          {item.summary}
        </div>
        {item.assignee && (
          <div style={{ fontSize: '10px', color: '#888' }}>
            👤 {item.assignee}
          </div>
        )}
        {(testLead || qaContact || pmOwner || programMgr) && (
          <div style={{ fontSize: '10px', color: '#888', marginTop: 2 }}>
            {testLead && (
              <div title="Test Lead">🧪 {testLead}</div>
            )}
            {qaContact && qaContact !== testLead && (
              <div title="QA Contact">🧪 QA {qaContact}</div>
            )}
            {pmOwner && (
              <div title="PM Owner">📋 {pmOwner}</div>
            )}
            {programMgr && (
              <div title="Program Mgr">🗂 {programMgr}</div>
            )}
          </div>
        )}
      </td>

      {/* ── State: RAG + history trail + Assessment / Path to Green + status ── */}
      <td style={{ padding: '8px 10px', width: '160px', verticalAlign: 'top' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
          <span
            style={{
              display: 'inline-block', width: '10px', height: '10px',
              borderRadius: '50%', background: ragColor, flexShrink: 0,
            }}
            title={ragLabel}
          />
          <span style={{ fontSize: '11px', fontWeight: 600, color: ragColor }}>
            {ragLabel === 'not set' ? <span style={{ color: '#bbb' }}>—</span> : ragLabel}
          </span>
        </div>
        {riskTrail && (
          <div style={{ marginBottom: '4px' }} title="Risk Indicator history (newest → oldest)">
            {riskTrail}
          </div>
        )}
        {riskAssessment && (
          <div style={{ marginTop: '4px' }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, color: '#aaa',
              textTransform: 'uppercase', letterSpacing: '0.4px',
              display: 'block', marginBottom: '1px',
            }}>
              Assessment
            </span>
            <div
              title={riskAssessment}
              style={{
                fontSize: '10px', color: '#333', lineHeight: 1.35,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: '3.6em', overflow: 'hidden',
              }}
            >
              {riskAssessment}
            </div>
          </div>
        )}
        {pathToGreen && (
          <div style={{ marginTop: '4px' }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, color: '#aaa',
              textTransform: 'uppercase', letterSpacing: '0.4px',
              display: 'block', marginBottom: '1px',
            }}>
              Path to Green
            </span>
            <div
              title={pathToGreen}
              style={{
                fontSize: '10px', color: '#333', lineHeight: 1.35,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: '3.6em', overflow: 'hidden',
              }}
            >
              {pathToGreen}
            </div>
          </div>
        )}
        {!riskAssessment && !pathToGreen && (
          <div style={{ fontSize: '9px', color: '#ccc', marginTop: '2px' }}>
            No assessment / path
          </div>
        )}
        <div style={{ fontSize: '10px', color: '#555', marginTop: '4px', fontStyle: 'italic' }}>
          {item.status || '—'}
        </div>
      </td>

      {/* ── Dates: FS/DS / CCM / CG / PG stacked ── */}
      <td style={{ padding: '8px 10px', width: '130px', verticalAlign: 'top' }}>
        {DATE_ROWS.map(({ label, field, raw }) => (
          <div key={label} style={{ marginBottom: '6px' }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, color: '#aaa',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              display: 'block', marginBottom: '1px',
            }}>
              {label}
            </span>
            <span style={{ fontSize: '11px' }}>
              {raw ? formatDateWithHistory(item.key, field, raw, checkpointHistory) : <span style={{ color: '#ccc' }}>—</span>}
            </span>
          </div>
        ))}
      </td>

      {/* ── AI Exec Summary ── */}
      <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
        <ExecSummaryCell
          item={item}
          selectedVersion={version}
          ganttConfig={ganttConfig}
          breakdownData={breakdown}
          releaseContext={null}
        />
      </td>

      {/* ── Task Breakdown ── */}
      <td style={{ padding: '8px 10px', width: '180px', verticalAlign: 'top' }}>
        <TaskBreakdownCell
          jiraKey={item.key}
          breakdownData={breakdown}
          loading={loadingBreakdowns && !breakdown}
          compact={true}
        />
      </td>

    </tr>
  );
});

/* ─────────────────────────────────────────────────────────────
   Sub-component: items table (Features or Initiatives)
───────────────────────────────────────────────────────────── */

function SosItemsTable({ items, version, ganttConfig, breakdownDataMap, loadingBreakdowns = false, jiraBaseUrl, checkpointHistory = {} }) {
  if (!items || items.length === 0) {
    return <p style={{ color: '#aaa', fontSize: '12px', padding: '8px 0' }}>No tickets found.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '900px' }}>
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
              loadingBreakdowns={loadingBreakdowns}
              jiraBaseUrl={jiraBaseUrl}
              checkpointHistory={checkpointHistory}
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

export function ReleaseSection({
  version,
  items,
  breakdownDataMap,
  loadingBreakdowns = false,
  jiraBaseUrl,
  onRefresh,
  refreshDisabled = false,
  checkpointHistory = {},
  gateData = null,
  tierSummaries = null,
  projectStatus = null,
  onRetryTier = null,
  /** When true, treat missing tier state as loading (SoS Summary auto-gen). */
  autoTierSummary = false,
  /** When false, hide FEAT / Standalone / Direct boxes (SoS by Leader). */
  showTierSummary = true,
  kpiData = null,
  kpiLoading = false,
  kpiError = null,
  ganttConfigFromDates = null,  // Per-version config from /api/config/release-dates (drives ReleaseVersionGantt)
  productId = '',
}) {
  // Convert gate data to ganttConfig format for compatibility with existing components
  const ganttConfig = useMemo(() => {
    if (!gateData || !gateData.gates || !Array.isArray(gateData.gates)) return null;
    
    // Convert gate data format to match what GateDateStrip expects
    // Gate data has: { kind, label, iso, color, style, source, past }
    const config = {};
    gateData.gates.forEach((gate) => {
      if (gate.kind && gate.iso) {
        switch (gate.kind.toUpperCase()) {
          case 'CC':
            config.codeCompleteDate = gate.iso;
            break;
          case 'CG':
            config.commitGateDate = gate.iso;
            break;
          case 'PG':
            config.promotionGateDate = gate.iso;
            break;
          case 'GA':
            config.gaDate = gate.iso;
            break;
          case 'EC':
            // EC (Early Commitment) doesn't have a field in GateDateStrip, but we can track it
            config.ecDate = gate.iso;
            break;
          default:
            break;
        }
      }
    });
    
    // Return in format expected by GateDateStrip component
    return { [version]: config };
  }, [gateData, version]);

  const features = useMemo(() => items.filter((i) => (i.issuetype || i.issueType || '').toLowerCase() === 'feature'), [items]);
  const initiatives = useMemo(() => items.filter((i) => (i.issuetype || i.issueType || '').toLowerCase() === 'initiative'), [items]);

  const ragCounts = useMemo(() => {
    const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
    items.forEach((i) => {
      const raw = typeof getFieldValue(i, 'riskIndicator') === 'string' ? getFieldValue(i, 'riskIndicator') : (getFieldValue(i, 'riskIndicator')?.value || '');
      const v = String(raw).split(' ')[0];
      if (v === 'Red' || v === 'Yellow' || v === 'Green') counts[v]++;
      else counts.NotSet++;
    });
    return counts;
  }, [items]);

  const overallRag = ragCounts.Red > 0 ? 'Red' : ragCounts.Yellow > 0 ? 'Yellow' : ragCounts.Green > 0 ? 'Green' : 'NotSet';
  const ragColor = RAG_COLORS[overallRag] || RAG_COLORS.NotSet;

  // Status-update staleness (customfield_45660): missing or ≥ STALE_DAYS old.
  const staleItems = useMemo(() => {
    return (items || []).filter((item) => {
      const age = daysOld(getFieldValue(item, 'statusUpdateDate'));
      return age === null || age >= STALE_DAYS;
    });
  }, [items]);
  const staleCount = staleItems.length;

  const TIER_TITLES = {
    feat: 'FEAT Work',
    standalone: 'Standalone Epics',
    direct: 'Direct Tickets',
  };

  return (
    <div style={{
      border: '1px solid #ddd', borderRadius: '8px', marginBottom: '24px',
      padding: '16px', background: '#fafafa',
    }}>
      {/* Release header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#1a1a2e', fontWeight: 700 }}>{version}</h3>
            {items.length > 0 && (
              <span style={{
                background: ragColor, color: '#fff', borderRadius: '4px',
                padding: '1px 8px', fontSize: '11px', fontWeight: 700,
              }}>
                {overallRag === 'NotSet' ? 'not set' : overallRag}
              </span>
            )}
            {staleCount > 0 && (
              <span
                title={
                  `${staleCount} Feature/Initiative${staleCount === 1 ? '' : 's'} with status update ` +
                  `missing or ≥${STALE_DAYS} days old — dig into these projects:\n` +
                  staleItems.slice(0, 12).map((i) => i.key).join(', ') +
                  (staleItems.length > 12 ? ` (+${staleItems.length - 12} more)` : '')
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: '#fff3e0',
                  color: '#bf360c',
                  border: '2px solid #e65100',
                  borderRadius: 4,
                  padding: '2px 10px',
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.02em',
                  boxShadow: '0 0 0 2px rgba(230, 81, 0, 0.15)',
                  cursor: 'help',
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 13 }}>⚠</span>
                {staleCount} stale update{staleCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <GateDateStrip ganttConfig={ganttConfig} />
          {/* KPI breakdown per release — only mount when loading or data is present; errors are silently suppressed inside KpiBreakdownStrip */}
          {(kpiData || kpiLoading) && (
            <KpiBreakdownStrip
              kpiData={kpiData}
              loading={kpiLoading}
              error={kpiError}
              jiraBaseUrl={jiraBaseUrl}
            />
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={onRefresh}
            disabled={refreshDisabled}
            title="Refresh from JIRA"
            style={{
              fontSize: '11px', border: '1px solid #ccc', borderRadius: '4px',
              background: '#fff', color: '#555', padding: '3px 8px',
              cursor: refreshDisabled ? 'not-allowed' : 'pointer',
              opacity: refreshDisabled ? 0.6 : 1,
            }}
          >
            {refreshDisabled ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Per-release gate timeline — reuses ReleaseVersionGantt (timelineOnly) so the
          visual language (binding vs soft gates, Today bubble, proportional spacing)
          is identical to Project Status. Only shown when release-dates config exists. */}
      {ganttConfigFromDates && (
        <div style={{ marginBottom: '12px' }}>
          <ReleaseVersionGantt
            ganttConfig={ganttConfigFromDates}
            selectedVersion={version}
            items={{ commit: [], longTermFunded: [] }}
            checkpointHistory={{}}
            sortItems={(arr) => arr}
            sprintDates={[]}
            timelineOnly={true}
          />
        </div>
      )}

      {showTierSummary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          {SOS_TIERS.map((tier) => (
            <SosTierSummaryBox
              key={tier}
              title={TIER_TITLES[tier]}
              tierState={tierSummaries?.[tier] || { state: autoTierSummary ? 'loading' : 'idle' }}
              onRetry={onRetryTier ? () => onRetryTier(tier) : null}
            />
          ))}
        </div>
      )}

      <SosReleaseCharts
        ragCounts={ragCounts}
        gateData={gateData}
        projectStatus={projectStatus}
        items={items}
        release={version}
        productId={productId}
        jiraBaseUrl={jiraBaseUrl}
      />

      {/* Features */}
      <CollapsibleSection title="Features" count={features.length} accentColor="#1565c0">
        <SosItemsTable
          items={features}
          version={version}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          loadingBreakdowns={loadingBreakdowns}
          jiraBaseUrl={jiraBaseUrl}
          checkpointHistory={checkpointHistory}
        />
      </CollapsibleSection>

      {/* Initiatives */}
      <CollapsibleSection title="Initiatives" count={initiatives.length} accentColor="#6a1b9a">
        <SosItemsTable
          items={initiatives}
          version={version}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          loadingBreakdowns={loadingBreakdowns}
          jiraBaseUrl={jiraBaseUrl}
          checkpointHistory={checkpointHistory}
        />
      </CollapsibleSection>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */



function SosSummaryPage() {
  const { jiraBaseUrl } = useJiraConfig();
  const s = useSosSummary();
  const RAG_CHIP_STYLE = (rag, active) => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
    cursor: 'pointer', userSelect: 'none',
    border: `1px solid ${RAG_COLORS[rag] || '#9e9e9e'}`,
    background: active ? (RAG_COLORS[rag] || '#9e9e9e') : '#fff',
    color: active ? '#fff' : (RAG_COLORS[rag] || '#9e9e9e'),
    transition: 'all 0.15s',
  });
  const RAG_LABELS = { Red: 'Red', Yellow: 'Yellow', Green: 'Green', NotSet: 'Not Set' };
  const RAG_FILTER_OPTIONS = ['Red', 'Yellow', 'Green', 'NotSet'];
  return (
    <div>
        {s.sortedVersions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginBottom: '14px', padding: '8px 12px', background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>Release:</span>
              {s.sortedVersions.map((v) => (
                <button key={v} type="button" onClick={() => s.toggleVersion(v)} style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: '1px solid #6a1b9a', userSelect: 'none', background: s.selectedVersions.includes(v) ? '#6a1b9a' : '#fff', color: s.selectedVersions.includes(v) ? '#fff' : '#6a1b9a', transition: 'all 0.15s' }}>{v}</button>
              ))}
              {s.selectedVersions.length > 0 && <button type="button" onClick={() => s.setSelectedVersions([])} style={{ fontSize: '10px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', padding: '0 2px' }}>✕ clear</button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>RAG:</span>
              {RAG_FILTER_OPTIONS.map((rag) => <button key={rag} type="button" onClick={() => s.toggleRag(rag)} style={RAG_CHIP_STYLE(rag, s.selectedRags.includes(rag))}>{RAG_LABELS[rag]}</button>)}
              {s.selectedRags.length > 0 && <button type="button" onClick={() => s.setSelectedRags([])} style={{ fontSize: '10px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', padding: '0 2px' }}>✕ clear</button>}
            </div>
            {s.eraComponents.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>Component:</span>
                <select value={s.selectedComponent} onChange={(e) => s.setSelectedComponent(e.target.value)} style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #ced4da', background: '#fff', color: '#333', cursor: 'pointer' }}>
                  <option value="">All</option>{s.eraComponents.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {s.selectedComponent && <button type="button" onClick={() => s.setSelectedComponent('')} style={{ fontSize: '10px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', padding: '0 2px' }}>✕</button>}
              </div>
            )}
            {(s.selectedVersions.length > 0 || s.selectedRags.length > 0 || s.selectedComponent) && <span style={{ fontSize: '11px', color: '#888', marginLeft: 'auto' }}>Showing {s.visibleVersions.length} of {s.sortedVersions.length} releases</span>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div><h2 style={{ margin: 0, fontSize: '18px', color: '#1a1a2e', fontWeight: 700 }}>📡 SoS Summary</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>Feature &amp; Initiative status across active releases{s.source === 'cache' && s.lastSyncIso ? ` · showing cached dataset (synced ${new Date(s.lastSyncIso).toLocaleString()})` : s.source === 'jira' ? ' · live from JIRA' : ''}</p></div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!s.loading && s.needsCount > 0 && <button onClick={s.handleBatchGenerate} disabled={s.batchRunning} style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '5px', border: '1px solid #6a1b9a', background: s.batchRunning ? '#f3e5f5' : '#6a1b9a', color: s.batchRunning ? '#6a1b9a' : '#fff', cursor: s.batchRunning ? 'not-allowed' : 'pointer', fontWeight: 600 }}>{s.batchRunning ? `✨ Generating… ${s.batchProgress?.done ?? 0}/${s.batchProgress?.total ?? s.needsCount} (${s.batchProgress?.current || ''})` : `✨ Generate All (${s.needsCount})`}</button>}
            {!s.loading && s.needsCount === 0 && s.sortedVersions.length > 0 && <span style={{ fontSize: '11px', color: '#388e3c', fontWeight: 600 }}>✓ All summaries fresh</span>}
            <SosEmailBar byVersion={s.byVersion} breakdownDataMap={s.breakdownDataMap} gateDataMap={s.gateDataMap} checkpointHistory={s.checkpointHistory} jiraBaseUrl={jiraBaseUrl} sortedVersions={s.sortedVersions} tierSummaries={s.tierSummaries} disabled={s.loading || s.sortedVersions.length === 0} />
            <button onClick={() => s.fetchAll(s.selectedTeamId, { forceLive: true })} disabled={s.loading} style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '5px', border: '1px solid #1565c0', background: '#1565c0', color: '#fff', cursor: s.loading ? 'not-allowed' : 'pointer', opacity: s.loading ? 0.6 : 1 }}>{s.loading ? 'Loading…' : '↻ Refresh All'}</button>
          </div>
        </div>
        {s.loading && <PageLoading message="Loading SoS items…" />}
        {s.loadingGates && !s.loading && <PageLoading inline message="Loading gate data…" />}
        {!s.loading && s.source === 'cache' && <p style={{ color: s.degraded ? '#856404' : '#555', background: s.degraded ? '#fff3cd' : '#f1f3f5', border: `1px solid ${s.degraded ? '#ffc107' : '#dee2e6'}`, borderRadius: '4px', padding: '8px 12px', fontSize: '12px', marginBottom: '16px' }}>{s.degraded ? 'JIRA is rate-limited, so this view is from the last synced dataset. Wait a minute, then click Refresh All for live data.' : 'Showing the last synced dataset. Click Refresh All to pull live JIRA.'}</p>}
        {s.error && !s.loading && <p style={{ color: '#d32f2f', fontSize: '13px' }}>{s.error}&nbsp;<button onClick={() => s.fetchAll(s.selectedTeamId)} style={{ fontSize: '12px', border: 'none', background: 'none', color: '#1565c0', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button></p>}
        {!s.loading && !s.error && s.sortedVersions.length === 0 && <p style={{ color: '#aaa', fontSize: '13px' }}>No items found. Click ↻ Refresh All to load from JIRA.</p>}
        {!s.loading && !s.error && s.sortedVersions.length > 0 && s.visibleVersions.length === 0 && <p style={{ color: '#aaa', fontSize: '13px' }}>No releases match the active filters.</p>}
        {s.generateError && <p style={{ color: '#d32f2f', fontSize: '12px', marginBottom: 12 }}>{s.generateError}</p>}
        <SosRagHeatmap byVersion={s.byVersion} sortedVersions={s.activeVersions} defaultOpen={false} />
        <BulkReviewPanel pendingReviews={s.pendingReviews} onPushOne={s.pushOne} onDiscardOne={s.discardOne} onPushAll={s.pushAll} onDiscardAll={s.discardAll} onRegenerateOne={s.regenerateOne} />
        {!s.loading && !s.error && s.allSosItems.length > 0 && <ReleaseVersionFilterBar items={{ commit: s.allSosItems, longTermFunded: [] }} activeFilters={s.sosFilters} onFilterChange={s.handleSosFilterChange} activeSection="" onSectionChange={() => {}} showSection={false} totalCount={s.allSosItems.length} filteredCount={s.filteredSosCount} />}
        {!s.loading && !s.error && s.hasSosFilters && s.displayVersions.length === 0 && <p style={{ color: '#aaa', fontSize: '13px' }}>No items match the current filters.</p>}
        {s.displayVersions.map((version) => (
          <ReleaseSection key={version} version={version} items={s.filterItemsByComponent(s.filteredByVersion[version] || [])} breakdownDataMap={s.breakdownDataMap} loadingBreakdowns={s.loadingBreakdowns} jiraBaseUrl={jiraBaseUrl} onRefresh={() => s.fetchAll(s.selectedTeamId)} refreshDisabled={s.loading} checkpointHistory={s.checkpointHistory} gateData={s.gateDataMap[version] || null} tierSummaries={s.tierSummaries[version] || null} projectStatus={s.projectStatusByRelease[version] || null} onRetryTier={(tier) => s.handleRetryTier(version, tier)} autoTierSummary kpiData={s.kpiDataByRelease[version] || null} kpiLoading={s.kpiLoadingByRelease[version] || false} kpiError={s.kpiErrorByRelease[version] || null} ganttConfigFromDates={s.releaseDatesConfig[version] || null} productId={s.productId} />
        ))}
    </div>
  );
}
export default SosSummaryPage;
// Backward-compat re-exports for SosLeaderSummaryPage
export { useMultiReleaseGateData, useReleaseDatesConfig } from '../hooks/useSosSummary';
