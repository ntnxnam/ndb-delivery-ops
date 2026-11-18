/**
 * Compact Issue Type × Status breakdown for Email Sender.
 * Dense rows + thin stacked bars — replaces the tall per-type legend layout.
 */

import React, { useMemo } from 'react';

const STATUS_ORDER = ['Done', 'To Be Verified', 'In Progress', 'To Do', 'Blocked', 'Other'];
const STATUS_SHORT = {
  Done: 'Done',
  'To Be Verified': 'TBV',
  'In Progress': 'InProg',
  'To Do': 'ToDo',
  Blocked: 'Blocked',
  Other: 'Other',
};
const STATUS_COLORS = {
  Done: '#28a745',
  'To Be Verified': '#fd7e14',
  'In Progress': '#007bff',
  'To Do': '#6c757d',
  Blocked: '#dc3545',
  Other: '#adb5bd',
};

function categoryTotal(statusCategories, category) {
  const data = statusCategories?.[category];
  if (!data) return 0;
  return Object.values(data).reduce((sum, n) => sum + n, 0);
}

function buildRows(breakdown) {
  if (!Array.isArray(breakdown)) return [];
  return [...breakdown]
    .sort((a, b) => b.total - a.total)
    .map((item) => {
      const segments = STATUS_ORDER.map((category) => {
        const total = categoryTotal(item.statusCategories, category);
        return {
          category,
          short: STATUS_SHORT[category],
          total,
          pct: item.total > 0 ? (total / item.total) * 100 : 0,
          color: STATUS_COLORS[category],
        };
      }).filter((s) => s.total > 0);
      return { type: item.type, total: item.total, segments };
    });
}

/**
 * @param {{ issueBreakdown: object|null, loading?: boolean }} props
 */
export default function IssueTypeBreakdownCompact({ issueBreakdown, loading = false }) {
  const rows = useMemo(
    () => buildRows(issueBreakdown?.breakdown),
    [issueBreakdown]
  );

  if (loading) {
    return (
      <div className="itb-compact">
        <div className="itb-compact-title">Issue type × status</div>
        <div className="itb-compact-muted">Loading…</div>
      </div>
    );
  }

  if (!issueBreakdown || !issueBreakdown.total) {
    return null;
  }

  const stats = issueBreakdown.overallStats || {};
  const completion = stats.completionRate != null ? `${stats.completionRate}%` : '—';

  return (
    <div className="itb-compact">
      <div className="itb-compact-header">
        <div className="itb-compact-title">Issue type × status</div>
        <div className="itb-compact-meta">
          {issueBreakdown.total} work items · {completion} done
        </div>
      </div>

      <div className="itb-compact-legend" aria-hidden="true">
        {STATUS_ORDER.map((cat) => (
          <span key={cat} className="itb-compact-legend-item">
            <span className="itb-compact-swatch" style={{ background: STATUS_COLORS[cat] }} />
            {STATUS_SHORT[cat]}
          </span>
        ))}
      </div>

      <table className="itb-compact-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.type}>
              <td className="itb-compact-type">{row.type}</td>
              <td className="itb-compact-count">{row.total}</td>
              <td className="itb-compact-bar-cell">
                <div className="itb-compact-bar" title={row.segments.map((s) => `${s.short}: ${s.total}`).join(', ')}>
                  {row.segments.map((s) => (
                    <span
                      key={s.category}
                      className="itb-compact-seg"
                      style={{ width: `${s.pct}%`, background: s.color }}
                    />
                  ))}
                </div>
              </td>
              <td className="itb-compact-counts">
                {row.segments.map((s, i) => (
                  <span key={s.category}>
                    {i > 0 ? ' · ' : ''}
                    <span style={{ color: s.color, fontWeight: 600 }}>{s.short}</span>
                    {' '}{s.total}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { STATUS_ORDER, STATUS_SHORT, STATUS_COLORS, buildRows, categoryTotal };
