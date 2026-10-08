import React, { useMemo } from 'react';

function jiraHref(base, jql) {
  if (!jql) return null;
  return `${String(base || 'https://jira.nutanix.com').replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

function heatColor(v, max) {
  if (!v) return '#f1f5f9';
  const t = Math.min(1, v / (max || 1));
  const r = Math.round(254 - t * 80);
  const g = Math.round(242 - t * 180);
  const b = Math.round(242 - t * 160);
  return `rgb(${r},${g},${b})`;
}

const METRICS = [
  { key: 'any', label: 'Yes* regs' },
  { key: 'b2b', label: 'B2B' },
  { key: 'r2r', label: 'R2R' },
  { key: 'anyOpen', label: 'Open regs' },
];

/**
 * All-releases regression heatmap — not driven by Current/Compare filters.
 * currentRelease is highlighted for orientation only.
 */
export default function SystemTestScaleHeatmap({ byRelease, releaseOrder, currentRelease, jiraBaseUrl }) {
  const rows = useMemo(() => releaseOrder || Object.keys(byRelease || {}), [releaseOrder, byRelease]);

  const max = useMemo(() => {
    let m = 1;
    rows.forEach((rel) => {
      METRICS.forEach((met) => {
        m = Math.max(m, byRelease?.[rel]?.[met.key]?.count || 0);
      });
    });
    return m;
  }, [rows, byRelease]);

  if (!rows.length) return <p className="sts-muted">No release rows for heatmap.</p>;

  return (
    <div className="sts-card sts-card-all">
      <div className="sts-card-head">
        <h3>Regression heatmap — all releases</h3>
        <span className="sts-scope-badge all">All releases</span>
      </div>
      <p className="sts-hint">
        Not filtered by Current / Compare. Selected current release is outlined.
        Columns: Yes* · B2B · R2R · Open regs (cf[13260]).
      </p>
      <div className="sts-heat" style={{ gridTemplateColumns: `140px repeat(${METRICS.length}, minmax(0, 1fr))` }}>
        <div className="sts-heat-h" />
        {METRICS.map((m) => (
          <div className="sts-heat-h" key={m.key}>{m.label}</div>
        ))}
        {rows.map((rel) => (
          <React.Fragment key={rel}>
            <div className={`sts-heat-r${rel === currentRelease ? ' is-current' : ''}`}>{rel}</div>
            {METRICS.map((m) => {
              const cell = byRelease?.[rel]?.[m.key];
              const v = cell?.count || 0;
              const href = jiraHref(jiraBaseUrl, cell?.jql);
              const bg = heatColor(v, max);
              const dark = v / max > 0.55;
              const inner = href ? (
                <a className="sts-num" href={href} target="_blank" rel="noopener noreferrer" style={{ color: dark ? '#fff' : 'inherit' }}>
                  {v}
                </a>
              ) : v;
              return (
                <div
                  key={`${rel}-${m.key}`}
                  className={`sts-heat-c${rel === currentRelease ? ' is-current' : ''}`}
                  style={{ background: bg, color: dark ? '#fff' : '#0f172a' }}
                >
                  {inner}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="sts-legend">
        <span><span className="sts-swatch" style={{ background: '#f1f5f9' }} />0 / low</span>
        <span><span className="sts-swatch" style={{ background: '#fda4af' }} />high</span>
        <span>Outline = Current release ({currentRelease})</span>
      </div>
    </div>
  );
}
