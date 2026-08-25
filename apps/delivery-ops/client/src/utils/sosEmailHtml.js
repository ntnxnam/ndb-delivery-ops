/**
 * Build an email-safe HTML snapshot from SoS page state already in memory.
 * No JIRA calls — serializes byVersion / breakdowns / gates only.
 */

const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c' };
const DATE_PREFIX_REGEX = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;
const GATE_ORDER = ['CC', 'CCM', 'EC', 'CG', 'PG', 'GA'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatShortDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return escapeHtml(val);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function ragKey(riskIndicator) {
  if (!riskIndicator) return '';
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator.value || '');
  return val.split(' ')[0] || '';
}

function execSummaryText(item) {
  const raw = item?.customfield_38460 || '';
  if (!raw) return '—';
  return raw.replace(DATE_PREFIX_REGEX, '').trim() || '—';
}

function breakdownLabel(breakdown) {
  const stats = breakdown?.overallStats;
  if (!stats) return '—';
  const done = stats.done || 0;
  const inProgress = stats.inProgress || 0;
  const remaining = breakdown.outstandingCount
    ?? ((stats.toDo || 0) + (stats.inProgress || 0) + (stats.blocked || 0) + (stats.other || 0));
  return `${done} done · ${inProgress} in prog · ${remaining} remaining`;
}

function issueType(item) {
  return (item.issuetype || item.issueType || '').toLowerCase();
}

function ticketHref(jiraBaseUrl, key) {
  if (!jiraBaseUrl || !key) return '';
  return `${jiraBaseUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`;
}

function formatGateStrip(gateData) {
  if (!gateData?.gates?.length) return '';
  const parts = [];
  const seen = new Set();
  for (const kind of GATE_ORDER) {
    const gate = gateData.gates.find((g) => (g.kind || '').toUpperCase() === kind && g.iso);
    if (!gate || seen.has(kind)) continue;
    seen.add(kind);
    parts.push(`<strong>${escapeHtml(gate.label || kind)}</strong> ${formatShortDate(gate.iso)}`);
  }
  return parts.join(' &nbsp;|&nbsp; ');
}

function ragChip(label) {
  const color = RAG_COLORS[label] || '#9e9e9e';
  return `<span style="background:${color};color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700">${escapeHtml(label || '?')}</span>`;
}

function buildItemRows(items, breakdownDataMap, jiraBaseUrl) {
  return items.map((item) => {
    const rag = ragKey(item.customfield_23560) || '?';
    const ragColor = RAG_COLORS[rag] || '#9e9e9e';
    const href = ticketHref(jiraBaseUrl, item.key);
    const keyCell = href
      ? `<a href="${escapeHtml(href)}" style="color:#1565c0;font-weight:600;text-decoration:none">${escapeHtml(item.key)}</a>`
      : escapeHtml(item.key || '—');
    return `<tr>
      <td style="padding:5px 8px;border:1px solid #ddd;white-space:nowrap">${keyCell}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${escapeHtml(item.summary || '—')}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;white-space:nowrap">${escapeHtml(item.status || '—')}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;text-align:center;color:${ragColor};font-weight:700">${escapeHtml(rag)}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${formatShortDate(item.customfield_11067)}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${formatShortDate(item.customfield_35863)}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${formatShortDate(item.customfield_35864)}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;white-space:nowrap">${escapeHtml(item.assignee || '—')}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${escapeHtml(execSummaryText(item))}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;white-space:nowrap">${escapeHtml(breakdownLabel(breakdownDataMap[item.key]))}</td>
    </tr>`;
  }).join('');
}

function buildItemsTable(title, items, breakdownDataMap, jiraBaseUrl) {
  if (!items.length) {
    return `<p style="color:#888;font-size:12px">No ${escapeHtml(title.toLowerCase())} found.</p>`;
  }
  const header = ['Key', 'Summary', 'Status', 'Risk', 'CC', 'CG', 'PG', 'Assignee', 'AI Summary', 'Breakdown']
    .map((label) => `<th style="background:#f0f4f8;padding:6px 8px;text-align:left;font-size:11px;border:1px solid #ddd">${label}</th>`)
    .join('');
  return `<h3 style="color:#333;margin:12px 0 6px;font-size:13px">${escapeHtml(title)} (${items.length})</h3>
<table style="border-collapse:collapse;width:100%;font-size:12px">
  <thead><tr>${header}</tr></thead>
  <tbody>${buildItemRows(items, breakdownDataMap, jiraBaseUrl)}</tbody>
</table>`;
}

function overallRag(items) {
  const counts = { Red: 0, Yellow: 0, Green: 0 };
  items.forEach((item) => {
    const key = ragKey(item.customfield_23560);
    if (key in counts) counts[key] += 1;
  });
  return counts.Red > 0 ? 'Red' : counts.Yellow > 0 ? 'Yellow' : 'Green';
}

function buildReleaseSection(version, items, breakdownDataMap, gateData, jiraBaseUrl) {
  const features = items.filter((i) => issueType(i) === 'feature');
  const initiatives = items.filter((i) => issueType(i) === 'initiative');
  const rag = items.length > 0 ? overallRag(items) : '';
  const gates = formatGateStrip(gateData);
  return `<div style="margin-bottom:24px;border:1px solid #ddd;border-radius:6px;padding:12px">
    <h2 style="color:#1a1a2e;margin:0 0 6px;font-size:15px">${escapeHtml(version)} ${rag ? ragChip(rag) : ''}</h2>
    ${gates ? `<p style="color:#555;font-size:11px;margin:0 0 10px">${gates}</p>` : ''}
    ${buildItemsTable('Features', features, breakdownDataMap, jiraBaseUrl)}
    ${buildItemsTable('Initiatives', initiatives, breakdownDataMap, jiraBaseUrl)}
  </div>`;
}

/**
 * @param {object} data
 * @param {Record<string, object[]>} data.byVersion
 * @param {string[]} data.sortedVersions
 * @param {Record<string, object>} data.breakdownDataMap
 * @param {Record<string, object>} data.gateDataMap
 * @param {string} data.jiraBaseUrl
 * @returns {string} full HTML document
 */
export function buildSosSnapshotHtml({
  byVersion = {},
  sortedVersions = [],
  breakdownDataMap = {},
  gateDataMap = {},
  jiraBaseUrl = '',
}) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const versions = sortedVersions.length ? sortedVersions : Object.keys(byVersion);
  const releaseLabel = versions.join(', ');
  const sections = versions
    .map((version) => buildReleaseSection(
      version,
      byVersion[version] || [],
      breakdownDataMap,
      gateDataMap[version] || null,
      jiraBaseUrl
    ))
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;font-size:13px;color:#333;margin:0;padding:16px">
<!-- SoS Summary | ${escapeHtml(releaseLabel)} | ${generatedAt} | audience: vp -->
<h1 style="color:#1a1a2e;font-size:18px;margin:0 0 4px">SoS Summary</h1>
<p style="color:#888;font-size:11px;margin:0 0 16px">Generated ${generatedAt} &nbsp;|&nbsp; Snapshot of data already loaded on the SoS page (no live JIRA refetch)</p>
${sections || '<p>No Feature or Initiative tickets in the current view.</p>'}
<p style="color:#888;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:8px">Sent via Delivery Ops</p>
</body>
</html>`;
}
