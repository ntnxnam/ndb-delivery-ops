/**
 * Email-safe sprint timeline (Gantt substitute) for status emails.
 * Prefer compact ticket + bar rows over the wide UI month matrix (Outlook-hostile).
 */

const JIRA_BASE = 'https://jira.nutanix.com';
const MAX_TICKETS = 60;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function formatShort(date) {
  if (!date) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getDate()).padStart(2, '0');
  return `${day}/${months[date.getMonth()]}/${date.getFullYear()}`;
}

/**
 * @param {object|null|undefined} sprintGanttData - client payload from /api/jira/sprint-gantt-data
 * @returns {string} HTML fragment (may be empty)
 */
function renderSprintGanttEmailSection(sprintGanttData) {
  const tickets = Array.isArray(sprintGanttData?.sprintTickets)
    ? sprintGanttData.sprintTickets
    : [];
  if (tickets.length === 0) return '';

  const stats = sprintGanttData.sprintStats || {};
  const withSprint = tickets.filter((t) => t.sprintStartDate && t.sprintEndDate);
  const unassigned = tickets.length - withSprint.length;

  const dated = withSprint
    .map((t) => ({
      ...t,
      start: parseIsoDate(t.sprintStartDate),
      end: parseIsoDate(t.sprintEndDate),
    }))
    .filter((t) => t.start && t.end);

  let origin = null;
  let horizon = null;
  for (const t of dated) {
    if (!origin || t.start < origin) origin = t.start;
    if (!horizon || t.end > horizon) horizon = t.end;
  }
  const totalDays = origin && horizon
    ? Math.max(1, Math.round((horizon.getTime() - origin.getTime()) / 86400000))
    : 1;

  const truncated = tickets.length > MAX_TICKETS;
  const rowsSource = tickets.slice(0, MAX_TICKETS);

  const rows = rowsSource.map((ticket) => {
    const key = escapeHtml(ticket.key || '');
    const summary = escapeHtml(ticket.summary || '');
    const sprintName = escapeHtml(ticket.sprintName || 'Unassigned');
    const start = parseIsoDate(ticket.sprintStartDate);
    const end = parseIsoDate(ticket.sprintEndDate);
    const dateLabel = start && end
      ? `${formatShort(start)} → ${formatShort(end)}`
      : 'No sprint dates';

    let barHtml = '<span style="color:#666;font-size:0.75rem;">—</span>';
    if (start && end && origin) {
      const offset = Math.max(0, Math.round((start.getTime() - origin.getTime()) / 86400000));
      const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
      const leftPct = Math.round((offset / totalDays) * 100);
      const widthPct = Math.max(2, Math.round((duration / totalDays) * 100));
      barHtml = `
        <div style="background:#f1f3f5;height:14px;width:100%;position:relative;">
          <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;background:#059669;height:14px;"></div>
        </div>`;
    }

    return `
      <tr>
        <td style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;width:12%;">
          <a href="${JIRA_BASE}/browse/${encodeURIComponent(ticket.key || '')}" style="color:#0065ff;text-decoration:none;">${key}</a>
        </td>
        <td style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;width:28%;">${summary}</td>
        <td style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;width:16%;">${sprintName}</td>
        <td style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;width:18%;">${dateLabel}</td>
        <td style="padding:6px 8px;border:1px solid #1a1a1a;width:26%;">${barHtml}</td>
      </tr>`;
  }).join('');

  const coverage = stats.sprintCoverage != null ? `${stats.sprintCoverage}%` : '—';
  const active = stats.activeSprints != null ? stats.activeSprints : '—';
  const avgLen = stats.avgSprintLength != null ? `${stats.avgSprintLength}d` : '—';
  const nextEnd = stats.nextSprintEnd ? escapeHtml(stats.nextSprintEnd) : '—';

  return `
            <h2>Sprint timeline</h2>
            <p style="font-size:0.8125rem;margin:0 0 8px;color:#666;">
              ${tickets.length} tickets · In sprint: ${withSprint.length} · Unassigned: ${unassigned}
              · Coverage ${coverage} · Active sprints ${active} · Avg length ${avgLen} · Next end ${nextEnd}
            </p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
              <thead>
                <tr>
                  <th style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;text-align:left;">Key</th>
                  <th style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;text-align:left;">Summary</th>
                  <th style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;text-align:left;">Sprint</th>
                  <th style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;text-align:left;">Dates</th>
                  <th style="padding:6px 8px;border:1px solid #1a1a1a;font-size:0.8125rem;text-align:left;">From earliest sprint start</th>
                </tr>
              </thead>
              <tbody>${rows}
              </tbody>
            </table>
            <p style="font-size:0.75rem;color:#666;margin-top:0;">
              Green bar = sprint window on a shared timeline${truncated ? ` · Showing first ${MAX_TICKETS} of ${tickets.length} tickets` : ''}.
            </p>
  `;
}

/**
 * @param {string|null|undefined} aiSummary
 * @returns {string} HTML fragment (may be empty)
 */
function renderAiRiskSummaryEmailSection(aiSummary) {
  const text = typeof aiSummary === 'string' ? aiSummary.trim() : '';
  if (!text) return '';
  const body = escapeHtml(text).replace(/\r\n/g, '\n').replace(/\n/g, '<br>\n');
  return `
            <h2>AI risk summary</h2>
            <div style="padding:10px 12px;border:1px solid #1a1a1a;background:#f8f9fa;font-size:0.875rem;line-height:1.45;margin-bottom:15px;">
              ${body}
            </div>
  `;
}

module.exports = {
  renderSprintGanttEmailSection,
  renderAiRiskSummaryEmailSection,
  escapeHtml,
  MAX_TICKETS,
};
