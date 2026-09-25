/**
 * Build an email-safe HTML snapshot from SoS page state already in memory.
 * No JIRA calls — serializes byVersion / breakdowns / gates / date history /
 * optional tier exec summaries.
 *
 * Email clients: table layout only (no flex), max-width 800px, word-break,
 * overflow hidden on cards so content cannot spill the outer box.
 */

import { formatDateWithHistoryHTML } from './dateHistoryDisplay';

const DATE_PREFIX_REGEX = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;
const STALE_DAYS = 7;
const GATE_ORDER = ['CC', 'CCM', 'EC', 'CG', 'PG', 'GA'];
const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c', NotSet: '#9e9e9e' };
const EMAIL_MAX_WIDTH = 800;
const AI_SUMMARY_MAX = 220;
const TIER_SUMMARY_MAX = 900;

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
  const key = val.split(' ')[0] || '';
  if (key === 'Red' || key === 'Yellow' || key === 'Green') return key;
  return riskIndicator ? 'NotSet' : '';
}

function daysOld(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function truncate(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function execSummaryText(item) {
  const statusDays = daysOld(item?.customfield_45660);
  if (statusDays !== null && statusDays >= STALE_DAYS) return '⚠ Stale Update';
  const raw = item?.customfield_38460 || '';
  if (!raw) return '—';
  return truncate(raw.replace(DATE_PREFIX_REGEX, '').trim() || '—', AI_SUMMARY_MAX);
}

function breakdownLabel(breakdown) {
  const stats = breakdown?.overallStats;
  if (!stats) return '—';
  const total = breakdown.total || 0;
  const remaining = breakdown.outstandingCount
    ?? ((stats.toDo || 0) + (stats.inProgress || 0) + (stats.blocked || 0) + (stats.other || 0));
  const completionRate = parseFloat(stats.completionRate || '0');
  if (!total) return '—';
  return `${remaining}/${total} rem (${completionRate}%)`;
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
  return parts.join(' · ');
}

function ragChip(label) {
  const display = label === 'NotSet' ? 'not set' : (label || '?');
  const color = RAG_COLORS[label] || RAG_COLORS.NotSet;
  return `<span style="display:inline-block;background:${color};color:#fff;border-radius:3px;padding:0 6px;font-size:10px;font-weight:700;line-height:16px;vertical-align:middle">${escapeHtml(display)}</span>`;
}

/** Plain-text tier summary → compact email HTML (no flex; word-break). */
function formatTierSummaryHtml(summary) {
  if (!summary || !String(summary).trim()) {
    return '<span style="color:#adb5bd;font-size:11px">Not generated</span>';
  }
  const clipped = String(summary).trim().slice(0, TIER_SUMMARY_MAX);
  const lines = clipped.split('\n');
  const parts = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('## ')) {
      const heading = t.slice(3).replace(/🔴|🟡|🟢/g, '').replace(/\b(RED|YELLOW|GREEN)\b/gi, '').replace(/\s+/g, ' ').trim();
      parts.push(`<div style="font-weight:700;font-size:11px;color:#343a40;margin:0 0 4px;padding-bottom:3px;border-bottom:1px solid #eee">${escapeHtml(heading)}</div>`);
      continue;
    }
    if (/^No items in this tier/i.test(t)) {
      parts.push(`<div style="font-size:11px;line-height:1.35;color:#868e96;font-style:italic;margin:2px 0">${escapeHtml(t)}</div>`);
      continue;
    }
    const tldr = t.match(/^(?:(?:🔴|🟡|🟢)(?:\s*\/\s*(?:🔴|🟡|🟢))*)?\s*TLDR:\s*(.*)$/i);
    if (tldr) {
      const verdict = /\bRED\b/i.test(t) || t.includes('🔴') ? 'Red'
        : /\bYELLOW\b/i.test(t) || t.includes('🟡') ? 'Yellow'
          : /\bGREEN\b/i.test(t) || t.includes('🟢') ? 'Green' : '';
      parts.push(`<div style="margin:0 0 6px"><span style="font-weight:700;font-size:10px;color:#495057">TLDR</span> ${verdict ? ragChip(verdict) : ''}<div style="font-size:11px;line-height:1.35;color:#343a40;margin-top:2px;word-break:break-word">${escapeHtml(tldr[1])}</div></div>`);
      continue;
    }
    if (/^(📋|✅|⚠️)/.test(t) || /^(Key Risks|Top Actions|Next Owner Actions|Call-outs)/i.test(t)) {
      parts.push(`<div style="font-weight:700;font-size:10px;color:#495057;margin:6px 0 2px">${escapeHtml(t.replace(/^(📋|✅|⚠️)\s*/, ''))}</div>`);
      continue;
    }
    if (/^[-•]/.test(t)) {
      parts.push(`<div style="font-size:11px;line-height:1.35;color:#343a40;margin:1px 0;padding-left:8px;word-break:break-word">• ${escapeHtml(t.slice(1).trim())}</div>`);
      continue;
    }
    parts.push(`<div style="font-size:11px;line-height:1.35;color:#495057;margin:1px 0;word-break:break-word">${escapeHtml(t)}</div>`);
  }
  return parts.join('') || '<span style="color:#adb5bd;font-size:11px">—</span>';
}

