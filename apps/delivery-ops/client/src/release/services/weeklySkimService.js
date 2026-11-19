/**
 * HTTP + HTML export for Weekly Skim.
 * Components render; hooks fetch; this file is HTTP / pure transform only.
 */

import { authenticatedPost, getApiBase } from '../../shared/services/apiService';
import { jiraSearchUrl } from './releaseBriefService';

const API_BASE = getApiBase();

/**
 * @param {{ productId?: string, releases: string[], jiraToken: string, username: string }} args
 */
export async function generateWeeklySkim({
  productId = 'ndb',
  releases,
  jiraToken,
  username,
}) {
  const res = await authenticatedPost(
    `${API_BASE}/api/ai/weekly-skim`,
    { productId, releases },
    { jiraToken, username }
  );
  return res?.data || null;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtGa(ga) {
  if (!ga) return '—';
  try {
    const d = new Date(ga);
    if (Number.isNaN(d.getTime())) return esc(ga);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return esc(ga);
  }
}

function pill(metric, jiraBaseUrl, label, bg, fg) {
  if (metric?.count == null) return '';
  const href = jiraSearchUrl(jiraBaseUrl, metric.jql);
  const style = `display:inline-block;font-size:9pt;font-weight:700;padding:2px 6px;margin:0 4px 4px 0;border-radius:3px;background:${bg};color:${fg};text-decoration:none;`;
  const body = `${esc(label)} ${metric.count}`;
  if (!href) return `<span style="${style}">${body}</span>`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="${style}" title="Open in JIRA">${body}</a>`;
}

function ragStripHtml(rows, team) {
  const ok = (rows || []).filter((r) => !r.error);
  if (!ok.length) return '';
  const prefixes = team?.releasePrefixes || team?.releasePrefix ? (team.releasePrefixes || [team.releasePrefix]) : null;
  const strip = (v) => {
    if (!v) return v;
    if (prefixes) { const s = [...prefixes].sort((a,b)=>b.length-a.length); for (const p of s) if (p && v.startsWith(p)) return v.slice(p.length); }
    return String(v).replace(/^[A-Za-z][A-Za-z0-9]*[- ]/, '');
  };
  const cards = ok
    .map((r) => {
      const bg =
        r.rag === 'RED' ? '#fcebea' : r.rag === 'YELLOW' ? '#fff8e6' : '#e3fcef';
      const fg =
        r.rag === 'RED' ? '#c9372c' : r.rag === 'YELLOW' ? '#b38600' : '#1f7a1f';
      const short = strip(String(r.release || ''));
      return `<td style="background:${bg};border:1px solid #d0d7de;padding:6px 8px;text-align:center;">
        <div style="font-size:8pt;font-weight:800;color:${fg};">${esc(r.rag || '?')}</div>
        <div style="font-size:10pt;font-weight:600;">${esc(short)}</div>
      </td>`;
    })
    .join('');
  return `<table style="border-collapse:separate;border-spacing:4px;margin:0 0 12px;"><tr>${cards}</tr></table>`;
}

/**
 * Outlook-friendly skim HTML — PDF #248 column shape + visual RAG strip.
 */
export function buildWeeklySkimHtml(payload, { jiraBaseUrl = 'https://jira.nutanix.com', team = null } = {}) {
  const rows = payload?.rows || [];
  const chase = payload?.chase || [];
  const thisWeek = payload?.thisWeek || '';
  const when = payload?.generatedAt
    ? new Date(payload.generatedAt).toLocaleString()
    : new Date().toLocaleString();

  const tableRows = rows
    .map((r) => {
      if (r.error) {
        return `<tr>
          <td style="border:1px solid #d0d7de;padding:8px 10px;">${esc(r.release)}</td>
          <td colspan="3" style="border:1px solid #d0d7de;padding:8px 10px;color:#c9372c;">${esc(r.error)}</td>
        </tr>`;
      }
      const ragColor =
        r.rag === 'RED' ? '#c9372c' : r.rag === 'YELLOW' ? '#b38600' : '#1f7a1f';
      const pills = [
        pill(r.open, jiraBaseUrl, 'Open', '#f4f5f7', '#172B4D'),
        pill(
          r.p0,
          jiraBaseUrl,
          'P0',
          r.p0?.count > 0 ? '#fcebea' : '#f4f5f7',
          r.p0?.count > 0 ? '#c9372c' : '#172B4D'
        ),
        pill(
          r.mustFix,
          jiraBaseUrl,
          'Must-fix',
          r.mustFix?.count > 0 ? '#fff8e6' : '#f4f5f7',
          r.mustFix?.count > 0 ? '#b38600' : '#172B4D'
        ),
      ].join('');
      return `<tr>
        <td style="border:1px solid #d0d7de;padding:8px 10px;vertical-align:top;"><strong>${esc(r.release)}</strong></td>
        <td style="border:1px solid #d0d7de;padding:8px 10px;vertical-align:top;">${fmtGa(r.ga)}</td>
        <td style="border:1px solid #d0d7de;padding:8px 10px;vertical-align:top;">${esc(r.keyContent || '—')}</td>
        <td style="border:1px solid #d0d7de;padding:8px 10px;vertical-align:top;">
          <div style="color:${ragColor};font-weight:700;font-size:9pt;margin-bottom:4px;">${esc(r.rag || '')}</div>
          <div>${pills}</div>
          <div style="font-size:9pt;color:#42526e;margin-top:4px;">${esc(r.pulse || '')}</div>
        </td>
      </tr>`;
    })
    .join('\n');

  const chaseHtml =
    chase.length === 0
      ? '<p style="margin:0;color:#6c757d;">No chase items this week.</p>'
      : `<ol style="margin:0;padding-left:1.25rem;">${chase
          .map(
            (c) =>
              `<li style="margin:0.25rem 0;"><span style="color:#6c757d;">${esc(c.release)}</span> — ${esc(c.text)}</li>`
          )
          .join('')}</ol>`;

  const teamLabel = team?.label || 'NDB';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<!-- Weekly-Status | ${esc(teamLabel)} | Skim | ${esc(when)} -->
<!-- audience: team-exec -->
<title>${esc(teamLabel)} Weekly Skim</title>
</head>
<body style="font-family:Aptos,Segoe UI,Calibri,Arial,sans-serif;font-size:11pt;color:#172B4D;margin:0;padding:16px;background:#fff;">
<div style="max-width:800px;">
  <h1 style="font-size:14pt;margin:0 0 4px;border-bottom:2px solid #0052cc;padding-bottom:4px;">${esc(teamLabel)} Weekly Skim</h1>
  <p style="margin:0 0 12px;font-size:9pt;color:#6c757d;">Generated ${esc(when)}</p>

  ${ragStripHtml(rows, team)}

  <div style="background:#e8f4fd;border:1px solid #0052cc;padding:12px 14px;margin:0 0 14px;">
    <div style="font-size:9pt;font-weight:700;letter-spacing:0.04em;color:#0052cc;margin-bottom:4px;">THIS WEEK</div>
    <p style="margin:0;line-height:1.4;">${esc(thisWeek)}</p>
  </div>

  <div style="margin:0 0 14px;">
    <div style="font-size:9pt;font-weight:700;letter-spacing:0.04em;color:#172B4D;margin-bottom:6px;">CHASE</div>
    ${chaseHtml}
  </div>

  <table style="border-collapse:collapse;width:100%;font-size:10pt;margin:0 0 14px;">
    <thead>
      <tr>
        <th style="background:#172B4D;color:#fff;text-align:left;padding:8px 10px;border:1px solid #d0d7de;">Projects</th>
        <th style="background:#172B4D;color:#fff;text-align:left;padding:8px 10px;border:1px solid #d0d7de;">Release Date</th>
        <th style="background:#172B4D;color:#fff;text-align:left;padding:8px 10px;border:1px solid #d0d7de;">Key Content</th>
        <th style="background:#172B4D;color:#fff;text-align:left;padding:8px 10px;border:1px solid #d0d7de;">Risks / Status</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <p style="margin:16px 0 0;font-size:8pt;color:#6c757d;">Counts link to JIRA. Deep dive: Release Brief in Delivery Ops.</p>
</div>
</body>
</html>`;
}

export function downloadWeeklySkimHtml(payload, opts = {}) {
  const html = buildWeeklySkimHtml(payload, opts);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const day = new Date().toISOString().slice(0, 10);
  const teamLabel = opts?.team?.label || 'NDB';
  a.href = url;
  a.download = `Weekly-Status-${teamLabel}-Skim-${day}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyWeeklySkimHtml(payload, opts) {
  const html = buildWeeklySkimHtml(payload, opts);
  // Outlook needs text/html ClipboardItem (same pattern as SprintReportPage / OutlookFallback).
  if (typeof navigator.clipboard?.write === 'function' && window.ClipboardItem) {
    const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const plainBlob = new Blob([html.replace(/<[^>]+>/g, ' ')], {
      type: 'text/plain;charset=utf-8',
    });
    await navigator.clipboard.write([
      new window.ClipboardItem({ 'text/html': htmlBlob, 'text/plain': plainBlob }),
    ]);
  } else {
    await navigator.clipboard.writeText(html);
  }
  return html;
}
