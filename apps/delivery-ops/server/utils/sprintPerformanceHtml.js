/**
 * Render the Sprint Performance model as a single self-contained, interactive
 * HTML page: static org-wide sections + embedded data + an inline browser app
 * (filters, drill-down, sorting). No external scripts, fonts or styles.
 * Audience: director / team-exec.
 */

const svg = require('./svgCharts');
const metrics = require('./sprintPerformanceMetrics');
const { sprintPerformanceApp } = require('./sprintPerformanceClient');
const timeline = require('./sprintPerformanceTimeline');

const { esc } = svg;
const RAG = { GREEN: ['#2b8a3e', '#ebfbee'], YELLOW: ['#e67700', '#fff9db'], RED: ['#c92a2a', '#fff5f5'] };
const FLAGS = ['added', 'removed', 'done', 'carried', 'devDone', 'testDone', 'qaVerified', 'pendingQA', 'unresolvedNow', 'isTest', 'doneElsewhere'];

const a = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>` : text);

function indexer() {
  const list = [];
  const idx = new Map();
  return {
    list,
    id(v) {
      const k = v ?? '';
      if (!idx.has(k)) { idx.set(k, list.length); list.push(k); }
      return idx.get(k);
    },
  };
}

function buildPayload(model) {
  const d = { teams: indexer(), managers: indexer(), leaders: indexer(), people: indexer(), types: indexer(), statuses: indexer(), resolutions: indexer(), versions: indexer() };
  const versionInfo = {};
  const ver = (v) => { versionInfo[v.name] = [v.released ? 1 : 0, v.releaseDate || '']; return d.versions.id(v.name); };
  const issues = {};
  const groups = { managers: {}, leaders: {} };
  const rows = model.rows.map((r) => {
    if (!issues[r.key]) {
      const lv = r.live || {};
      const shipped = metrics.shippedIn(r.live);
      issues[r.key] = [r.summary.slice(0, 100), d.statuses.id(r.statusNow), d.types.id(r.issuetype), d.resolutions.id(lv.resolution || ''),
        lv.resolved || '', (lv.fixVersions || []).map(ver), shipped ? ver(shipped) : -1];
    }
    if (r.managerGroup) groups.managers[r.manager] = r.managerGroup;
    if (r.leaderGroup) groups.leaders[r.leader] = r.leaderGroup;
    const flags = FLAGS.reduce((acc, f, i) => {
      const v = f === 'isTest' ? r.issuetype === 'Test' : r[f];
      return v ? acc | (1 << i) : acc;
    }, 0);
    return [r.key, r.slot, r.sprintId, d.teams.id(r.scrumTeam), d.managers.id(r.manager), d.leaders.id(r.leader),
      d.people.id(r.assignee), flags, r.sp, r.sprintCountEver, d.statuses.id(r.status)];
  });
  return {
    meta: { ...model.meta, unassignedLabel: metrics.UNASSIGNED },
    dict: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.list])),
    groups,
    issues,
    versionInfo,
    sprints: Object.fromEntries(model.sprints.map((s) => [s.id, s.name])),
    rows,
  };
}

function verdict(model) {
  const { rag, trend } = model.overall;
  const cfg = model.meta.config;
  const [fg, bg] = RAG[rag];
  const dir = trend.recent >= trend.early ? 'up' : 'down';
  const k = cfg.trendSlots;
  const why = `Org-wide say/do ${trend.recent}% over the last ${k} sprints (green ≥${cfg.rag.greenSayDoPct}%, yellow ≥${cfg.rag.yellowSayDoPct}%), ${dir} from ${trend.early}% in the ${k} before.`;
  return `<div class="verdict" style="border-left:6px solid ${fg};background:${bg}"><span class="rag" style="background:${fg}">${rag}</span><span>${esc(why)}</span></div>`;
}

function bulletList(items, cls) {
  return `<ul class="${cls}">${items.map((i) => `<li>${esc(i.text)}${i.cites?.length ? ` <span class="cite">${i.cites.map((c) => a(c.url, esc(c.label))).join(' · ')}</span>` : ''}</li>`).join('')}</ul>`;
}

function hygieneTable(model) {
  const h = model.hygiene;
  const name = (s) => a(s.url, esc(s.name));
  const rows = [
    ...h.staleActive.map((s) => `<tr><td>${name(s)}</td><td>Still open</td><td>ended ${esc(s.endDate)}</td><td class="num warn">${s.daysOverdue}d overdue</td></tr>`),
    ...h.startedEmpty.map((s) => `<tr><td>${name(s)}</td><td>Started before planning</td><td>≥90% of items added after start</td><td class="num">–</td></tr>`),
    ...h.lateClosed.map((s) => `<tr><td>${name(s)}</td><td>Closed late</td><td>ended ${esc(s.endDate)}, closed ${esc(s.completeDate)}</td><td class="num">${s.daysLate}d</td></tr>`),
  ].join('');
  return `<table class="small-table"><thead><tr><th>Sprint (opens JIRA Sprint Report)</th><th>Issue</th><th>Dates</th><th>Gap</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No hygiene issues.</td></tr>'}</tbody></table>
  <div class="caption">Last ${model.meta.config.hygieneSlots} sprint slots only.</div>`;
}

function appendix(model) {
  const cfg = model.meta.config;
  const anchor = cfg.cadenceLabelAnchor;
  const first = model.meta.slots[0];
  const last = model.meta.slots[model.meta.slots.length - 1];
  const scopeGroups = (cfg.scopeGroups || []).map((g) => `<code>${esc(g)}</code>`).join(' or ');
  return `<details class="card"><summary><h3 style="display:inline">Appendix — definitions, method, caveats</h3></summary>
  <ul class="small">
    <li><b>Who is in this report:</b> ${model.meta.scopeLabel
    ? `only assignees in ${scopeGroups} (today's JIRA group membership). Work by people outside those groups is excluded.`
    : 'all assignees on the board sprints in the window.'}</li>
    <li><b>Window:</b> ${model.meta.slots.length} sprint slots (${esc(first.name)}–${esc(last.name)}, ${esc(first.startIso)} → end of ${esc(last.name)}). The current open slot is excluded so numbers don't move under the reader.</li>
    <li><b>Source:</b> JIRA Sprint Report for every board ${esc(String(model.meta.boardId))} sprint in the window (board → Reports → Sprint Report). Per-sprint Completed / Not Completed / Removed counts match that page. Click a heatmap cell → sprint name to compare.</li>
    <li><b>Unit:</b> one issue listed in one sprint's report. <b>Items</b> = Completed + Not Completed + Removed (+ completed outside the sprint).</li>
    <li><b>Done (sprint math)</b> = JIRA "Completed Issues" when the sprint closed. <b>Planned</b> = items − mid-sprint adds (*). <b>Say/Do</b> = planned completed ÷ planned. <b>Completion</b> = all completed ÷ all items. <b>Scope added</b> = added ÷ planned.</li>
    <li><b>Tickets that slipped</b> = distinct tickets that appeared in "Issues Not Completed" at least once in the selected range (not a sum of per-sprint rows). "Still open today" uses each ticket's <i>current</i> JIRA status.</li>
    <li><b>Status now vs at close:</b> KPI tiles, chronic list and QA queue use live status / fix versions fetched at report generation. The sprint drill-down keeps the status from the Sprint Report (at close) so it matches JIRA.</li>
    <li><b>Chronic carry-over:</b> tickets planned into ${cfg.chronicCarryoverSprints}+ sprints in the window (non-removed appearances). Tabs split Still open / Resolved (awaiting QA) / Closed. <b>Shipped in</b> = earliest released fix version dated on/after the closed date.</li>
    <li><b>Discipline timeline:</b> splits say/do into phases where the level shifts ≥${cfg.phaseMinShiftPts || 8} pts for ≥${cfg.phaseMinSprints || 3} sprints. Release gates come from the curated <code>releaseGateDates</code> calendar (CC / CG / PG / GA; hollow ◇ = superseded date).</li>
    <li><b>Mid-sprint churn by release:</b> unique mid-sprint-added tickets attributed by current fix version (excludes <code>master</code> / long-lived buckets). Share is of those tickets that have a product fix version.</li>
    <li><b>Trend</b> = say/do of the last ${cfg.trendSlots} sprints vs the ${cfg.trendSlots} before. Teams with no sprint in the last ${cfg.trendSlots} slots are hidden from rankings unless you show retired teams.</li>
    <li><b>Velocity streams</b> exclude portfolio types (${esc(cfg.portfolioIssueTypes.join(', '))}); headline tiles include every issue type, as the Sprint Report does. <b>QA verification</b> = Bug/Improvement completed and Closed, ×${cfg.qaVerificationRatio} (adjusted count, not story points).</li>
    <li><b>Org roll-up:</b> manager = <code>Team-*-DirectReports</code>. ${cfg.scopeGroups?.length
    ? 'With a scope filter, each person rolls up under the matching scope org (e.g. BharatKumar Beedu / Ashish Kumar).'
    : `Leader = largest <code>Team-*-Org</code> holding ≤${cfg.leaderMaxSharePct}% of sprint items (by majority of each manager's reports).`} Groups reflect membership at generation time. If a group owner's JIRA account is inactive (they left), that group is skipped — people fall through to another live DirectReports group when they have one, otherwise <b>Unmapped (manager left)</b>.</li>
    <li><b>Links:</b> one sprint → its JIRA Sprint Report. Narrow filters (team / manager / short range) → ticket search. When a search URL would be too long for JIRA (Tomcat header limit), the number stays plain and a <b>copy JQL</b> button appears — paste into Issues → Advanced search. Multi-sprint JIRA searches show distinct tickets and omit removed issues, so totals can differ from summed per-sprint counts.</li>
    ${anchor ? `<li><b>Sprint slots</b> use the 3-week cadence with S${anchor.number} start = ${esc(anchor.startIso)}; each scrum team's own sprint name may differ.</li>` : ''}
    ${model.meta.stillOpenLastSlot.length ? `<li><b>Latest slot still closing:</b> ${model.meta.stillOpenLastSlot.length} sprints were active at generation; their Sprint Report numbers may still move.</li>` : ''}
  </ul></details>`;
}

function plainText(model) {
  const lines = [
    `${model.meta.teamName} Sprint Performance — ${model.meta.slots[0].name}–${model.meta.slots[model.meta.slots.length - 1].name}`,
    `Verdict: ${model.overall.rag} (say/do ${model.overall.trend.recent}% last 3 sprints)`,
    'Highlights:', ...model.highlights.map((h) => `+ ${h.text}`),
    'Lowlights:', ...model.lowlights.map((h) => `- ${h.text}`),
    'Asks:', ...model.asks.map((x) => `* ${x.text} (${x.owner})`),
  ];
  return `<noscript><div style="white-space:pre-wrap">${esc(lines.join('\n'))}</div></noscript>`;
}

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#f8f9fa;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#212529}
.wrap{max-width:1360px;margin:0 auto;padding:16px 20px 40px}a{color:#1c7ed6;text-decoration:none}a:hover{text-decoration:underline}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:10px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#495057}h3{font-size:14px;margin:0 0 8px}
.muted{color:#868e96}.small{font-size:12px}.caption{font-size:11px;color:#868e96;margin-top:6px}.ok{color:#2b8a3e;font-weight:600}
.badge{display:inline-block;border:1px solid #dee2e6;border-radius:12px;padding:2px 10px;font-size:11px;color:#495057;background:#fff}
.verdict{display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:6px;margin:8px 0 12px;font-size:14px}
.rag{color:#fff;font-weight:700;border-radius:4px;padding:3px 10px;font-size:12px;letter-spacing:.05em}
.filters{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:8px 12px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,.04)}
.filters select,.filters input{font:inherit;padding:4px 8px;min-height:2rem;border:1px solid #ced4da;border-radius:6px;background:#fff;max-width:240px}
.filters .summary{flex:1 1 100%;font-size:12px;color:#495057}
.btn{font:inherit;min-height:2rem;padding:4px 12px;border:1px solid #ced4da;border-radius:6px;background:#fff;cursor:pointer}.btn:hover{background:#f1f3f5}.copyjql{font:inherit;font-size:10px;font-weight:500;color:#1c7ed6;background:#e7f5ff;border:1px solid #a5d8ff;border-radius:4px;padding:0 5px;margin-left:3px;cursor:pointer;vertical-align:middle;letter-spacing:0;text-transform:none}.copyjql:hover{background:#d0ebff}.btn.on{background:#e7f5ff;border-color:#74c0fc;color:#1864ab;font-weight:600}.btn.link{border:0;background:none;color:#1c7ed6;padding:6px 0}
.tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.tile{background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:10px 12px}
.tile-label{font-size:11px;text-transform:uppercase;color:#868e96;letter-spacing:.04em}.tile-value{font-size:26px;font-weight:700;margin:2px 0}.tile-value a{color:#212529}
.tile-sub{font-size:11px;color:#868e96}.delta{font-weight:600;margin-left:4px}.delta.up{color:#2b8a3e}.delta.down{color:#c92a2a}.delta.flat{color:#868e96}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:12px 14px;margin-bottom:12px;overflow-x:auto}
ul.hl,ul.ll{margin:0;padding-left:18px}ul.hl li,ul.ll li{margin:5px 0}ul.hl li::marker{content:"▲  ";color:#2b8a3e}ul.ll li::marker{content:"▼  ";color:#c92a2a}
.cite{font-size:11px;color:#868e96}.cite a{color:#868e96;border-bottom:1px dotted #adb5bd}
table{border-collapse:collapse;width:100%}th{font-size:11px;text-transform:uppercase;color:#868e96;text-align:left;padding:5px 6px;border-bottom:2px solid #dee2e6;white-space:nowrap}
th.sort{cursor:pointer}th.sort:hover{color:#1c7ed6}th.sort.on{color:#1c7ed6}th.sort.on::after{content:" ▾"}
td{padding:4px 6px;border-bottom:1px solid #f1f3f5;vertical-align:middle}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
table.heat td.num{text-align:center;border:2px solid #fff;border-radius:4px;padding:3px 2px;font-size:11px;min-width:26px}table.heat th{padding:4px 2px;font-size:10px}table.heat td.name,table.heat th:first-child{position:sticky;left:0;background:#fff;z-index:1}table.heat td.cell{cursor:pointer}table.heat td.cell:hover{outline:2px solid #1c7ed6}
td.strong{font-weight:700}td.warn,.warn{color:#c92a2a;font-weight:600}td.name{font-weight:600;white-space:nowrap}td.indent{padding-left:22px;font-weight:500}
tr.leader td{background:#f8f9fa;font-weight:700;border-top:2px solid #dee2e6}tr.dim td{opacity:.6}
a.pick{color:#212529;border-bottom:1px dashed #adb5bd}a.pick:hover{color:#1c7ed6;text-decoration:none}a.ext{font-size:11px;color:#adb5bd;margin-left:3px}a.ext:hover{color:#1c7ed6}
.small-table td{font-size:12px}.scrollbox{max-height:640px;overflow:auto;border:1px solid #f1f3f5;border-radius:6px}.scrollbox thead th{position:sticky;top:0;background:#fff;z-index:1}@media print{.scrollbox{max-height:none;overflow:visible}}.drill-sec{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#495057}.star{color:#e67700;font-weight:700}code{font-size:11px;background:#f1f3f5;padding:1px 4px;border-radius:3px}details summary{cursor:pointer}footer{font-size:11px;color:#868e96;margin-top:16px}
#drill{display:none;position:fixed;inset:0;background:rgba(33,37,41,.35);z-index:20}#drill.open{display:block}
#drill .panel{position:absolute;top:0;right:0;bottom:0;width:min(860px,95vw);background:#fff;box-shadow:-4px 0 18px rgba(0,0,0,.15);padding:16px 18px;overflow:auto}
@media print{body{background:#fff}.filters{position:static}.card{break-inside:avoid}}
@media (max-width:1100px){.tiles{grid-template-columns:repeat(3,1fr)}.grid2{grid-template-columns:1fr}}`;

