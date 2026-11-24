/**
 * OnCalls V2 — HTML report builder + preview/send via same SMTP path as Outstanding.
 * Reuses Outstanding pattern: buildOncallReportHtml + previewOrSendOncallReport → sendEmailDirect.
 * Data: oncallDashboardV2.getDashboard() (timeframe-scoped hero/health/taxonomy + ticket samples).
 */
const fs = require('fs');
const path = require('path');
const { sendEmailDirect } = require('./emailService');
const { getDashboard } = require('./oncallDashboardV2');

const CC_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsCCConfig.json');
const DEFAULT_REPORT_TO = 'ndb-exec-updates@nutanix.com';
const DEFAULT_LEADERSHIP_CC = ['ndb-tech-leads@nutanix.com', 'ndb-managers@nutanix.com'];

function toEmail(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();
  return `${s}@nutanix.com`.toLowerCase();
}
function uniqEmails(list) {
  return [...new Set((list || []).map(toEmail).filter(Boolean))];
}
function leadershipCc() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CC_CONFIG_PATH, 'utf8'));
    if (Array.isArray(cfg.mustFixLeadershipCC) && cfg.mustFixLeadershipCC.length) return uniqEmails(cfg.mustFixLeadershipCC);
  } catch {}
  return uniqEmails(DEFAULT_LEADERSHIP_CC);
}
function defaultRecipients() {
  return { to: [DEFAULT_REPORT_TO], cc: leadershipCc() };
}
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function jiraIssuesUrl(jiraBaseUrl, jql) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/$/, '');
  return `${base}/issues/?jql=${encodeURIComponent(jql || '')}`;
}
function jiraBrowseUrl(jiraBaseUrl, key) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/$/, '');
  return `${base}/browse/${encodeURIComponent(key)}`;
}
const TH = 'padding:6px 8px;border:1px solid #e4e4e7;background:#f4f4f5;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;color:#52525b;white-space:nowrap;';
const TD = 'padding:6px 8px;border:1px solid #e4e4e7;vertical-align:top;font-size:12px;word-break:break-word;';
function heroCellHtml(cell, jiraBaseUrl) {
  const n = cell?.count ?? 0;
  const jql = cell?.jql || '';
  if (!jql) return `${n}`;
  const url = jiraIssuesUrl(jiraBaseUrl, jql);
  return `<a href="${escapeHtml(url)}" style="color:#2563eb;text-decoration:none;font-weight:600;">${n}</a> <a href="${escapeHtml(url)}" style="font-size:11px;color:#2563eb;">Open in JIRA ↗</a>`;
}
function ticketRowsHtml(tickets, jiraBaseUrl) {
  if (!tickets || !tickets.length) return '<p style="font-size:12px;color:#71717a;">No tickets in sample.</p>';
  return `<div style="overflow-x:auto;"><table style="width:100%;min-width:700px;border-collapse:collapse;"><thead><tr><th style="${TH}">Key</th><th style="${TH}">Summary</th><th style="${TH}">Status</th><th style="${TH}">Priority</th><th style="${TH}">Assignee</th><th style="${TH}">Age</th></tr></thead><tbody>${tickets.map((t) => `<tr><td style="${TD}"><a href="${escapeHtml(jiraBrowseUrl(jiraBaseUrl, t.key))}" style="color:#2563eb;text-decoration:none;font-weight:600;">${escapeHtml(t.key)}</a></td><td style="${TD}">${escapeHtml(t.summary || '—')}</td><td style="${TD}">${escapeHtml(t.status || '—')}</td><td style="${TD}">${escapeHtml(t.priority || '—')}</td><td style="${TD}">${escapeHtml(t.assignee || '—')}</td><td style="${TD}">${t.ageDays != null ? `${t.ageDays}d` : t.cycleDays != null ? `${t.cycleDays}d` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}
function buildOncallReportHtml({ teamId, timeframe, dashboard, aiConcern }) {
  const d = dashboard || {};
  const jiraBaseUrl = d.jiraBaseUrl || 'https://jira.nutanix.com';
  const hero = d.hero || {};
  const health = d.health || {};
  const workflow = d.workflow || {};
  const gap = d.gapTaxonomy || {};
  const ndbSub = gap.ndbSub || {};
  const asOf = d.asOf ? new Date(d.asOf).toLocaleString() : new Date().toLocaleString();
  const rag = d.rag || null;
  const openTickets = d.openTickets || [];
  const closedPreview = d.closedStacksPreview || [];
  const compMix = d.componentMix || [];
  const hotspot = compMix.slice(0, 2).map((c) => `${c.name} (${c.count})`).join(' · ') || '—';
  const gapChips = [
    gap.duds ? `Duds ${gap.duds.count ?? 0}` : null,
    gap.ndbGaps ? `NDB gaps ${gap.ndbGaps.count ?? 0}` : null,
    gap.otherTeamGaps ? `Other-team ${gap.otherTeamGaps.count ?? 0}` : null,
  ].filter(Boolean).join(' · ');
  return `<!-- OnCalls | ${escapeHtml(teamId)} | ${escapeHtml(timeframe)} | ${escapeHtml(asOf)} -->
<!-- audience: team-exec -->
<div style="box-sizing:border-box;width:99%;max-width:99%;margin:0 auto;padding:0 0.5%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;font-size:14px;line-height:1.4;">
  <h1 style="font-size:clamp(18px,2.2vw,22px);margin:0 0 6px;">OnCalls — ${escapeHtml(teamId)} · ${escapeHtml(timeframe)}</h1>
  <p style="margin:0 0 8px;font-size:12px;color:#52525b;">as of ${escapeHtml(asOf)} · <a href="${escapeHtml(jiraIssuesUrl(jiraBaseUrl, d.baseScopeJql || ''))}" style="color:#2563eb;">Scope JQL</a> ${d.elapsedMs ? `· ${d.elapsedMs}ms` : ''}</p>
  ${rag ? `<div style="display:inline-block;padding:4px 10px;border-radius:999px;font-weight:700;font-size:12px;margin:0 0 12px;background:${rag.level === 'RED' ? '#fee2e2' : rag.level === 'YELLOW' ? '#ffedd5' : '#dcfce7'};color:${rag.level === 'RED' ? '#b91c1c' : rag.level === 'YELLOW' ? '#c2410c' : '#15803d'};border:1px solid ${rag.level === 'RED' ? '#fecaca' : rag.level === 'YELLOW' ? '#fed7aa' : '#bbf7d0'};">${escapeHtml(rag.level)} — ${escapeHtml(rag.why || '')}</div>` : ''}
  ${aiConcern ? `<div style="border:1px solid #e4e4e7;border-radius:8px;padding:12px;background:#f9fafb;margin:0 0 14px;white-space:pre-wrap;font-size:13px;"><strong>AI Concern — ${escapeHtml(timeframe)}</strong><div style="margin-top:6px;">${escapeHtml(aiConcern)}</div></div>` : ''}
  <h2 style="font-size:15px;margin:14px 0 6px;">Heroes — current stock</h2>
  <div style="width:100%;overflow-x:auto;margin:0 0 12px;"><table style="width:100%;min-width:600px;border-collapse:collapse;"><tr>
    <td style="width:20%;padding:10px 12px;border:1px solid #e4e4e7;vertical-align:top;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;">Open now</div><div style="font-size:22px;font-weight:700;">${heroCellHtml(hero.open, jiraBaseUrl)}</div><div style="font-size:11px;color:#52525b;">All open OnCalls in scope</div></td>
    <td style="width:20%;padding:10px 12px;border:1px solid #e4e4e7;vertical-align:top;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;">Aged &gt;${d.agedOpenDays ?? 14}d</div><div style="font-size:22px;font-weight:700;">${heroCellHtml(hero.agedOpen, jiraBaseUrl)}</div><div style="font-size:11px;color:#52525b;">Needs owner chase</div></td>
    <td style="width:20%;padding:10px 12px;border:1px solid #e4e4e7;vertical-align:top;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;">Need Info</div><div style="font-size:22px;font-weight:700;">${heroCellHtml(hero.needInfoOpen || workflow.needInfo, jiraBaseUrl)}</div><div style="font-size:11px;color:#52525b;">Waiting for reporter</div></td>
    <td style="width:20%;padding:10px 12px;border:1px solid #e4e4e7;vertical-align:top;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;">Waiting for Customer</div><div style="font-size:22px;font-weight:700;">${heroCellHtml(hero.waitingCustomerOpen || workflow.waiting, jiraBaseUrl)}</div><div style="font-size:11px;color:#52525b;">Customer action pending</div></td>
    <td style="width:20%;padding:10px 12px;border:1px solid #e4e4e7;vertical-align:top;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;">Closed in window</div><div style="font-size:22px;font-weight:700;">${heroCellHtml(hero.closedInWindow, jiraBaseUrl)}</div><div style="font-size:11px;color:#52525b;">Resolved in ${escapeHtml(timeframe)}</div></td>
  </tr></table></div>
  <h2 style="font-size:15px;margin:14px 0 6px;">Health</h2>
  <div style="width:100%;overflow-x:auto;margin:0 0 12px;"><table style="width:100%;min-width:600px;border-collapse:collapse;"><tr>
    <td style="width:25%;padding:10px 12px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">MTTR median</div><div style="font-size:18px;font-weight:700;">${health.mttrMedian != null ? `${health.mttrMedian}d` : '—'}</div></td>
    <td style="width:25%;padding:10px 12px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">MTTR p90</div><div style="font-size:18px;font-weight:700;">${health.p90 != null ? `${health.p90}d` : '—'}</div></td>
    <td style="width:25%;padding:10px 12px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">Throughput</div><div style="font-size:18px;font-weight:700;">${health.throughput ?? 0}</div><div style="font-size:11px;color:#52525b;">net ${health.net ?? 0}</div></td>
    <td style="width:25%;padding:10px 12px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">Aged share</div><div style="font-size:18px;font-weight:700;">${health.agedShare ?? 0}%</div><div style="font-size:11px;color:#52525b;">${hero.agedOpen?.count ?? 0} of ${hero.open?.count ?? 0} open</div></td>
  </tr></table></div>
  <p style="font-size:12px;color:#52525b;">Hotspot: ${escapeHtml(hotspot)} · Gap: ${escapeHtml(gapChips)}</p>
  <h2 style="font-size:15px;margin:14px 0 6px;">Gap taxonomy (closed in window)</h2>
  <div style="width:100%;overflow-x:auto;margin:0 0 12px;"><table style="width:100%;min-width:600px;border-collapse:collapse;"><tr>
    <td style="width:33%;padding:10px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">Duds</div><div style="font-size:18px;font-weight:700;">${heroCellHtml(gap.duds, jiraBaseUrl)}</div><div style="font-size:11px;color:#52525b;">Duplicate/Won't Do/Cannot Reproduce/no linked fix</div></td>
    <td style="width:33%;padding:10px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">NDB gaps</div><div style="font-size:18px;font-weight:700;">${heroCellHtml(gap.ndbGaps, jiraBaseUrl)}</div></td>
    <td style="width:33%;padding:10px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">Other-team gaps</div><div style="font-size:18px;font-weight:700;">${heroCellHtml(gap.otherTeamGaps, jiraBaseUrl)}</div></td>
  </tr></table></div>
  ${ndbSub && (ndbSub.thLinked || ndbSub.bugs) ? `<div style="width:100%;overflow-x:auto;margin:0 0 12px;"><table style="width:100%;min-width:600px;border-collapse:collapse;"><tr>
    <td style="width:25%;padding:8px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">TH linked</div><div style="font-weight:700;">${heroCellHtml(ndbSub.thLinked, jiraBaseUrl)}</div></td>
    <td style="width:25%;padding:8px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">Bugs</div><div style="font-weight:700;">${heroCellHtml(ndbSub.bugs, jiraBaseUrl)}</div></td>
    <td style="width:25%;padding:8px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">Improvements</div><div style="font-weight:700;">${heroCellHtml(ndbSub.improvements, jiraBaseUrl)}</div></td>
    <td style="width:25%;padding:8px;border:1px solid #e4e4e7;"><div style="font-size:11px;color:#71717a;">Other</div><div style="font-weight:700;">${heroCellHtml(ndbSub.other, jiraBaseUrl)}</div></td>
  </tr></table></div>` : ''}
  <h2 style="font-size:15px;margin:16px 0 6px;">Open OnCalls sample (${openTickets.length}${d.errors?.openStacks ? ' — truncated' : ''})</h2>
  ${ticketRowsHtml(openTickets.slice(0, 40), jiraBaseUrl)}
  <h2 style="font-size:15px;margin:16px 0 6px;">Closed in window sample (${closedPreview.length})</h2>
  ${ticketRowsHtml(closedPreview.slice(0, 30), jiraBaseUrl)}
  <p style="font-size:12px;color:#71717a;margin-top:16px;">Live view: ${(() => { const base = (process.env.APP_BASE_URL || process.env.CLIENT_BASE_URL || '').replace(/\/$/, ''); const url = base ? `${base}/oncalls` : '/oncalls'; return `<a href="${escapeHtml(url)}" style="color:#2563eb;">${escapeHtml(url)}</a>`; })()} · Timeframe ${escapeHtml(timeframe)} · Team ${escapeHtml(teamId)}</p>
</div>`;
}
async function previewOrSendOncallReport({ token, teamId, timeframe, to, cc, previewOnly, dashboard, aiConcern }) {
  const { resolveRuntimeConfig: resolveCfg } = require('./oncallConfigResolve');
  const { TIMEFRAMES } = require('./oncallDashboardV2');
  const rawTf = String(timeframe || '7d').trim();
  const tf = TIMEFRAMES.hasOwnProperty(rawTf) ? rawTf : '7d';
  const tid = resolveCfg(teamId).teamId || String(teamId || 'ndb').trim() || 'ndb';
  let dash = dashboard;
  if (!dash || !dash.hero) {
    dash = await getDashboard({ token, teamId: tid, timeframe: tf });
  }
  const defaults = defaultRecipients();
  const toList = Array.isArray(to) && to.length ? uniqEmails(to) : defaults.to;
  // CC is server-owned like Outstanding — ignore client cc to prevent injection
  const ccList = defaults.cc;
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeTid = String(tid).replace(/[\r\n]+/g, ' ');
  const subject = `[OnCalls ${tf}] ${safeTid} — ${dash.hero?.open?.count ?? 0} open, ${dash.hero?.agedOpen?.count ?? 0} aged — ${dateStr}`;
  const html = buildOncallReportHtml({ teamId: tid, timeframe: tf, dashboard: dash, aiConcern: aiConcern || null });
  if (previewOnly) {
    return { preview: true, subject, to: toList, cc: ccList, html, story: dash.rag?.why || '', teamId: tid, timeframe: tf };
  }
  if (!toList.length) {
    const err = new Error('At least one To recipient is required');
    err.statusCode = 400;
    throw err;
  }
  const info = await sendEmailDirect({ to: toList.join(', '), cc: ccList.length ? ccList.join(', ') : undefined, subject, html });
  return { preview: false, sent: true, subject, to: toList, cc: ccList, messageId: info.messageId, teamId: tid, timeframe: tf };
}
module.exports = { buildOncallReportHtml, previewOrSendOncallReport, defaultRecipients };