const TIER_ORDER = [
  { key: 'feat', title: 'FEAT Work' },
  { key: 'standalone', title: 'Standalone Epics' },
  { key: 'direct', title: 'Direct Tickets' },
];

function buildTierBoxesRow(tierSummaries) {
  if (!tierSummaries) return '';
  const hasAny = TIER_ORDER.some((t) => tierSummaries[t.key]?.summary || tierSummaries[t.key]?.state === 'done');
  if (!hasAny) return '';

  const cells = TIER_ORDER.map(({ key, title }) => {
    const state = tierSummaries[key] || {};
    const body = state.state === 'error'
      ? `<span style="color:#c92a2a;font-size:11px">${escapeHtml(state.error || 'Generation failed')}</span>`
      : formatTierSummaryHtml(state.summary);
    return `<td style="width:33.33%;vertical-align:top;padding:0 4px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #dee2e6;border-radius:6px;background:#fff;table-layout:fixed;width:100%">
    <tr><td style="padding:5px 8px;background:#f8f9fa;border-bottom:1px solid #dee2e6;font-weight:700;font-size:11px;color:#343a40">${escapeHtml(title)}</td></tr>
    <tr><td style="padding:6px 8px;font-size:11px;overflow:hidden;word-break:break-word;overflow-wrap:anywhere;max-width:0">${body}</td></tr>
  </table>
</td>`;
  }).join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;margin:0 0 8px"><tr>${cells}</tr></table>`;
}

const TD = 'padding:3px 5px;border:1px solid #ddd;font-size:11px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere';
const TH = 'background:#f0f4f8;padding:4px 5px;text-align:left;font-size:10px;border:1px solid #ddd;white-space:nowrap';

function buildItemRows(items, breakdownDataMap, jiraBaseUrl, checkpointHistory) {
  return items.map((item) => {
    const rag = ragKey(item.customfield_23560) || 'NotSet';
    const ragColor = RAG_COLORS[rag] || RAG_COLORS.NotSet;
    const ragLabel = rag === 'NotSet' ? 'not set' : rag;
    const href = ticketHref(jiraBaseUrl, item.key);
    const keyCell = href
      ? `<a href="${escapeHtml(href)}" style="color:#1565c0;font-weight:600;text-decoration:none">${escapeHtml(item.key)}</a>`
      : escapeHtml(item.key || '—');
    return `<tr>
      <td style="${TD}white-space:nowrap">${keyCell}</td>
      <td style="${TD}">${escapeHtml(truncate(item.summary || '—', 80))}</td>
      <td style="${TD}white-space:nowrap">${escapeHtml(item.status || '—')}</td>
      <td style="${TD}text-align:center;color:${ragColor};font-weight:700">${escapeHtml(ragLabel)}</td>
      <td style="${TD}">${formatDateWithHistoryHTML(item.key, 'fsdsDone', item.customfield_13861, checkpointHistory)}</td>
      <td style="${TD}">${formatDateWithHistoryHTML(item.key, 'codeComplete', item.customfield_11067, checkpointHistory)}</td>
      <td style="${TD}">${formatDateWithHistoryHTML(item.key, 'commitGate', item.customfield_35863, checkpointHistory)}</td>
      <td style="${TD}">${formatDateWithHistoryHTML(item.key, 'promotionGate', item.customfield_35864, checkpointHistory)}</td>
      <td style="${TD}white-space:nowrap">${escapeHtml(truncate(item.assignee || '—', 18))}</td>
      <td style="${TD}">${escapeHtml(execSummaryText(item))}</td>
      <td style="${TD}white-space:nowrap">${escapeHtml(breakdownLabel(breakdownDataMap[item.key]))}</td>
    </tr>`;
  }).join('');
}

