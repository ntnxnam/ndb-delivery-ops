/**
 * SosReleaseCharts — compact inline charts for one SoS release section.
 * All data from props; no fetch. Inline SVG/HTML only (no chart lib).
 *
 * Charts:
 *  1. RAG donut (clickable → JIRA)
 *  2. Gate countdown bars (clickable → JIRA)
 *  3. Outstanding-by-issue-type stacked bars (clickable → JIRA)
 */

import React, { useMemo, useState } from 'react';
import { jiraSearchUrl } from '../release/services/releaseBriefService';
import { classifyRiskWord } from '../hooks/useSosTierSummary';
import { useComponentCounts } from '../hooks/useComponentCounts';

const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c', NotSet: '#9e9e9e' };

function openJira(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function keysJql(keys) {
  const list = (keys || []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return `key = ${list[0]}`;
  return `key in (${list.join(', ')})`;
}

function RagDonut({ ragCounts, items, release, jiraBaseUrl }) {
  const red = ragCounts?.Red || 0;
  const yellow = ragCounts?.Yellow || 0;
  const green = ragCounts?.Green || 0;
  const notSet = ragCounts?.NotSet || 0;
  const total = red + yellow + green + notSet;

  const keysByRag = useMemo(() => {
    const map = { Red: [], Yellow: [], Green: [], NotSet: [] };
    for (const i of items || []) {
      if (!i?.key) continue;
      map[classifyRiskWord(i.customfield_23560)].push(i.key);
    }
    return map;
  }, [items]);

  if (total === 0) {
    return <div style={{ fontSize: 11, color: '#aaa' }}>No RAG data</div>;
  }

  const hrefFor = (rag) => {
    const jql = keysJql(keysByRag[rag])
      || (release
        ? `fixVersion = "${release}" AND issuetype in (Feature, Initiative)`
        : null);
    return jiraSearchUrl(jiraBaseUrl, jql);
  };

  const r = 28;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const slices = [
    { rag: 'Red', color: RAG_COLORS.Red, value: red },
    { rag: 'Yellow', color: RAG_COLORS.Yellow, value: yellow },
    { rag: 'Green', color: RAG_COLORS.Green, value: green },
    { rag: 'NotSet', color: RAG_COLORS.NotSet, value: notSet },
  ].filter((s) => s.value > 0);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg width="72" height="72" viewBox="0 0 72 72" aria-label="RAG split">
        <g transform="translate(36,36)">
          {slices.map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.rag}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="12"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90)"
                style={{ cursor: hrefFor(s.rag) ? 'pointer' : 'default' }}
                onClick={() => openJira(hrefFor(s.rag))}
              >
                <title>{`${s.rag === 'NotSet' ? 'not set' : s.rag}: ${s.value} — open in JIRA`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
          <text textAnchor="middle" dy="4" style={{ fontSize: 12, fontWeight: 700, fill: '#333', pointerEvents: 'none' }}>
            {total}
          </text>
        </g>
      </svg>
      <div style={{ fontSize: 11, color: '#555', lineHeight: 1.6 }}>
        {[
          ['Red', red],
          ['Yellow', yellow],
          ['Green', green],
          ['NotSet', notSet],
        ].map(([rag, n]) => {
          const href = hrefFor(rag);
          const label = rag === 'NotSet' ? 'not set' : rag;
          return (
            <div key={rag}>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}
                  title={`Open ${label} in JIRA`}
                >
                  <span style={{ color: RAG_COLORS[rag], fontWeight: 700 }}>{n}</span> {label}
                </a>
              ) : (
                <>
                  <span style={{ color: RAG_COLORS[rag], fontWeight: 700 }}>{n}</span> {label}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GateCountdown({ gateData, release, jiraBaseUrl }) {
  const gates = useMemo(() => {
    if (!gateData?.gates?.length) return [];
    const today = Date.now();
    return ['CG', 'PG', 'GA']
      .map((kind) => {
        // Pick the latest solid gate of this kind; fall back to any style.
        const allOfKind = gateData.gates.filter(
          (x) => String(x.kind || '').toUpperCase() === kind && x.iso,
        );
        const solidOnes = allOfKind.filter((x) => x.style === 'solid');
        const g = (solidOnes.length ? solidOnes : allOfKind).at(-1);
        if (!g) return null;
        const iso = String(g.iso).slice(0, 10);
        const ms = new Date(`${iso}T00:00:00Z`).getTime();
        if (Number.isNaN(ms)) return null;
        const days = Math.ceil((ms - today) / 86400000);
        return { kind, iso, days };
      })
      .filter(Boolean);
  }, [gateData]);

  if (gates.length === 0) {
    return <div style={{ fontSize: 11, color: '#aaa' }}>No gate dates</div>;
  }

  const releaseJql = release
    ? `fixVersion = "${release}" AND issuetype in (Feature, Initiative) AND status != Cancelled`
    : null;
  const href = jiraSearchUrl(jiraBaseUrl, releaseJql);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 180 }}>
      {gates.map(({ kind, iso, days }) => {
        const past = days < 0;
        // Green → Yellow (≤30d) → Red (≤14d) → dark red (past)
        const color = past
          ? '#b71c1c'
          : days <= 14
          ? '#d32f2f'
          : days <= 30
          ? '#f57c00'
          : '#388e3c';
        const label = past
          ? `${Math.abs(days)}d overdue`
          : `${days}d`;
        return (
          <div
            key={kind}
            role={href ? 'link' : undefined}
            tabIndex={href ? 0 : undefined}
            onClick={() => openJira(href)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openJira(href); }}
            style={{ cursor: href ? 'pointer' : 'default' }}
            title={href ? `Open ${release} features in JIRA` : undefined}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#555', minWidth: 24 }}>{kind}</span>
              <span style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1, letterSpacing: '-0.5px' }}>
                {label}
              </span>
              <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>{iso}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── colour palette for component donuts (cycles if > N components) ───────
const DONUT_PALETTE = [
  '#1565c0','#d32f2f','#2e7d32','#f57c00','#6a1b9a',
  '#00838f','#ad1457','#558b2f','#4527a0','#00695c',
  '#e65100','#283593','#880e4f','#1b5e20','#bf360c',
];

/**
 * ComponentDonut — a single labelled donut showing open count by JIRA component.
 * rows: [{ name, count }] sorted by count desc.
 * label: chart title string.
 * jqlBase: base JQL to open in JIRA on slice click.
 */
function ComponentDonut({ rows, label, jqlBase, jiraBaseUrl }) {
  const [hovered, setHovered] = useState(null);

  if (!rows || rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', fontSize: 11, color: '#aaa', width: 130 }}>
        <div style={{ marginBottom: 4, fontWeight: 700, color: '#888', textTransform: 'uppercase', fontSize: 10 }}>{label}</div>
        no data
      </div>
    );
  }

  const total = rows.reduce((s, r) => s + r.count, 0);
  const r = 30; // donut radius
  const stroke = 12;
  const c = 2 * Math.PI * r;
  let offset = 0;

  const slices = rows.map((row, i) => {
    const len = (row.count / total) * c;
    const color = DONUT_PALETTE[i % DONUT_PALETTE.length];
    const slice = { ...row, len, offset, color };
    offset += len;
    return slice;
  });

  const active = hovered !== null ? slices[hovered] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 130 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <g transform="translate(42,42)">
          {slices.map((s, i) => {
            const jql = jqlBase
              + (s.name !== '(none)' ? ` AND component = "${s.name}"` : ' AND component is EMPTY');
            const href = jiraSearchUrl(jiraBaseUrl, jql);
            return (
              <circle
                key={s.name}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={hovered === i ? stroke + 3 : stroke}
                strokeDasharray={`${s.len} ${c - s.len}`}
                strokeDashoffset={-s.offset}
                transform="rotate(-90)"
                style={{ cursor: href ? 'pointer' : 'default', transition: 'stroke-width 0.1s' }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => openJira(href)}
              >
                <title>{`${s.name}: ${s.count} (${Math.round((s.count/total)*100)}%)`}</title>
              </circle>
            );
          })}
          {/* centre label */}
          <text textAnchor="middle" dy="-3" style={{ fontSize: 11, fontWeight: 700, fill: '#333', pointerEvents: 'none' }}>
            {active ? active.count : total}
          </text>
          <text textAnchor="middle" dy="10" style={{ fontSize: 8, fill: '#888', pointerEvents: 'none' }}>
            {active ? '' : 'total'}
          </text>
        </g>
      </svg>
      {/* legend — top 6 only to keep it compact */}
      <div style={{ marginTop: 6, width: '100%' }}>
        {slices.slice(0, 6).map((s, i) => {
          const jql = jqlBase
            + (s.name !== '(none)' ? ` AND component = "${s.name}"` : ' AND component is EMPTY');
          const href = jiraSearchUrl(jiraBaseUrl, jql);
          return (
            <div
              key={s.name}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 9, color: '#555', marginBottom: 2,
                background: hovered === i ? '#f5f5f5' : 'transparent',
                borderRadius: 3, padding: '1px 2px',
                cursor: href ? 'pointer' : 'default',
              }}
              onClick={() => openJira(href)}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={s.name}>
                {s.name}
              </span>
              <span style={{ fontWeight: 600, color: '#333', flexShrink: 0 }}>{s.count}</span>
            </div>
          );
        })}
        {slices.length > 6 && (
          <div style={{ fontSize: 9, color: '#aaa', marginTop: 2 }}>+{slices.length - 6} more</div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   KpiBreakdownStrip — compact KPI chips shown at the top of each
   ReleaseSection. Shows total / done / open for each configured KPI.
   Props:
     kpiData   — { [kpiId]: { name, total, done, open, links } | { error } }
     loading   — bool
     error     — string|null
     jiraBaseUrl — string
───────────────────────────────────────────────────────────── */

export function KpiBreakdownStrip({ kpiData, loading, error, jiraBaseUrl }) {
  if (loading) {
    return (
      <div style={{ fontSize: 11, color: '#888', padding: '6px 0' }}>
        Loading KPIs…
      </div>
    );
  }
  // Strip-level failure (e.g. 403, network) — hide silently
  if (error) return null;
  if (!kpiData || Object.keys(kpiData).length === 0) return null;

  const allEntries = Object.entries(kpiData);
  const goodEntries = allEntries.filter(([, kpi]) => !kpi.error);
  const noFilterEntries = allEntries.filter(([, kpi]) => kpi.error && /release base filter/i.test(kpi.error));

  // Nothing at all to show
  if (goodEntries.length === 0 && noFilterEntries.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      padding: '8px 0 4px',
    }}>
      {/* Working KPI chips */}
      {goodEntries.map(([kpiId, kpi]) => {

        const total    = kpi.total    ?? 0;
        const closed   = kpi.closed   ?? 0;
        const resolved = kpi.resolved ?? 0;  // TBV
        const others   = kpi.others   ?? 0;
        const open     = kpi.open     ?? 0;

        const rag = open === 0 && total > 0
          ? 'green'
          : open > 0 && total > 0 && ((closed + resolved) / total) >= 0.75
            ? 'yellow'
            : open > 0
              ? 'neutral'
              : 'neutral';

        const borderColor = rag === 'green' ? '#c3e6cb' : rag === 'yellow' ? '#ffeeba' : '#dee2e6';
        const bgColor     = rag === 'green' ? '#f0fff4' : rag === 'yellow' ? '#fffdf0'  : '#f8f9fa';

        const link = (bucket) => kpi.links?.[bucket]
          ? jiraSearchUrl(jiraBaseUrl, kpi.links[bucket])
          : null;

        const Num = ({ count, href, color, title }) => href ? (
          <a href={href} target="_blank" rel="noopener noreferrer"
            style={{ color, textDecoration: 'none', fontWeight: 600 }} title={title}>
            {count}
          </a>
        ) : <span style={{ color, fontWeight: 600 }}>{count}</span>;

        const ROW_DEFS = [
          { icon: '✓', label: 'closed',   count: closed,   color: '#388e3c', href: link('closed'),   title: 'Fixed / Done / Complete — shipped' },
          { icon: '~', label: 'TBV',      count: resolved, color: '#f57c00', href: link('resolved'), title: 'Resolved — To Be Verified by QA' },
          { icon: '○', label: 'open',     count: open,     color: open > 0 ? '#d32f2f' : '#aaa', href: link('open'), title: 'Truly open (resolution is EMPTY)' },
          { icon: '—', label: 'others',   count: others,   color: '#9e9e9e', href: link('others'),   title: 'Cannot Reproduce / Duplicate / Won\'t Fix etc.' },
        ];

        return (
          <div
            key={kpiId}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${borderColor}`,
              background: bgColor,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 110,
            }}
          >
            {/* Name */}
            <div style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 2 }}>
              {kpi.name || kpiId}
            </div>
            {/* Total */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 2 }}>
              <Num count={total} href={link('total')} color="#1a1a2e" title="Total" />
              <span style={{ fontSize: 10, color: '#aaa' }}>total</span>
            </div>
            {/* Divider */}
            <div style={{ height: 1, background: '#e9ecef', margin: '2px 0' }} />
            {/* Rows: only render if count > 0, except open which always shows */}
            {ROW_DEFS.filter(({ label, count }) => count > 0 || label === 'open').map(({ icon, label, count, color, href, title }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                <span style={{ color, fontWeight: 700, width: 10, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                <Num count={count} href={href} color={color} title={title} />
                <span style={{ color: '#bbb' }}>{label}</span>
              </div>
            ))}
            {/* Progress bar — closed+TBV / total */}
            {total > 0 && (
              <div style={{ height: 3, background: '#e0e0e0', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
                <div style={{
                  width: `${((closed + resolved) / total) * 100}%`,
                  height: '100%',
                  background: rag === 'green' ? '#388e3c' : rag === 'yellow' ? '#f57c00' : '#1565c0',
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
          </div>
        );
      })}
      {/* No-filter chips — one per KPI that needs a release base filter configured */}
      {noFilterEntries.length > 0 && (
        <div
          title={`${noFilterEntries.length} KPI${noFilterEntries.length > 1 ? 's' : ''} need a release base filter configured for this version`}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #e0e0e0',
            background: '#f5f5f5',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 110,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
            KPIs
          </div>
          <div style={{ fontSize: 10, color: '#bbb', fontStyle: 'italic' }}>
            No release filter
          </div>
          <div style={{ fontSize: 9, color: '#ccc' }}>
            {noFilterEntries.map(([, kpi]) => kpi.name || '—').join(', ')}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Build click-through JQL bases matching POST /component-counts.
 * Same `{release}-All` saved filter so counts and links stay authentic.
 */
function buildComponentJqlBases(release) {
  if (!release) return { outstanding: '', tbv: '' };
  const releaseFilter = `filter = "${release}-All"`;
  return {
    outstanding:
      `${releaseFilter} AND status not in (Closed, Cancelled)` +
      ` AND issueType not in (X-FEAT, Capability, Feature, Initiative, Epic)`,
    tbv:
      `${releaseFilter} AND status = Resolved AND resolution is not EMPTY` +
      ` AND issueType in (Bug, Improvement)`,
  };
}

export default function SosReleaseCharts({
  ragCounts,
  gateData,
  projectStatus,
  items = [],
  release = '',
  productId = '',
  jiraBaseUrl = '',
}) {
  // Live counts once project-status is available (same trigger as before —
  // charts load after Fetch brings projectStatus, not only after Exec Summary).
  const enabled = Boolean(productId && release && projectStatus);
  const {
    loading: countsLoading,
    outstanding: outstandingRows,
    tbv: tbvRows,
    jql: liveJql,
    error: countsError,
  } = useComponentCounts({ productId, release, enabled });

  const fallbackJql = useMemo(() => buildComponentJqlBases(release), [release]);
  const outstandingJql = liveJql?.outstanding || fallbackJql.outstanding;
  const tbvJql = liveJql?.tbv || fallbackJql.tbv;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 20,
      padding: '12px 0 4px',
      borderTop: '1px solid #eee',
      marginTop: 12,
    }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
          RAG split
        </div>
        <RagDonut ragCounts={ragCounts} items={items} release={release} jiraBaseUrl={jiraBaseUrl} />
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
          Gate countdown
        </div>
        <GateCountdown gateData={gateData} release={release} jiraBaseUrl={jiraBaseUrl} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
          Outstanding asks · by component
        </div>
        {!enabled ? (
          <div style={{ fontSize: 11, color: '#aaa' }}>Loading release data…</div>
        ) : countsLoading && outstandingRows == null && tbvRows == null ? (
          <div style={{ fontSize: 11, color: '#888' }}>Loading component counts…</div>
        ) : countsError && outstandingRows == null && tbvRows == null ? (
          <div style={{ fontSize: 11, color: '#c62828' }} title={countsError}>
            {countsError}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <ComponentDonut
              rows={outstandingRows || []}
              label="Outstanding"
              jqlBase={outstandingJql}
              jiraBaseUrl={jiraBaseUrl}
            />
            <ComponentDonut
              rows={tbvRows || []}
              label="To Be Verified"
              jqlBase={tbvJql}
              jiraBaseUrl={jiraBaseUrl}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cross-release RAG heatmap — page-level collapsible overview.
 */
export function SosRagHeatmap({ byVersion, sortedVersions, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const rows = useMemo(() => {
    return (sortedVersions || []).map((version) => {
      const items = byVersion?.[version] || [];
      const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
      items.forEach((i) => {
        counts[classifyRiskWord(i.customfield_23560)]++;
      });
      const total = counts.Red + counts.Yellow + counts.Green + counts.NotSet;
      return { version, ...counts, total };
    }).filter((r) => r.total > 0);
  }, [byVersion, sortedVersions]);

  if (rows.length === 0) return null;

  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: 8,
      marginBottom: 16,
      background: '#fafafa',
      padding: '8px 12px',
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 12, fontWeight: 700, color: '#1565c0', padding: 0,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        Cross-release RAG heatmap
      </button>
      {open && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Release</th>
                <th style={{ padding: '4px 8px', color: RAG_COLORS.Red }}>Red</th>
                <th style={{ padding: '4px 8px', color: RAG_COLORS.Yellow }}>Yellow</th>
                <th style={{ padding: '4px 8px', color: RAG_COLORS.Green }}>Green</th>
                <th style={{ padding: '4px 8px', color: RAG_COLORS.NotSet }}>not set</th>
                <th style={{ padding: '4px 8px' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.version} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{r.version}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>{r.Red}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>{r.Yellow}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>{r.Green}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>{r.NotSet}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700 }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
