import React, { useMemo, useCallback } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts';

const VOLUME_KEYS = ['total', 'open', 'any', 'tbv'];
const REG_KEYS = ['any', 'b2b', 'r2r'];
const AGE_KEYS = ['age90', 'longevityOpen', 'tbv'];

function seriesMap(trends) {
  const map = {};
  (trends?.series || []).forEach((s) => { map[s.key] = s; });
  return map;
}

function toWideRows(trends, keys) {
  const order = trends?.releaseOrder || [];
  const map = seriesMap(trends);
  return order.map((rel, idx) => {
    const row = { release: rel, short: String(rel).replace(/^NDB-/, '') };
    keys.forEach((k) => {
      const pt = map[k]?.points?.[idx];
      row[k] = pt?.value ?? 0;
      row[`${k}Jql`] = pt?.jql || '';
    });
    return row;
  });
}

function rateRows(trends) {
  const order = trends?.releaseOrder || [];
  const reg = (trends?.rateSeries || []).find((s) => s.key === 'regressionRate');
  const esc = (trends?.rateSeries || []).find((s) => s.key === 'escapeRate');
  return order.map((rel, idx) => ({
    release: rel,
    short: String(rel).replace(/^NDB-/, ''),
    regressionRate: reg?.points?.[idx]?.value ?? 0,
    escapeRate: esc?.points?.[idx]?.value ?? 0,
    regressionJql: reg?.points?.[idx]?.jql || '',
    escapeJql: esc?.points?.[idx]?.jql || '',
  }));
}

function jiraUrl(base, jql) {
  if (!jql) return null;
  return `${base.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

function ChartCard({ title, hint, children }) {
  return (
    <div className="sts-card sts-card-all">
      <div className="sts-card-head">
        <h3>{title}</h3>
        <span className="sts-scope-badge all">All releases</span>
      </div>
      {hint ? <p className="sts-hint">{hint}</p> : null}
      <div className="sts-chart">{children}</div>
    </div>
  );
}

function clickableDot(jiraBaseUrl, jqlKey) {
  return function Dot(props) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const href = jiraUrl(jiraBaseUrl, payload?.[jqlKey]);
    if (!href) {
      return <circle cx={cx} cy={cy} r={3.5} fill={props.fill || '#38bdf8'} />;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        <circle cx={cx} cy={cy} r={5} fill={props.fill || '#38bdf8'} stroke="#0f172a" strokeWidth={1} style={{ cursor: 'pointer' }} />
      </a>
    );
  };
}

export default function SystemTestScaleTrends({ trends, jiraBaseUrl, currentRelease }) {
  const volumeRows = useMemo(() => toWideRows(trends, VOLUME_KEYS), [trends]);
  const regRows = useMemo(() => toWideRows(trends, REG_KEYS), [trends]);
  const ageRows = useMemo(() => toWideRows(trends, AGE_KEYS), [trends]);
  const rates = useMemo(() => rateRows(trends), [trends]);
  const currentShort = currentRelease ? String(currentRelease).replace(/^NDB-/, '') : null;

  const tick = useCallback((props) => {
    const { x, y, payload } = props;
    const isCurrent = payload?.value === currentShort;
    return (
      <text
        x={x}
        y={y + 12}
        textAnchor="middle"
        fontSize={12}
        fontWeight={isCurrent ? 700 : 400}
        fill={isCurrent ? '#0f766e' : '#64748b'}
      >
        {payload?.value}
        {isCurrent ? ' ●' : ''}
      </text>
    );
  }, [currentShort]);

  if (!trends?.series?.length) {
    return <p className="sts-muted">No trend series yet — pull from JIRA.</p>;
  }

  const ref = currentShort ? (
    <ReferenceLine x={currentShort} stroke="#0f766e" strokeDasharray="4 3" label={{ value: 'Current', position: 'insideTopRight', fill: '#0f766e', fontSize: 11 }} />
  ) : null;

  return (
    <div className="sts-trends">
      <ChartCard title="Release trend — volume" hint="All releases · not filtered. Vertical marker = Current. Dot opens JIRA.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={volumeRows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="short" tick={tick} interval={0} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={36} />
            <Tooltip />
            <Legend />
            {ref}
            <Line type="monotone" dataKey="total" name="Total" stroke="#3b82f6" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'totalJql')} activeDot={{ r: 6 }} />
            <Line type="monotone" dataKey="open" name="Open" stroke="#f59e0b" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'openJql')} />
            <Line type="monotone" dataKey="any" name="Yes* regs" stroke="#ef4444" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'anyJql')} />
            <Line type="monotone" dataKey="tbv" name="TBV" stroke="#8b5cf6" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'tbvJql')} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Regression type trend" hint="All releases · Yes* · B2B · R2R (cf[13260]). Bar click opens JIRA.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={regRows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="short" tick={tick} interval={0} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={36} />
            <Tooltip />
            <Legend />
            {ref}
            <Bar dataKey="any" name="Yes*" fill="#ef4444" radius={[3, 3, 0, 0]} cursor="pointer"
              onClick={(d) => { const u = jiraUrl(jiraBaseUrl, d?.anyJql); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }} />
            <Bar dataKey="b2b" name="B2B" fill="#f97316" radius={[3, 3, 0, 0]} cursor="pointer"
              onClick={(d) => { const u = jiraUrl(jiraBaseUrl, d?.b2bJql); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }} />
            <Bar dataKey="r2r" name="R2R" fill="#e11d48" radius={[3, 3, 0, 0]} cursor="pointer"
              onClick={(d) => { const u = jiraUrl(jiraBaseUrl, d?.r2rJql); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Rate trend" hint="All releases · regression % and escape %. Click point → numerator.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rates} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="short" tick={tick} interval={0} />
            <YAxis unit="%" tick={{ fontSize: 12 }} width={40} />
            <Tooltip formatter={(v) => [`${v}%`, null]} />
            <Legend />
            {ref}
            <Line type="monotone" dataKey="regressionRate" name="Regression %" stroke="#e11d48" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'regressionJql')} />
            <Line type="monotone" dataKey="escapeRate" name="Escape %" stroke="#f97316" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'escapeJql')} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Aging & verify trend" hint="All releases · ≥90d open · longevity open · TBV.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={ageRows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="short" tick={tick} interval={0} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={36} />
            <Tooltip />
            <Legend />
            {ref}
            <Line type="monotone" dataKey="age90" name="≥90d open" stroke="#0ea5e9" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'age90Jql')} />
            <Line type="monotone" dataKey="longevityOpen" name="Longevity open" stroke="#14b8a6" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'longevityOpenJql')} />
            <Line type="monotone" dataKey="tbv" name="TBV" stroke="#8b5cf6" strokeWidth={2} dot={clickableDot(jiraBaseUrl, 'tbvJql')} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