function buildItemsTable(title, items, breakdownDataMap, jiraBaseUrl, checkpointHistory) {
  if (!items.length) {
    return `<p style="color:#888;font-size:11px;margin:4px 0">No ${escapeHtml(title.toLowerCase())}.</p>`;
  }
  const header = ['Key', 'Summary', 'Status', 'Risk', 'FS/DS', 'CCM', 'CG', 'PG', 'Assignee', 'AI Summary', 'Breakdown']
    .map((label) => `<th style="${TH}">${label}</th>`)
    .join('');
  return `<h3 style="color:#333;margin:8px 0 4px;font-size:12px">${escapeHtml(title)} (${items.length})</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px">
  <thead><tr>${header}</tr></thead>
  <tbody>${buildItemRows(items, breakdownDataMap, jiraBaseUrl, checkpointHistory)}</tbody>
</table>`;
}

function overallRag(items) {
  const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
  items.forEach((item) => {
    const key = ragKey(item.customfield_23560);
    if (key === 'Red' || key === 'Yellow' || key === 'Green') counts[key] += 1;
    else counts.NotSet += 1;
  });
  if (counts.Red > 0) return 'Red';
  if (counts.Yellow > 0) return 'Yellow';
  if (counts.Green > 0) return 'Green';
  return 'NotSet';
}

function buildReleaseSection(version, items, breakdownDataMap, gateData, jiraBaseUrl, checkpointHistory, tierSummaries) {
  const features = items.filter((i) => issueType(i) === 'feature');
  const initiatives = items.filter((i) => issueType(i) === 'initiative');
  const rag = items.length > 0 ? overallRag(items) : '';
  const gates = formatGateStrip(gateData);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border:1px solid #ddd;border-radius:6px;margin:0 0 12px;background:#fafafa">
  <tr><td style="padding:8px 10px;overflow:hidden">
    <div style="font-size:14px;font-weight:700;color:#1a1a2e;margin:0 0 4px">${escapeHtml(version)} ${rag ? ragChip(rag) : ''}</div>
    ${gates ? `<div style="color:#555;font-size:10px;margin:0 0 8px">${gates}</div>` : ''}
    ${buildTierBoxesRow(tierSummaries)}
    ${buildItemsTable('Features', features, breakdownDataMap, jiraBaseUrl, checkpointHistory)}
    ${buildItemsTable('Initiatives', initiatives, breakdownDataMap, jiraBaseUrl, checkpointHistory)}
  </td></tr>
</table>`;
}

/**
 * @param {object} data
 * @param {Record<string, object[]>} data.byVersion
 * @param {string[]} data.sortedVersions
 * @param {Record<string, object>} data.breakdownDataMap
 * @param {Record<string, object>} data.gateDataMap
 * @param {Record<string, object>} data.checkpointHistory
 * @param {Record<string, object>} [data.tierSummaries] — { [version]: { feat|standalone|direct: { summary, state } } }
 * @param {string} data.jiraBaseUrl
 * @returns {string} full HTML document
 */
export function buildSosSnapshotHtml({
  byVersion = {},
  sortedVersions = [],
  breakdownDataMap = {},
  gateDataMap = {},
  checkpointHistory = {},
  tierSummaries = {},
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
      jiraBaseUrl,
      checkpointHistory,
      tierSummaries[version] || null
    ))
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- SoS Summary | ${escapeHtml(releaseLabel)} | ${generatedAt} | audience: team-exec -->
</head>
<body style="margin:0;padding:0;background:#fff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff">
<tr><td align="center" style="padding:8px">
<table role="presentation" width="${EMAIL_MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${EMAIL_MAX_WIDTH}px;table-layout:fixed;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333">
  <tr><td style="padding:0 0 8px;overflow:hidden">
    <div style="font-size:16px;font-weight:700;color:#1a1a2e;margin:0 0 2px">SoS Summary</div>
    <div style="color:#888;font-size:10px;margin:0 0 10px">Generated ${generatedAt} · page snapshot (no live JIRA refetch)</div>
    ${sections || '<p style="font-size:12px;color:#888">No Feature or Initiative tickets in the current view.</p>'}
    <div style="color:#888;font-size:10px;margin-top:12px;border-top:1px solid #eee;padding-top:6px">Sent via Delivery Ops</div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
