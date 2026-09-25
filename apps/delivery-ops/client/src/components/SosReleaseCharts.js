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

const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c', NotSet: '#9e9e9e' };
const TYPE_COLORS = {
  Bug: '#d62728',
  Improvement: '#ff7f0e',
  'Dev Code': '#1f77b4',
  Test: '#2ca02c',
  'Everything Else': '#7f7f7f',
};
const TYPE_ORDER = ['Bug', 'Improvement', 'Dev Code', 'Test', 'Everything Else'];

const TYPE_JQL = {
  Bug: 'issuetype = Bug',
  Improvement: 'issuetype = Improvement',
  'Dev Code': 'issuetype in (Task, "Unit Test")',
  Test: 'issuetype = Test',
  'Everything Else':
    'issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability, Bug, Improvement, Task, "Unit Test", Test)',
};

/** Matches chart open count = outstanding + toVerify (excludes Done-family). */
const OPEN_STATUS_JQL =
  'status not in (Fixed, Done, Resolved, Complete, Closed, Cancelled, Backlog)';

const TIER_JQL_KEY = {
  'FEAT Work': 'feat',
  Standalone: 'standalone',
  Direct: 'direct',
};

function sumOutstanding(groups) {
  const totals = {};
  for (const g of groups || []) {
    if (!g?.label || g.label === 'Project Hierarchy') continue;
    const open = (g.outstanding || 0) + (g.toVerify || 0);
    totals[g.label] = (totals[g.label] || 0) + open;
  }
  return totals;
}

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
  const bars = useMemo(() => {
    if (!gateData?.gates?.length) return [];
    const today = Date.now();
    return ['CG', 'PG', 'GA']
      .map((kind) => {
        // Pick the latest solid gate of this kind (dotted = superseded/planned).
        // Fall back to the latest entry of any style if no solid one exists.
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

  if (bars.length === 0) {
    return <div style={{ fontSize: 11, color: '#aaa' }}>No gate dates</div>;
  }

  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.days)), 1);
  const releaseJql = release
    ? `fixVersion = "${release}" AND issuetype in (Feature, Initiative) AND status != Cancelled`
    : null;
  const href = jiraSearchUrl(jiraBaseUrl, releaseJql);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
      {bars.map(({ kind, iso, days }) => {
        const pct = Math.min(100, Math.round((Math.abs(days) / maxAbs) * 100));
        const past = days < 0;
        const urgent = !past && days <= 14;
        const color = past ? '#d32f2f' : urgent ? '#f57c00' : '#388e3c';
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginBottom: 2 }}>
              <span style={{ fontWeight: 700 }}>{kind}</span>
              <span>
                {past ? `${Math.abs(days)}d past` : `${days}d`} · {iso}
              </span>
            </div>
            <div style={{ height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutstandingStacks({ projectStatus, release, jiraBaseUrl }) {
  const rows = useMemo(() => {
    if (!projectStatus) return [];

    const tier = projectStatus.tierOutstanding;
    if (tier?.feat || tier?.standalone || tier?.direct) {
      return [
        { label: 'FEAT Work', totals: sumOutstanding(tier.feat) },
        { label: 'Standalone', totals: sumOutstanding(tier.standalone) },
        { label: 'Direct', totals: sumOutstanding(tier.direct) },
      ];
    }

    const featTotals = {};
    for (const p of projectStatus.projects || []) {
      const t = sumOutstanding(p.issueTypeGroups);
      for (const [k, v] of Object.entries(t)) featTotals[k] = (featTotals[k] || 0) + v;
    }
    const standaloneTotals = {};
    for (const e of projectStatus.standaloneEpics || []) {
      const t = sumOutstanding(e.issueTypeGroups);
      for (const [k, v] of Object.entries(t)) standaloneTotals[k] = (standaloneTotals[k] || 0) + v;
    }
    const directTotals = sumOutstanding(projectStatus.standaloneTickets?.issueTypeGroups);

    return [
      { label: 'FEAT Work', totals: featTotals },
      { label: 'Standalone', totals: standaloneTotals },
      { label: 'Direct', totals: directTotals },
    ];
  }, [projectStatus]);

  if (!projectStatus) {
    return <div style={{ fontSize: 11, color: '#aaa' }}>Generate Exec Summary to load outstanding breakdown</div>;
  }

  const maxTotal = Math.max(
    ...rows.map((r) => TYPE_ORDER.reduce((s, k) => s + (r.totals[k] || 0), 0)),
    1
  );

  const typeHref = (tierLabel, typeLabel) => {
    const bucketKey = TIER_JQL_KEY[tierLabel];
    const base = projectStatus?.tierJql?.[bucketKey];
    const typeClause = TYPE_JQL[typeLabel];
    if (!base || !typeClause) return '';
    const jql = `(${base}) AND (${typeClause}) AND ${OPEN_STATUS_JQL}`;
    return jiraSearchUrl(jiraBaseUrl, jql);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 200 }}>
      {rows.map(({ label, totals }) => {
        const total = TYPE_ORDER.reduce((s, k) => s + (totals[k] || 0), 0);
        return (
          <div key={label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginBottom: 2 }}>
              <span style={{ fontWeight: 700 }}>{label}</span>
              <span>{total} open</span>
            </div>
            <div style={{
              display: 'flex', height: 12, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden',
              width: `${Math.max(8, Math.round((total / maxTotal) * 100))}%`,
              minWidth: total > 0 ? 40 : 8,
            }}>
              {TYPE_ORDER.map((k) => {
                const n = totals[k] || 0;
                if (!n || !total) return null;
                const href = typeHref(label, k);
                return (
                  <div
                    key={k}
                    role={href ? 'link' : undefined}
                    tabIndex={href ? 0 : undefined}
                    title={`${label} · ${k}: ${n} — open in JIRA`}
                    onClick={(e) => { e.stopPropagation(); openJira(href); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openJira(href); }}
                    style={{
                      width: `${(n / total) * 100}%`,
                      background: TYPE_COLORS[k],
                      height: '100%',
                      cursor: href ? 'pointer' : 'default',
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {TYPE_ORDER.map((k) => (
          <span key={k} style={{ fontSize: 9, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS[k] }} />
            {k}
          </span>
        ))}
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

export default function SosReleaseCharts({
  ragCounts,
  gateData,
  projectStatus,
  items = [],
  release = '',
  jiraBaseUrl = '',
}) {
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
      {/* Outstanding by type bucket breakdown hidden — replaced by Component filter */}
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
