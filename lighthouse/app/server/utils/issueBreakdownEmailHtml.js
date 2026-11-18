/**
 * Compact Issue Type × Status HTML for status emails.
 * Dense table — avoids tall per-type stacked bars + legends.
 */

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

/**
 * @param {object|null|undefined} issueBreakdown
 * @returns {string} HTML fragment (empty if nothing to show)
 */
function renderIssueBreakdownEmailHtml(issueBreakdown) {
  if (!issueBreakdown || !issueBreakdown.total || !Array.isArray(issueBreakdown.breakdown) || !issueBreakdown.breakdown.length) {
    return '';
  }

  const completion = issueBreakdown.overallStats?.completionRate != null
    ? `${issueBreakdown.overallStats.completionRate}%`
    : '—';

  const rows = [...issueBreakdown.breakdown]
    .sort((a, b) => b.total - a.total)
    .map((item) => {
      const segments = STATUS_ORDER.map((category) => {
        const total = categoryTotal(item.statusCategories, category);
        return {
          short: STATUS_SHORT[category],
          total,
          pct: item.total > 0 ? (total / item.total) * 100 : 0,
          color: STATUS_COLORS[category],
        };
      }).filter((s) => s.total > 0);

      const barCells = segments.map((s, i) => `
        <td style="width:${s.pct.toFixed(2)}%;background:${s.color};padding:0;height:8px;border:none;${i < segments.length - 1 ? 'border-right:1px solid #fff;' : ''}"></td>
      `).join('');

      const counts = segments
        .map((s) => `<span style="color:${s.color};font-weight:600">${s.short}</span> ${s.total}`)
        .join(' · ');

      return `
        <tr>
          <td style="padding:3px 8px 3px 0;font-size:12px;font-weight:600;color:#1a1a1a;white-space:nowrap;vertical-align:middle;">${item.type}</td>
          <td style="padding:3px 8px;font-size:12px;color:#374151;text-align:right;vertical-align:middle;">${item.total}</td>
          <td style="padding:3px 8px;width:120px;vertical-align:middle;">
            <table style="width:100%;height:8px;border-collapse:collapse;background:#e5e7eb;"><tr>${barCells}</tr></table>
          </td>
          <td style="padding:3px 0 3px 8px;font-size:11px;color:#4b5563;vertical-align:middle;">${counts}</td>
        </tr>
      `;
    })
    .join('');

  const legend = STATUS_ORDER.map((cat) => `
    <span style="display:inline-block;margin-right:10px;font-size:11px;color:#6b7280;">
      <span style="display:inline-block;width:8px;height:8px;background:${STATUS_COLORS[cat]};margin-right:3px;vertical-align:middle;"></span>${STATUS_SHORT[cat]}
    </span>
  `).join('');

  return `
    <div style="margin:16px 0;padding:10px 12px;border:1px solid #e5e7eb;background:#fff;">
      <div style="font-size:12px;font-weight:600;color:#1a1a1a;margin-bottom:2px;">Issue type × status</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">${issueBreakdown.total} work items · ${completion} done</div>
      <div style="margin-bottom:6px;">${legend}</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>
  `;
}

module.exports = { renderIssueBreakdownEmailHtml };
