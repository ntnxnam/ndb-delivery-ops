import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { buildGateChartRows } from './gateDateUtils';

/**
 * Horizontal bar chart: gates vs days from today.
 */
function GateDatesBarChart({ jiraData }) {
  const rows = useMemo(() => buildGateChartRows(jiraData), [jiraData]);
  const chartData = useMemo(
    () => rows.filter((r) => r.set).map((r) => ({
      ...r,
      // Recharts needs a numeric bar value; keep sign (past negative / future positive)
      days: r.daysFromToday,
    })),
    [rows]
  );

  if (!jiraData) return null;

  const unset = rows.filter((r) => !r.set);

  return (
    <div className="form-group" style={{ marginTop: '0.5rem' }}>
      <label>Gates vs dates</label>
      {chartData.length === 0 ? (
        <div
          style={{
            padding: '12px',
            border: '1px solid #dee2e6',
            borderRadius: '4px',
            background: '#fff3cd',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          No gate dates set on this ticket.
        </div>
      ) : (
        <div
          style={{
            border: '1px solid #dee2e6',
            borderRadius: '4px',
            background: '#fff',
            padding: '8px 8px 4px',
          }}
        >
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40 + 40)}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                label={{ value: 'Days from today', position: 'insideBottom', offset: -2, fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value, _name, props) => {
                  const row = props?.payload;
                  const dayLabel = value === 0
                    ? 'today'
                    : value > 0
                      ? `${value} days ahead`
                      : `${Math.abs(value)} days ago`;
                  return [dayLabel, row?.dateLabel || ''];
                }}
                labelFormatter={(label) => label}
              />
              <ReferenceLine x={0} stroke="#495057" strokeWidth={1} />
              <Bar dataKey="days" barSize={18} radius={[0, 3, 3, 0]}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={entry.days < 0 ? '#adb5bd' : entry.color}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: '0.75rem', color: '#666', padding: '0 8px 8px' }}>
            Negative = past · Positive = upcoming · Grey bars are past dates
            {unset.length > 0 && (
              <span> · Not set: {unset.map((u) => u.label).join(', ')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default GateDatesBarChart;
