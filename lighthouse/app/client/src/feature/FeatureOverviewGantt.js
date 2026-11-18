import React, { useMemo } from 'react';
import './FeatureOverviewGantt.css';

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);
const AXIS = [
  { key: 'ec', label: 'EC' },
  { key: 'cc', label: 'CC' },
  { key: 'cg', label: 'CG' },
  { key: 'pg', label: 'PG' },
  { key: 'ga', label: 'GA' },
];

function parseDay(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function shortName(summary) {
  const s = String(summary || '').trim();
  if (s.length <= 20) return s;
  return `${s.slice(0, 18).trimEnd()}…`;
}

function riskTone(risk) {
  const value = String(risk || '').toLowerCase();
  if (value.includes('red')) return 'red';
  if (value.includes('yellow') || value.includes('amber') || value.includes('orange')) return 'amber';
  if (value.includes('green')) return 'green';
  return 'blue';
}

function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function barForFeature(feature, startMs, durationMs, endMs) {
  const dates = [feature.ccDate, feature.cgDate, feature.pgDate].map(parseDay).filter(Boolean);
  if (!dates.length || durationMs <= 0) return null;

  const isDone = DONE_STATUSES.has(String(feature.status || '').toLowerCase());
  const latest = Math.max(...dates);
  const rightMs = isDone ? endMs : latest;
  const right = ((rightMs - startMs) / durationMs) * 100;
  return {
    left: 0,
    width: Math.min(100, Math.max(1.5, right)),
    tone: riskTone(feature.risk),
  };
}

export default function FeatureOverviewGantt({
  release,
  features = [],
  gates = null,
  selectedKey = '',
  onSelectFeature,
  loading = false,
}) {
  const timeline = useMemo(() => {
    const startMs = parseDay(gates?.ec);
    const endMs = parseDay(gates?.ga);
    if (!startMs || !endMs || endMs <= startMs) return null;
    const durationMs = endMs - startMs;
    const rulers = AXIS.map((g) => {
      const ms = parseDay(gates?.[g.key]);
      if (!ms) return null;
      const pct = ((ms - startMs) / durationMs) * 100;
      if (pct < -2 || pct > 102) return null;
      return { ...g, pct: Math.min(100, Math.max(0, pct)) };
    }).filter(Boolean);
    const todayMs = Date.now();
    const todayPct =
      todayMs >= startMs && todayMs <= endMs
        ? ((todayMs - startMs) / durationMs) * 100
        : null;
    return { startMs, endMs, durationMs, rulers, todayPct };
  }, [gates]);

  const rows = useMemo(() => {
    if (!timeline) return [];
    return (features || []).map((feature) => ({
      feature,
      bar: barForFeature(feature, timeline.startMs, timeline.durationMs, timeline.endMs),
    }));
  }, [features, timeline]);

  if (!release) return null;

  return (
    <section className="fd-og" aria-label="Overall feature completion Gantt">
      <div className="fd-og-head">
        <h2>Overall · {release}</h2>
        <span>
          {loading
            ? 'Loading features…'
            : `${features.length} feature${features.length === 1 ? '' : 's'} · Gantt vs gates`}
        </span>
      </div>

      {loading && features.length === 0 && (
        <div className="fd-og-empty">Loading overall completion…</div>
      )}

      {!loading && features.length === 0 && (
        <div className="fd-og-empty">No features found for this release.</div>
      )}

      {!loading && features.length > 0 && !timeline && (
        <div className="fd-og-empty">Release gate dates (EC → GA) are not configured.</div>
      )}

      {timeline && rows.length > 0 && (
        <>
          <div className="fd-og-chart">
            <div className="fd-og-scroll">
              <div className="fd-og-body">
                <div className="fd-og-rulers" aria-hidden="true">
                  {timeline.rulers.map((ruler) => (
                    <span
                      key={ruler.key}
                      className="fd-og-ruler"
                      style={{ left: `${ruler.pct}%` }}
                    />
                  ))}
                  {timeline.todayPct != null && (
                    <span
                      className="fd-og-today"
                      style={{ left: `${timeline.todayPct}%` }}
                      title="Today"
                    />
                  )}
                </div>
                {rows.map(({ feature, bar }) => {
                  const selected = feature.key === selectedKey;
                  const title = [
                    feature.key,
                    feature.summary,
                    `Risk: ${feature.risk || 'Not set'}`,
                    `CC ${fmtDay(feature.ccDate)} · CG ${fmtDay(feature.cgDate)} · PG ${fmtDay(feature.pgDate)}`,
                  ].join(' — ');
                  return (
                    <button
                      key={feature.key}
                      type="button"
                      className={`fd-og-row${selected ? ' fd-og-row--selected' : ''}`}
                      onClick={() => onSelectFeature && onSelectFeature(feature.key)}
                      title={title}
                    >
                      <span className="fd-og-label">
                        <strong>{feature.key}</strong>
                        <span className="fd-og-summary">{shortName(feature.summary)}</span>
                      </span>
                      <span className="fd-og-track">
                        {bar ? (
                          <span
                            className={`fd-og-bar fd-og-bar--${bar.tone}`}
                            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                          />
                        ) : (
                          <span className="fd-og-bar fd-og-bar--empty" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fd-og-axis" aria-hidden="true">
              <span className="fd-og-label" />
              <span className="fd-og-track fd-og-axis-track">
                {timeline.rulers.map((ruler) => (
                  <span
                    key={ruler.key}
                    className="fd-og-axis-label"
                    style={{ left: `${ruler.pct}%` }}
                  >
                    {ruler.label}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <p className="fd-og-foot">
            Gate dates as rulers. Features use CC / CG / PG. Click a row to open it.
          </p>
        </>
      )}
    </section>
  );
}
