import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { jiraIssuesHref } from './pulseLink';

const CREATED_COLOR = '#1f77b4';
const TO_RESOLVED_COLOR = '#ff7f0e';
const CLOSED_COLOR = '#2ca02c';

const SERIES_META = {
  created: { label: 'Created', color: CREATED_COLOR, jqlKey: 'createdJql' },
  toResolved: { label: '→ Resolved', color: TO_RESOLVED_COLOR, jqlKey: 'toResolvedJql' },
  closed: { label: '→ Closed', color: CLOSED_COLOR, jqlKey: 'closedJql' },
};

/**
 * Weekly Created / →Resolved / →Closed — max height 280px (ui-density).
 * Toggles: line | grouped bars (side-by-side); point-in-time (weekly) | cumulative.
 * Bars are grouped, not stacked — Created / →Resolved / →Closed are independent
 * flow counts and must stay visible next to each other for comparison.
 * Click a point/bar opens the matching JQL (week or window-start→weekEnd).
 */
export default function CreatedResolvedChart({
  series,
  jiraBaseUrl,
  caption,
  outflowMode = 'transitions',
}) {
  const [chartType, setChartType] = useState('line'); // line | bars
  const [aggregation, setAggregation] = useState('weekly'); // weekly | cumulative

  const rows = useMemo(() => {
    // Prefer first defined cell object (including {count:0}) — never use
    // `obj || fallback` because a zero-count cell is truthy and must win.
    const pick = (...cands) => cands.find((c) => c && typeof c.count === 'number') || null;
    return (series || []).map((s) => {
      const pit = aggregation === 'weekly';
      const createdCell = pit ? pick(s.created) : pick(s.createdCumulative, s.created);
      const toResolvedCell = pit
        ? pick(s.toResolved, s.resolved)
        : pick(s.toResolvedCumulative, s.resolvedCumulative, s.toResolved, s.resolved);
      const closedCell = pit
        ? pick(s.closed)
        : pick(s.closedCumulative, s.closed);
      return {
        weekStart: s.weekStart,
        created: createdCell?.count ?? 0,
        toResolved: toResolvedCell?.count ?? 0,
        closed: closedCell?.count ?? 0,
        createdJql: createdCell?.jql,
        toResolvedJql: toResolvedCell?.jql,
        closedJql: closedCell?.jql,
      };
    });
  }, [series, aggregation]);

  if (!rows.length) {
    return <p className="kpi-pulse-muted">No weekly series for this window.</p>;
  }

  const openPoint = (dataKey, payload) => {
    const meta = SERIES_META[dataKey];
    const jql = meta ? payload?.[meta.jqlKey] : null;
    const href = jiraIssuesHref(jiraBaseUrl, jql);
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  const formatTooltip = (val, name) => {
    const label = SERIES_META[name]?.label || name;
    return [val, label];
  };

  const dotClick = (dataKey) => (props) => {
    const { cx, cy, payload } = props || {};
    if (cx == null || cy == null) return null;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill={SERIES_META[dataKey].color}
        style={{ cursor: 'pointer' }}
        onClick={() => openPoint(dataKey, payload)}
      />
    );
  };

  const aggLabel =
    aggregation === 'cumulative'
      ? 'Cumulative from window start'
      : 'Point-in-time (each week)';
  const typeLabel = chartType === 'bars' ? 'Grouped bars (side-by-side)' : 'Line';
  const title =
    aggregation === 'cumulative'
      ? 'Created · →Resolved · →Closed (cumulative)'
      : 'Created · →Resolved · →Closed (weekly)';

  const seriesKeys = ['created', 'toResolved', 'closed'];

  return (
    <div className="kpi-pulse-chart">
      <div className="kpi-pulse-chart-head">
        <div className="kpi-pulse-chart-title">{title}</div>
        <div className="kpi-pulse-chart-toggles">
          <div className="kpi-pulse-toggle" role="group" aria-label="Chart type">
            <button
              type="button"
              className={chartType === 'line' ? 'kpi-pulse-toggle-active' : ''}
              onClick={() => setChartType('line')}
            >
              Line
            </button>
            <button
              type="button"
              className={chartType === 'bars' ? 'kpi-pulse-toggle-active' : ''}
              onClick={() => setChartType('bars')}
            >
              Bars
            </button>
          </div>
          <div className="kpi-pulse-toggle" role="group" aria-label="Aggregation">
            <button
              type="button"
              className={aggregation === 'weekly' ? 'kpi-pulse-toggle-active' : ''}
              onClick={() => setAggregation('weekly')}
            >
              Point-in-time
            </button>
            <button
              type="button"
              className={aggregation === 'cumulative' ? 'kpi-pulse-toggle-active' : ''}
              onClick={() => setAggregation('cumulative')}
            >
              Cumulative
            </button>
          </div>
        </div>
      </div>
      {caption ? <p className="kpi-pulse-chart-caption">{caption}</p> : null}
      <p className="kpi-pulse-chart-hint">
        {typeLabel} · {aggLabel}.{' '}
        {outflowMode === 'resolutiondate'
          ? 'Status transitions returned 0 for this filter — → Closed uses resolution date (same as Resolved hero). → Resolved stays empty when tickets skip TBV.'
          : 'Created · moved to Resolved · moved to Closed.'}{' '}
        Click a series to open that set in JIRA.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        {chartType === 'bars' ? (
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barGap={1} barCategoryGap="18%">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="weekStart"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={36} />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={formatTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {seriesKeys.map((key) => (
              <Bar
                key={key}
                dataKey={key}
                name={SERIES_META[key].label}
                fill={SERIES_META[key].color}
                cursor="pointer"
                onClick={(d) => openPoint(key, d?.payload || d)}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="weekStart"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={36} />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={formatTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {seriesKeys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={SERIES_META[key].label}
                stroke={SERIES_META[key].color}
                strokeWidth={2}
                dot={dotClick(key)}
                activeDot={{
                  r: 5,
                  cursor: 'pointer',
                  onClick: (_e, el) => openPoint(key, el?.payload),
                }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
