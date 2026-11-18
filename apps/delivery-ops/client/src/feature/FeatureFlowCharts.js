import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Client-side transform of daily enriched flow (mirrors shared transformFlow).
 * @param {'cumulative'|'weekly'} mode
 */
function transformDaily(daily, mode) {
  if (!daily?.length) return [];
  if (mode === 'weekly') {
    const buckets = new Map();
    for (const p of daily) {
      const d = new Date(`${p.day}T00:00:00.000Z`);
      const day = d.getUTCDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const mon = new Date(d.getTime() + mondayOffset * 86400000);
      const key = mon.toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, pts]) => {
        const last = pts[pts.length - 1];
        const sum = (k) => pts.reduce((s, p) => s + (p[k] || 0), 0);
        return {
          day: weekStart,
          created: sum('created'),
          resolved: sum('resolved'),
          open: last.open,
          verified: sum('verified'),
          bugCreated: sum('bugCreated'),
          bugResolved: sum('bugResolved'),
          bugOpen: last.bugOpen,
          impCreated: sum('impCreated'),
          impResolved: sum('impResolved'),
          impOpen: last.impOpen,
          testCreated: sum('testCreated'),
          testResolved: sum('testResolved'),
          testOpen: last.testOpen,
        };
      });
  }
  // cumulative
  let c = 0;
  let r = 0;
  let v = 0;
  let bc = 0;
  let br = 0;
  let ic = 0;
  let ir = 0;
  let tc = 0;
  let tr = 0;
  return daily.map((p) => {
    c += p.created || 0;
    r += p.resolved || 0;
    v += p.verified || 0;
    bc += p.bugCreated || 0;
    br += p.bugResolved || 0;
    ic += p.impCreated || 0;
    ir += p.impResolved || 0;
    tc += p.testCreated || 0;
    tr += p.testResolved || 0;
    return {
      day: p.day,
      created: c,
      resolved: r,
      open: p.open,
      verified: v,
      bugCreated: bc,
      bugResolved: br,
      bugOpen: p.bugOpen,
      impCreated: ic,
      impResolved: ir,
      impOpen: p.impOpen,
      testCreated: tc,
      testResolved: tr,
      testOpen: p.testOpen,
    };
  });
}

function markerList(markers) {
  return [...new Set(Object.values(markers || {}).filter(Boolean))];
}

/**
 * Overall flow + Bugs/Improvements + Test charts (shared Cumulative/Weekly toggle).
 */
export default function FeatureFlowCharts({ flow }) {
  const [mode, setMode] = useState('cumulative'); // cumulative | weekly
  const daily = useMemo(() => flow?.daily || [], [flow?.daily]);
  const startIso = flow?.startIso || '';
  const endIso = flow?.endIso || '';
  const markers = useMemo(() => markerList(flow?.markers), [flow?.markers]);

  const points = useMemo(() => transformDaily(daily, mode), [daily, mode]);

  if (!daily.length) return null;

  const modeLabel = mode === 'cumulative' ? 'Cumulative' : 'Weekly (point-in-time rates)';

  return (
    <>
      <section className="fd-section">
        <div className="fd-flow-head">
          <h3>Created vs Resolved ({startIso} → {endIso})</h3>
          <div className="fd-flow-toggle" role="group" aria-label="Flow chart mode">
            <button
              type="button"
              className={mode === 'cumulative' ? 'fd-toggle-active' : ''}
              onClick={() => setMode('cumulative')}
            >
              Cumulative
            </button>
            <button
              type="button"
              className={mode === 'weekly' ? 'fd-toggle-active' : ''}
              onClick={() => setMode('weekly')}
            >
              Weekly
            </button>
          </div>
        </div>
        <p className="fd-flow-hint">
          {modeLabel}. Thick purple = QA verification (Bug/Improvement status → Closed in changelog — not resolutiondate).
          Pink = Test open / resolved. Gate markers: EC/CC/CG/PG/GA.
        </p>
        <div className="fd-chart-wrap">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={24} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              {markers.map((m) => (
                <ReferenceLine key={m} x={m} stroke="#94a3b8" strokeDasharray="4 4" />
              ))}
              <Line type="monotone" dataKey="created" name="Created" stroke="#2563EB" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#16A34A" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="open" name="Open" stroke="#D97706" strokeWidth={2} dot={false} />
              <Line
                type="monotone"
                dataKey="verified"
                name="QA verified (→ Closed)"
                stroke="#7C3AED"
                strokeWidth={3.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="testOpen"
                name="Test open"
                stroke="#DB2777"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="testResolved"
                name="Test resolved"
                stroke="#DB2777"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="fd-section">
        <div className="fd-flow-head">
          <h3>Bugs & Improvements — discover / open vs resolved</h3>
          <span className="fd-flow-mode-tag">{modeLabel}</span>
        </div>
        <p className="fd-flow-hint">
          Same window & mode as overall. Blue = Bugs, teal = Improvements (open solid, resolved dashed).
        </p>
        <div className="fd-chart-wrap fd-chart-wrap--sm">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={28} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              {markers.map((m) => (
                <ReferenceLine key={`bi-${m}`} x={m} stroke="#94a3b8" strokeDasharray="4 4" />
              ))}
              <Line type="monotone" dataKey="bugOpen" name="Bugs open" stroke="#2563EB" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="bugResolved" name="Bugs resolved" stroke="#2563EB" strokeWidth={2} strokeDasharray="5 4" dot={false} />
              <Line type="monotone" dataKey="impOpen" name="Improvements open" stroke="#0D9488" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="impResolved" name="Improvements resolved" stroke="#0D9488" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="fd-section">
        <div className="fd-flow-head">
          <h3>Test — discover / open vs resolved</h3>
          <span className="fd-flow-mode-tag">{modeLabel}</span>
        </div>
        <p className="fd-flow-hint">
          Issue type Test (and Unit Test). Pink = open (solid) / resolved (dashed). Same window & mode.
        </p>
        <div className="fd-chart-wrap fd-chart-wrap--sm">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={28} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              {markers.map((m) => (
                <ReferenceLine key={`test-${m}`} x={m} stroke="#94a3b8" strokeDasharray="4 4" />
              ))}
              <Line type="monotone" dataKey="testCreated" name="Test created" stroke="#9D174D" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="testOpen" name="Test open" stroke="#DB2777" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="testResolved" name="Test resolved" stroke="#DB2777" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