function inlineLibs() {
  return [
    `const esc = ${svg.esc.toString()};`,
    svg.barLineChart.toString(),
    svg.groupedBars.toString(),
    svg.sparkline.toString(),
    svg.subLabelHeight.toString(),
    svg.subLabelText.toString(),
    `const pct = ${metrics.pct.toString()};`,
    metrics.agg.toString(),
    metrics.halves.toString(),
    timeline.segmentPhases.toString(),
    timeline.disciplineChart.toString(),
    timeline.renderDisciplineTimeline.toString(),
    sprintPerformanceApp.toString(),
  ].join('\n');
}

function renderSprintPerformanceHtml(model) {
  const { meta } = model;
  const first = meta.slots[0];
  const last = meta.slots[meta.slots.length - 1];
  const date = meta.generatedAt.slice(0, 10);
  const title = `${meta.teamName} Sprint Performance Review — ${first.name}–${last.name}`;
  const data = JSON.stringify(buildPayload(model)).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
  return `<!DOCTYPE html>
<!-- Sprint | ${esc(meta.teamName)} | ${first.name}-${last.name} | ${date} -->
<!-- audience: director -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="wrap">
${plainText(model)}
<header>
  <div><h1>${esc(title)}</h1>
  <div class="muted">${esc(first.range)} ${first.startIso.slice(0, 4)} → ${esc(last.range)} ${last.startIso.slice(0, 4)} · ${meta.sprintCount} sprints · ${model.scrumTeams.length} scrum teams · ${meta.people} people · ${meta.uniqueIssues.toLocaleString()} tickets</div></div>
  <div>${meta.scopeLabel ? `<span class="badge" title="JIRA groups">Scope: ${esc(meta.scopeLabel)}</span> ` : ''}<span class="badge">Audience: Director / Team Exec</span> <span class="badge">Live JIRA · ${esc(meta.generatedAt.replace('T', ' ').slice(0, 16))} UTC</span></div>
</header>
${verdict(model)}

<h2>Executive summary <span class="muted small">(org-wide)</span></h2>
<div class="grid2">
  <div class="card"><h3 style="color:#2b8a3e">Highlights</h3>${bulletList(model.highlights, 'hl')}</div>
  <div class="card"><h3 style="color:#c92a2a">Lowlights</h3>${bulletList(model.lowlights, 'll')}</div>
</div>

<h2>Explore</h2>
<div class="filters" id="filters">
  <select id="f-range" aria-label="Sprint range"></select>
  <select id="f-leader" aria-label="Leader"></select>
  <select id="f-manager" aria-label="Manager"></select>
  <select id="f-team" aria-label="Scrum team"></select>
  <select id="f-work" aria-label="Work type"><option value="all">All work</option><option value="dev">Dev work (non-Test)</option><option value="test">Test work</option></select>
  <button class="btn" id="f-reset">Reset</button>
  <div class="summary" id="f-summary"></div>
</div>
<div class="tiles" id="tiles"></div>

<h2>Discipline timeline</h2>
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h3>When was sprint discipline strong, and when did it slip?</h3>
  <div class="small" id="gate-kinds">Release gates:
    <label><input type="checkbox" value="CCM" checked> Code Complete</label>
    <label><input type="checkbox" value="CG" checked> Commit Gate</label>
    <label><input type="checkbox" value="PG" checked> Promotion Gate</label>
    <label><input type="checkbox" value="GA" checked> GA</label>
    <label><input type="checkbox" value="EC"> EC</label>
    <label style="margin-left:8px"><input type="checkbox" id="gate-superseded" checked> superseded dates</label></div></div>
  <div id="timeline-narrative"></div>
  <div id="timeline-chart" style="margin-top:8px"></div>
  <div class="caption">Phases are found automatically: the say/do series is split where the level shifts by ${model.meta.config.phaseMinShiftPts || 8}+ points for ${model.meta.config.phaseMinSprints || 3}+ sprints. Band colour = phase level (green ≥ ${model.meta.config.rag.greenSayDoPct}%, amber ≥ ${model.meta.config.rag.yellowSayDoPct}%). Gate dates come from the curated release gate calendar (releaseGateDates); hollow ◇ = a date that was later moved. Follows the filters above.</div>
  <h3 style="margin-top:14px">Say/Do around each release gate</h3>
  <div id="timeline-gates"></div>
</div>

<h2>Trending</h2>
<div>
  <div class="card"><h3>Delivery trend</h3><div id="chart-trend"></div><div class="caption">Bars: items in sprint reports per slot (all scrum teams). Lines: say/do and completion.</div></div>
  <div class="card"><h3>Three velocity streams</h3><div id="chart-streams"></div><div class="caption">Dev = non-Test items completed · QA verification = Bug/Improvement completed and Closed, adjusted 1:3 · Test = Test-type items completed.</div></div>
</div>

<h2>Scrum teams</h2>
<div class="card"><h3>Say/do by sprint</h3><div id="heatmap"></div>
<div class="caption">Cells show say/do % per sprint. Click a cell for the same Completed / Not Completed / Removed lists as JIRA, with a link to that sprint's JIRA Sprint Report · click a team name to filter · click a column header to sort.</div></div>

<h2 id="org-heading">Organisation</h2>
<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 id="org-title">By leader and manager</h3>
  <label class="small muted">Sort <select id="f-orgsort" class="btn"><option value="items">Most items</option><option value="sayDo">Highest say/do</option><option value="sayDoAsc">Lowest say/do</option><option value="trend">Biggest decline</option></select></label></div>
  <div id="org"></div>
  <div class="caption" id="org-caption">Reporting lines come from each assignee's JIRA directory groups (<code>Team-&lt;Name&gt;-DirectReports</code> / <code>-Org</code>) today. Click a name to filter; ↗ opens that group's sprint items in JIRA.</div></div>

<div class="card" id="sprint-roster-card" hidden>
  <h3 id="sprint-roster-title">Sprints</h3>
  <div id="sprint-roster"></div>
  <div class="caption">Every JIRA sprint with work under the current filter. Sprint name opens that sprint's JIRA Sprint Report.</div>
</div>

<h2>Risks</h2>
<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h3 id="chronic-title">Chronic carry-over</h3>
  <input id="f-q" class="btn" placeholder="Search key, summary, assignee…" style="min-width:260px"></div><div id="chronic"></div></div>
<div class="card"><h3>Sprint hygiene <span class="muted small">(org-wide)</span></h3>${hygieneTable(model)}</div>

<h2>Asks of leadership <span class="muted small">(org-wide)</span></h2>
<div class="card"><table><thead><tr><th>#</th><th>Ask</th><th>Owner</th></tr></thead><tbody>
${model.asks.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${esc(x.text)}</td><td class="muted">${esc(x.owner)}</td></tr>`).join('')}
</tbody></table></div>

${appendix(model)}
<footer>Source: JIRA Sprint Report (board ${esc(String(meta.boardId || ''))}) for each sprint via sprintPerformanceService · generated ${esc(meta.generatedAt.replace('T', ' ').slice(0, 16))} UTC · every number links to the JIRA query behind it.</footer>
</div>

<div id="drill" role="dialog" aria-modal="true"><div class="panel">
  <div style="display:flex;justify-content:space-between;align-items:center"><h3 id="drill-title"></h3><button class="btn" id="drill-close">Close ✕</button></div>
  <div class="small" id="drill-stats" style="margin-bottom:8px"></div><div id="drill-body"></div>
</div></div>

<script>
${inlineLibs()}
sprintPerformanceApp(${data});
</script>
</body></html>`;
}

module.exports = { renderSprintPerformanceHtml };
