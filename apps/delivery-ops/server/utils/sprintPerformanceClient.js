/* eslint-env browser */
/* global esc, barLineChart, groupedBars, sparkline, pct, agg, halves, renderDisciplineTimeline */
/**
 * Browser-side app for the interactive Sprint Performance report.
 * Serialised with Function.prototype.toString() into the HTML, so it must be
 * self-contained apart from the helpers listed in `global` above.
 */

function sprintPerformanceApp(D) {
  const cfg = D.meta.config;
  const COLORS = { dev: '#1f77b4', qaVerify: '#ff7f0e', test: '#2ca02c', sayDo: '#5f3dc4', completion: '#1098ad', bars: '#dee2e6' };
  const FLAGS = ['added', 'removed', 'done', 'carried', 'devDone', 'testDone', 'qaVerified', 'pendingQA', 'unresolvedNow', 'isTest', 'doneElsewhere'];
  const dict = D.dict;
  const rows = D.rows.map((r) => {
    const o = {
      key: r[0], slot: r[1], sprintId: r[2], scrumTeam: dict.teams[r[3]], manager: dict.managers[r[4]],
      leader: dict.leaders[r[5]], assignee: dict.people[r[6]], sp: r[8], sprintCountEver: r[9], statusAtClose: dict.statuses[r[10]],
    };
    FLAGS.forEach((f, i) => { o[f] = Boolean(r[7] & (1 << i)); });
    return o;
  });
  const allSlots = D.meta.slots;
  const K = cfg.trendSlots || 3;
  const RANGES = [6, 12, 18].filter((n) => n < allSlots.length);
  let slots = allSlots;
  const rangeSlots = () => (state.range === 'all' ? allSlots : allSlots.slice(-Number(state.range)));
  const isFocused = () => Boolean(state.leader || state.manager || state.team);
  /** When a leader/manager/team is selected, keep only slots where they had sprint work. */
  const slotsWithWork = (candidate, rs) => {
    if (!isFocused()) return candidate;
    const active = new Set(rs.filter((r) => !r.removed).map((r) => r.slot));
    const kept = candidate.filter((s) => active.has(s.slot));
    return kept.length ? kept : candidate;
  };
  const sprintLink = (id, text) => `<a href="${esc(D.meta.sprintReportBase + id)}" target="_blank" rel="noopener" title="Open JIRA Sprint Report">${text}</a>`;
  const CHRONIC_PAGE_SIZE = 20;
  const state = Object.assign({
    range: 'all', leader: '', manager: '', team: '', work: 'all', q: '',
    orgSort: 'items', heatSort: 'sayDo', heatSortDev: 'sayDoDevFinished', showRetired: false,
    chronicView: 'all', chronicPage: 1,
  }, readHash());
  // Page is UI-only — never restore from URL hash.
  state.chronicPage = 1;
  const $ = (id) => document.getElementById(id);
  const pctTxt = (v) => (v == null ? '–' : `${v}%`);
  const creepTxt = (v) => (v == null ? '–' : v > 200 ? '>200%' : `${v}%`);
  const isJql = (u) => typeof u === 'string' && u.startsWith('jql:');
  const copyBtn = (u) => `<button class="copyjql" data-jql="${esc(u.slice(4))}" title="Too many sprints for one JIRA link. Copies the JQL — paste it into JIRA → Issues → Advanced search.">copy JQL</button>`;
  const linkOr = (u, html, style) => (!u ? html : isJql(u) ? `${html} ${copyBtn(u)}`
    : `<a href="${esc(u)}" target="_blank" rel="noopener" title="Open in JIRA"${style ? ` style="${style}"` : ''}>${html}</a>`);
  const ext = (url, title) => (!url ? '' : isJql(url) ? ` ${copyBtn(url)}` : ` <a class="ext" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(title || 'Open in JIRA')}">↗</a>`);
  const pick = (attr, val, text, cls) => `<a href="#" class="pick ${cls || ''}" data-${attr}="${esc(val)}">${text}</a>`;

  function readHash() {
    const out = {};
    new URLSearchParams(location.hash.slice(1)).forEach((v, k) => { out[k] = v; });
    return out;
  }
  function writeHash() {
    const p = new URLSearchParams();
    ['range', 'leader', 'manager', 'team', 'work'].forEach((k) => { if (state[k] && state[k] !== 'all') p.set(k, state[k]); });
    try { history.replaceState(null, '', `#${p.toString()}`); } catch (e) { /* sandboxed srcdoc frames may block history writes */ }
  }

  function heat(v) {
    if (v == null) return 'background:#f1f3f5;color:#adb5bd';
    if (v >= cfg.rag.greenSayDoPct) return 'background:#d3f9d8;color:#1b5e20';
    if (v >= cfg.rag.yellowSayDoPct) return 'background:#fff3bf;color:#7a5800';
    return 'background:#ffe3e3;color:#a51111';
  }
  function deltaHtml(e, r, higherIsBetter = true) {
    if (e == null || r == null) return '';
    const d = r - e;
    if (d === 0) return '<span class="delta flat">± 0 pts</span>';
    const good = higherIsBetter ? d > 0 : d < 0;
    return `<span class="delta ${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts</span>`;
  }
  function halfAvg(series, num, den) {
    const n = series.length;
    const k = Math.max(1, Math.min(K, Math.floor(n / 2)));
    const f = (arr) => pct(arr.reduce((s, x) => s + x[num], 0), arr.reduce((s, x) => s + x[den], 0));
    return { early: f(series.slice(n - 2 * k, n - k)), recent: f(series.slice(n - k)) };
  }
  function groupBy(list, fn) {
    const m = new Map();
    list.forEach((x) => { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
  }
  const seriesOf = (rs) => {
    const by = groupBy(rs, (r) => r.slot);
    return slots.map((s) => Object.assign({ slot: s.slot }, agg(by.get(s.slot) || [], cfg)));
  };

  function matches(r, except) {
    return r.slot >= slots[0].slot
      && (except === 'leader' || !state.leader || r.leader === state.leader)
      && (except === 'manager' || !state.manager || r.manager === state.manager)
      && (except === 'team' || !state.team || r.scrumTeam === state.team)
      && (state.work === 'all' || (state.work === 'test') === r.isTest);
  }
  const filtered = () => rows.filter((r) => matches(r));

  function jiraFor(rs, extraClauses = []) {
    const ids = Array.from(new Set(rs.map((r) => r.sprintId)));
    if (!ids.length) return null;
    const parts = [`Sprint in (${ids.join(', ')})`];
    if (!state.manager && !state.leader && D.meta.sprintScope) parts.push(D.meta.sprintScope);
    if (state.manager) {
      const g = D.groups.managers[state.manager];
      if (g) parts.push(`assignee in membersOf("${g}")`);
      else if (state.manager === D.meta.unassignedLabel) parts.push('assignee is EMPTY');
    } else if (state.leader && D.groups.leaders[state.leader]) {
      parts.push(`assignee in membersOf("${D.groups.leaders[state.leader]}")`);
    }
    if (state.work === 'test') parts.push('issuetype = Test');
    if (state.work === 'dev') parts.push('issuetype != Test');
    const jql = [...parts, ...extraClauses].join(' AND ');
    const url = `${D.meta.jiraBaseUrl}/issues/?jql=${encodeURIComponent(jql)}`;
    return url.length > 2500 ? `jql:${jql}` : url;
  }

  function renderFilters() {
    const opts = (field, except, current, all) => {
      const counts = {};
      rows.filter((r) => matches(r, except)).forEach((r) => { counts[r[field]] = (counts[r[field]] || 0) + 1; });
      const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (current && !counts[current]) names.unshift(current);
      return `<option value="">${all}</option>${names.map((n) => `<option value="${esc(n)}"${n === current ? ' selected' : ''}>${esc(n)} (${counts[n] || 0})</option>`).join('')}`;
    };
    $('f-range').innerHTML = RANGES.map((n) => `<option value="${n}"${String(n) === String(state.range) ? ' selected' : ''}>Last ${n} sprints (${esc(allSlots[allSlots.length - n].name)}–${esc(allSlots[allSlots.length - 1].name)})</option>`).join('')
      + `<option value="all"${state.range === 'all' ? ' selected' : ''}>All ${allSlots.length} sprints (${esc(allSlots[0].name)}–${esc(allSlots[allSlots.length - 1].name)}, ${esc(allSlots[0].startIso)} →)</option>`;
    $('f-leader').innerHTML = opts('leader', 'leader', state.leader, 'All leaders');
    $('f-manager').innerHTML = opts('manager', 'manager', state.manager, 'All managers');
    $('f-team').innerHTML = opts('scrumTeam', 'team', state.team, 'All scrum teams');
    $('f-work').value = state.work;
    const active = ['leader', 'manager', 'team'].filter((k) => state[k]).map((k) => state[k]);
    if (state.work !== 'all') active.push(state.work === 'dev' ? 'Dev work' : 'Test work');
    $('f-summary').innerHTML = active.length
      ? `Focused on <b>${esc(active.join(' · '))}</b> — tiles, timeline, teams, people and sprints below are theirs. Highlights / lowlights / asks above stay org-wide.`
      : 'Showing the whole org. Pick a leader, manager or team — or click any name below — to focus the page on their sprints and people.';
  }

  function renderTiles(rs) {
    const s = seriesOf(rs);
    const w = agg(rs, cfg);
    const sayDo = halves(s, K);
    const devFin = halfAvg(s, 'devFinishedPlanned', 'planned');
    const creep = halfAvg(s, 'added', 'planned');
    const all = jiraFor(rs);
    const qaUrl = jiraFor(rs, [`status = ${JSON.stringify(cfg.pendingQAStatusName || 'Resolved')}`]);
    const slipped = new Set(rs.filter((r) => r.carried).map((r) => r.key));
    const slippedOpen = Array.from(slipped).filter((k) => rs.some((r) => r.key === k && r.unresolvedNow)).length;
    const gapPts = (a, b) => (a == null || b == null ? null : Math.max(0, a - b));
    const gapRecent = gapPts(devFin.recent, sayDo.recent);
    const gapEarly = gapPts(devFin.early, sayDo.early);
    // Row 1 = QA-bandwidth story (JIRA Completed vs Dev finished). Row 2 = queue + hygiene.
    const tiles = [
      ['Say / Do (JIRA)', pctTxt(sayDo.recent), `Completed ÷ planned · last ${K} · target ≥${cfg.rag.greenSayDoPct}% ${deltaHtml(sayDo.early, sayDo.recent)}`, all, ''],
      ['Dev finished', pctTxt(devFin.recent), `Resolved∪Closed ÷ planned · last ${K} ${deltaHtml(devFin.early, devFin.recent)}`, all, ''],
      ['QA bandwidth gap', gapRecent == null ? '–' : `${gapRecent} pts`, `Dev finished − JIRA Say/Do · last ${K}${gapEarly != null && gapRecent != null ? ` ${deltaHtml(gapEarly, gapRecent, false)}` : ''} · mainly waiting on QA close`, qaUrl, 'story'],
      ['QA queue (Resolved)', w.pendingQA.toLocaleString(), 'awaiting verification now · see Dev→QA lag below', qaUrl, ''],
      ['Scope added mid-sprint', pctTxt(creep.recent), `of planned · last ${K} ${deltaHtml(creep.early, creep.recent, false)}`, all, ''],
      ['Tickets that slipped', slipped.size.toLocaleString(), `unfinished at sprint end at least once · ${slippedOpen.toLocaleString()} still open today`, all, ''],
    ];
    $('tiles').innerHTML = tiles.map(([label, value, sub, url, cls]) => `<div class="tile${cls ? ` ${cls}` : ''}"><div class="tile-label">${esc(label)}</div>
      <div class="tile-value">${linkOr(url, esc(value))}</div>
      <div class="tile-sub">${sub}</div></div>`).join('')
      + `<div class="tiles-caption">JIRA Say/Do only counts Sprint Report <b>Completed</b> (usually Closed). <b>Dev finished</b> counts Resolved∪Closed at sprint close — the <b>gap</b> is the QA-bandwidth story, not “Dev missed the sprint.” Detail in Dev→QA lag and the second heatmap.</div>`;
  }

  function renderCharts(rs) {
    const s = seriesOf(rs);
    const labels = slots.map((x) => x.name);
    const width = Math.max(640, Math.min(1300, labels.length * 38));
    const subLabels = subLabelsFor(slots);
    $('chart-trend').innerHTML = barLineChart({
      labels,
      subLabels,
      width,
      bars: { name: 'Items in sprint', color: COLORS.bars, values: s.map((x) => x.committed) },
      lines: [
        { name: 'Say/Do %', color: COLORS.sayDo, values: s.map((x) => x.sayDo) },
        { name: 'Completion %', color: COLORS.completion, values: s.map((x) => x.completion) },
      ],
      target: cfg.rag.greenSayDoPct,
    });
    $('chart-streams').innerHTML = groupedBars({
      labels,
      subLabels,
      width,
      series: [
        { name: 'Dev items done', color: COLORS.dev, values: s.map((x) => x.devDone) },
        { name: `QA verification (×${cfg.qaVerificationRatio})`, color: COLORS.qaVerify, values: s.map((x) => Math.round(x.qaVerifiedAdj)) },
        { name: 'Test tasks done', color: COLORS.test, values: s.map((x) => x.testDone) },
      ],
    });
  }

  const endIsoOf = (s) => new Date(new Date(`${s.startIso}T00:00:00Z`).getTime() + ((D.meta.sprintDays || 21) - 1) * 86400000).toISOString().slice(0, 10);
  const subLabelsFor = (list) => list.map((s, i) => {
    const end = endIsoOf(s);
    const d = `${end.slice(8, 10)} ${'JanFebMarAprMayJunJulAugSepOctNovDec'.substr((Number(end.slice(5, 7)) - 1) * 3, 3)}`;
    const newYear = i === 0 || endIsoOf(list[i - 1]).slice(0, 4) !== end.slice(0, 4);
    return [d, newYear ? end.slice(0, 4) : ''];
  });

  function renderTimeline(rs) {
    const slotLink = (s, text) => {
      const ids = Array.from(new Set(rs.filter((r) => r.slot === s.slot).map((r) => r.sprintId)));
      if (ids.length === 1) return sprintLink(ids[0], esc(text));
      const url = jiraFor(rs.filter((r) => r.slot === s.slot));
      return linkOr(url, esc(text));
    };
    const gateKinds = Array.from(document.querySelectorAll('#gate-kinds input[value]:checked')).map((i) => i.value);
    const out = renderDisciplineTimeline({
      rs, slots, subLabels: subLabelsFor(slots), cfg, releases: D.meta.releases || [], sprintDays: D.meta.sprintDays, seriesOf, jiraFor, linkOr, heat, pctTxt, creepTxt, slotLink,
      gateKinds, showSuperseded: $('gate-superseded').checked,
    });
    $('timeline-narrative').innerHTML = out.narrative;
    $('timeline-chart').innerHTML = out.chart;
    $('timeline-gates').innerHTML = out.table;
  }

  /**
   * Scrum-team heatmap. mode 'jira' = Sprint Report Completed say/do;
   * mode 'devFinished' = Resolved∪Closed as Do (same planned denominator).
   */
  function renderHeatmap(rs, mode) {
    const isDev = mode === 'devFinished';
    const elId = isDev ? 'heatmap-dev' : 'heatmap';
    const sortKey = isDev ? 'heatSortDev' : 'heatSort';
    const sortAttr = isDev ? 'data-heatsortdev' : 'data-heatsort';
    const metric = isDev ? 'sayDoDevFinished' : 'sayDo';
    const doneKey = isDev ? 'devFinishedPlanned' : 'donePlanned';
    const el = $(elId);
    if (!el) return;

    const teams = Array.from(groupBy(rs, (r) => r.scrumTeam).entries()).map(([name, tr]) => {
      const series = seriesOf(tr);
      const window = agg(tr, cfg);
      const bySlot = groupBy(tr, (r) => r.slot);
      const sprintIds = new Map(slots.map((s) => [s.slot, Array.from(new Set((bySlot.get(s.slot) || []).map((r) => r.sprintId)))]));
      const active = series.slice(-K).some((x) => x.committed > 0);
      const trend = isDev
        ? halfAvg(series, 'devFinishedPlanned', 'planned')
        : halves(series, K);
      return { name, series, window, trend, unmeasurable: window.planned < cfg.minPlannedForRanking, active, rows: tr, sprintIds };
    });
    const key = state[sortKey];
    const val = (t) => (key === 'name' ? t.name : key === 'trend' ? ((t.trend.recent ?? -999) - (t.trend.early ?? 0)) : (t.window[key] ?? -1));
    teams.sort((a, b) => b.active - a.active || a.unmeasurable - b.unmeasurable || (key === 'name' ? val(a).localeCompare(val(b)) : val(b) - val(a)));
    const retired = teams.filter((t) => !t.active).length;
    const shownTeams = state.showRetired || state.team ? teams : teams.filter((t) => t.active);
    const th = (k, label) => `<th class="sort${state[sortKey] === k ? ' on' : ''}" ${sortAttr}="${k}">${label}</th>`;
    const body = shownTeams.map((t) => {
      const cells = t.series.map((x) => {
        if (!x.committed) return `<td class="num" style="${heat(null)}"></td>`;
        const names = t.sprintIds.get(x.slot).map((id) => D.sprints[id]).join(', ');
        const cellVal = x[metric];
        const tip = isDev
          ? `${names}\n${x[doneKey]}/${x.planned} planned Resolved∪Closed · Sprint Report completed ${x.donePlanned}/${x.planned} · click for lists`
          : `${names}\n${x.donePlanned}/${x.planned} planned completed · ${x.added} added · ${x.removed} removed · click for the sprint report`;
        return `<td class="num cell" style="${heat(t.unmeasurable ? null : cellVal)}" data-team="${esc(t.name)}" data-slot="${x.slot}" title="${esc(tip)}">${cellVal == null ? '·' : cellVal}</td>`;
      }).join('');
      const rangeVal = t.window[metric];
      return `<tr${t.unmeasurable || !t.active ? ' class="dim"' : ''}>
        <td class="name">${pick('team', t.name, esc(t.name))}${ext(jiraFor(t.rows))}</td>${cells}
        ${t.unmeasurable ? `<td class="num" style="${heat(null)}">n/a</td>` : `<td class="num strong" style="${heat(rangeVal)}">${pctTxt(rangeVal)}</td>`}
        <td style="white-space:nowrap">${t.unmeasurable ? `<span class="muted small" title="only ${t.window.planned} items planned at sprint start">not scored</span>` : deltaHtml(t.trend.early, t.trend.recent)}</td>
        <td class="num">${t.window.committed}</td>
        <td class="num ${!t.unmeasurable && t.window.scopeCreep > cfg.scopeCreepAlertPct ? 'warn' : ''}">${t.unmeasurable ? '–' : creepTxt(t.window.scopeCreep)}</td>
        <td class="num">${isDev ? t.window.notDevFinishedPlanned : t.window.carried}</td></tr>`;
    }).join('');
    const notDoneLabel = isDev ? 'Not Res/Clo' : 'Not done';
    const notDoneSort = isDev ? 'notDevFinishedPlanned' : 'carried';
    el.innerHTML = `<table class="heat"><thead><tr>${th('name', 'Team')}${slots.map((s) => `<th title="${esc(s.range)} ${esc(s.startIso.slice(0, 4))}">${s.name}</th>`).join('')}
      ${th(metric, 'Range')}${th('trend', `Trend (${K} v ${K})`)}${th('committed', 'Items')}${th('scopeCreep', 'Added')}${th(notDoneSort, notDoneLabel)}</tr></thead><tbody>${body || `<tr><td colspan="${slots.length + 6}" class="muted">No items for this filter.</td></tr>`}</tbody></table>
      ${!isDev && retired && !state.team ? `<button class="btn link" id="retired-toggle">${state.showRetired ? 'Hide' : 'Show'} ${retired} team(s) with no sprint in the last ${K} slots</button>` : ''}`;
  }

  function summarise(name, rs) {
    const series = seriesOf(rs);
    const teamCounts = {};
    rs.forEach((r) => { teamCounts[r.scrumTeam] = (teamCounts[r.scrumTeam] || 0) + 1; });
    return {
      name, rows: rs, series, window: agg(rs, cfg), trend: halves(series, K),
      people: new Set(rs.map((r) => r.assignee)).size,
      teams: Object.entries(teamCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t),
    };
  }
  function orgSorter(a, b) {
    const k = state.orgSort;
    if (k === 'sayDo') return (b.window.sayDo ?? -1) - (a.window.sayDo ?? -1);
    if (k === 'sayDoAsc') return (a.window.sayDo ?? 999) - (b.window.sayDo ?? 999);
    if (k === 'trend') return ((a.trend.recent ?? 0) - (a.trend.early ?? 0)) - ((b.trend.recent ?? 0) - (b.trend.early ?? 0));
    return b.window.committed - a.window.committed;
  }
  function orgRow(m, kind, extraTitle) {
    const attr = kind === 'leader' ? 'leader' : 'manager';
    const nameCell = kind === 'other' ? `<b>${esc(m.name)}</b>` : pick(attr, m.name, esc(m.name), kind === 'leader' ? 'strong' : '');
    return `<tr class="${kind === 'manager' ? '' : 'leader'}">
      <td class="name ${kind === 'manager' ? 'indent' : ''}">${nameCell}${extraTitle || ''}${ext(m.url)}</td>
      <td class="num">${m.people}</td><td class="num">${m.window.committed}</td>
      <td class="num strong" style="${heat(m.window.sayDo)}">${pctTxt(m.window.sayDo)}</td>
      <td>${sparkline(m.series.map((x) => x.sayDo), { width: slots.length > 12 ? 160 : 96, color: kind === 'manager' ? COLORS.sayDo : '#212529' })}</td>
      <td>${deltaHtml(m.trend.early, m.trend.recent)}</td>
      <td class="num">${pctTxt(m.window.completion)}</td>
      <td class="num ${m.window.scopeCreep > cfg.scopeCreepAlertPct ? 'warn' : ''}">${creepTxt(m.window.scopeCreep)}</td>
      <td class="num">${m.window.carried}</td>
      <td class="muted small">${esc(m.teams.join(', '))}</td></tr>`;
  }
  function personRow(p) {
    return `<tr>
      <td class="name indent">${esc(p.name)}${ext(p.url)}</td>
      <td class="num">1</td><td class="num">${p.window.committed}</td>
      <td class="num strong" style="${heat(p.window.sayDo)}">${pctTxt(p.window.sayDo)}</td>
      <td>${sparkline(p.series.map((x) => x.sayDo), { width: slots.length > 12 ? 160 : 96, color: COLORS.sayDo })}</td>
      <td>${deltaHtml(p.trend.early, p.trend.recent)}</td>
      <td class="num">${pctTxt(p.window.completion)}</td>
      <td class="num ${p.window.scopeCreep > cfg.scopeCreepAlertPct ? 'warn' : ''}">${creepTxt(p.window.scopeCreep)}</td>
      <td class="num">${p.window.carried}</td>
      <td class="muted small">${esc(p.teams.join(', '))}</td></tr>`;
  }
  function renderOrg(rs) {
    const span = slots.length ? `${slots[0].name}→${slots[slots.length - 1].name}` : '—';
    const head = `<thead><tr><th id="org-col-name">Leader / manager</th><th>People</th><th>Items</th><th>Say/Do</th><th>${span}</th><th>Trend (${K} v ${K})</th><th>Completion</th><th>Scope added</th><th>Not done</th><th>Scrum teams</th></tr></thead>`;
    if (state.manager) {
      const people = Array.from(groupBy(rs, (r) => r.assignee).entries()).map(([name, pr]) => {
        const p = summarise(name, pr);
        p.url = jiraFor(pr);
        return p;
      }).sort(orgSorter);
      $('org-heading').textContent = 'People';
      $('org-title').textContent = `${state.manager} — ${people.length} people`;
      $('org-caption').textContent = 'Everyone under this manager with sprint work in the window (from their Team-*-DirectReports group today). Same metrics as the org table.';
      $('org').innerHTML = `<table class="org">${head.replace('Leader / manager', 'Person')}<tbody>${people.map(personRow).join('') || '<tr><td colspan="10" class="muted">No items for this filter.</td></tr>'}</tbody></table>`;
      return;
    }
    if (state.leader && !state.manager) {
      $('org-heading').textContent = 'Organisation';
      $('org-title').textContent = `${state.leader} — managers`;
      $('org-caption').textContent = 'Managers under this leader. Click a manager to open their people and every sprint they ran.';
    } else {
      $('org-heading').textContent = 'Organisation';
      $('org-title').textContent = 'By leader and manager';
      $('org-caption').innerHTML = 'Reporting lines come from each assignee\'s JIRA directory groups (<code>Team-&lt;Name&gt;-DirectReports</code> / <code>-Org</code>) today. Click a name to filter; ↗ opens that group\'s sprint items in JIRA.';
    }
    const leaders = Array.from(groupBy(rs, (r) => r.leader).entries()).map(([name, lr]) => {
      const l = summarise(name, lr);
      l.url = D.groups.leaders[name] ? jiraFor(lr) : null;
      l.managers = Array.from(groupBy(lr, (r) => r.manager).entries()).map(([mn, mr]) => {
        const m = summarise(mn, mr);
        m.url = jiraFor(mr);
        m.isDirects = mn === name;
        return m;
      }).sort(orgSorter);
      return l;
    }).sort(orgSorter);
    const html = leaders.map((l) => orgRow(l, 'leader', ' <span class="muted small">org</span>')
      + l.managers.map((m) => orgRow(m, 'manager', m.isDirects ? ' <span class="muted small">(direct reports)</span>' : '')).join('')).join('');
    $('org').innerHTML = `<table class="org">${head}<tbody>${html || '<tr><td colspan="10" class="muted">No items for this filter.</td></tr>'}</tbody></table>`;
  }
  function renderSprintRoster(rs) {
    const card = $('sprint-roster-card');
    if (!isFocused()) { card.hidden = true; return; }
    card.hidden = false;
    const who = state.manager || state.leader || state.team;
    const bySprint = groupBy(rs.filter((r) => !r.removed), (r) => r.sprintId);
    const list = Array.from(bySprint.entries()).map(([id, sr]) => {
      const w = agg(sr, cfg);
      const slot = allSlots.find((s) => s.slot === sr[0].slot);
      const teams = Array.from(new Set(sr.map((r) => r.scrumTeam))).sort();
      return { id, name: D.sprints[id] || String(id), slot, teams, w, people: new Set(sr.map((r) => r.assignee)).size };
    }).sort((a, b) => (a.slot?.slot || 0) - (b.slot?.slot || 0) || a.name.localeCompare(b.name));
    $('sprint-roster-title').textContent = `${who} — ${list.length} sprints`;
    $('sprint-roster').innerHTML = `<div class="scrollbox"><table class="small-table"><thead><tr><th>Sprint</th><th>Slot</th><th>Team(s)</th><th>People</th><th>Say/Do</th><th>Completed</th><th>Not completed</th><th>Added *</th><th>Removed</th></tr></thead><tbody>
      ${list.map((s) => `<tr>
        <td class="name">${sprintLink(s.id, esc(s.name))}</td>
        <td>${s.slot ? `${esc(s.slot.name)} <span class="muted">${esc(s.slot.range)}</span>` : '–'}</td>
        <td>${s.teams.map((t) => pick('team', t, esc(t))).join(', ')}</td>
        <td class="num">${s.people}</td>
        <td class="num strong" style="${heat(s.w.sayDo)}">${pctTxt(s.w.sayDo)}</td>
        <td class="num">${s.w.done}</td>
        <td class="num">${s.w.carried}</td>
        <td class="num">${s.w.added}</td>
        <td class="num">${s.w.removed}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">No sprints for this filter.</td></tr>'}
      </tbody></table></div>`;
  }

  function issueRow(key, extraCells, starred, status) {
    const i = D.issues[key] || ['', 0, 0];
    return `<td style="white-space:nowrap"><a href="${esc(D.meta.jiraBaseUrl)}/browse/${esc(key)}" target="_blank" rel="noopener">${esc(key)}</a>${starred ? '<span class="star" title="Added after sprint start"> *</span>' : ''}</td>
      <td>${esc(i[0])}</td><td>${esc(dict.types[i[2]])}</td><td>${esc(status != null ? status : dict.statuses[i[1]])}</td>${extraCells}`;
  }
  const fmtDay = (iso) => (iso ? `${iso.slice(8, 10)} ${'JanFebMarAprMayJunJulAugSepOctNovDec'.substr((Number(iso.slice(5, 7)) - 1) * 3, 3)} ${iso.slice(0, 4)}` : '');
  const QA_STATUS = cfg.pendingQAStatusName || 'Resolved';
  function chronicState(r) {
    if (r.unresolvedNow) return 'open';
    return dict.statuses[(D.issues[r.key] || [])[1]] === QA_STATUS ? 'qa' : 'closed';
  }
  function versionCells(key) {
    const i = D.issues[key] || [];
    const names = (i[5] || []).map((v) => dict.versions[v]);
    const fix = names.map((n) => {
      const info = D.versionInfo[n] || [0, ''];
      return `<span title="${info[0] ? `released ${esc(info[1])}` : 'not released'}" style="${info[0] ? '' : 'color:#868e96'}">${esc(n)}</span>`;
    }).join(', ');
    const shipped = i[6] >= 0 ? dict.versions[i[6]] : null;
    const shippedTxt = shipped
      ? `<b>${esc(shipped)}</b> <span class="muted">${fmtDay((D.versionInfo[shipped] || [])[1])}</span>`
      : (i[4] ? '<span class="muted">not in a released version</span>' : '');
    return `<td class="muted">${esc(dict.resolutions[i[3]] || '')}</td><td style="white-space:nowrap">${fmtDay(i[4])}</td><td>${fix || '<span class="muted">–</span>'}</td><td style="white-space:nowrap">${shippedTxt}</td>`;
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.round(ms / 86400000);
  }
  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i); const hi = Math.ceil(i);
    if (lo === hi) return sorted[lo];
    return Math.round(sorted[lo] * (hi - i) + sorted[hi] * (i - lo));
  }
  function ageBuckets(daysList) {
    const b = [
      { label: '0–2d', max: 2, n: 0 },
      { label: '3–7d', max: 7, n: 0 },
      { label: '8–14d', max: 14, n: 0 },
      { label: '15–30d', max: 30, n: 0 },
      { label: '31d+', max: Infinity, n: 0 },
    ];
    daysList.forEach((d) => {
      const row = b.find((x) => d <= x.max);
      if (row) row.n += 1;
    });
    return b;
  }
  function bucketBars(buckets, color) {
    const max = Math.max(1, ...buckets.map((x) => x.n));
    return `<div style="display:flex;align-items:flex-end;gap:8px;height:88px;margin:8px 0 4px">${buckets.map((x) => {
      const h = Math.max(x.n ? 8 : 2, Math.round((x.n / max) * 72));
      return `<div style="flex:1;text-align:center"><div style="height:${h}px;background:${color};border-radius:4px 4px 0 0" title="${x.label}: ${x.n}"></div><div class="small muted" style="margin-top:4px">${esc(x.label)}<br><b style="color:#212529">${x.n}</b></div></div>`;
    }).join('')}</div>`;
  }
  function renderQaLag(rs) {
    const today = (D.meta.generatedAt || new Date().toISOString()).slice(0, 10);
    const seen = new Map();
    rs.forEach((r) => { if (!seen.has(r.key)) seen.set(r.key, r); });
    const waiting = [];
    const closed = [];
    seen.forEach((r, key) => {
      const i = D.issues[key] || [];
      const status = dict.statuses[i[1]] || '';
      const resolved = i[4] || '';
      const closedOn = i[7] || '';
      if (status === QA_STATUS && resolved) {
        const d = daysBetween(resolved, today);
        if (d != null) waiting.push({ key, days: d, resolved, assignee: r.assignee, team: r.scrumTeam, manager: r.manager });
      } else if (status === 'Closed' && resolved && closedOn) {
        const d = daysBetween(resolved, closedOn);
        if (d != null) closed.push({ key, days: d, resolved, closedOn, assignee: r.assignee, team: r.scrumTeam, manager: r.manager });
      }
    });
    waiting.sort((a, b) => b.days - a.days);
    closed.sort((a, b) => b.days - a.days);
    const wDays = waiting.map((x) => x.days).sort((a, b) => a - b);
    const cDays = closed.map((x) => x.days).sort((a, b) => a - b);
    const med = (arr) => percentile(arr, 0.5);
    const p90 = (arr) => percentile(arr, 0.9);
    const waitUrl = jiraFor(rs, [`status = ${JSON.stringify(QA_STATUS)}`]);
    const stat = (label, value, sub) => `<div class="tile" style="margin:0"><div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;
    const topWait = waiting.slice(0, 12);
    $('qa-lag').innerHTML = `
      <div class="tiles" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">
        ${stat('Still waiting on QA', linkOr(waitUrl, String(waiting.length)), `currently ${esc(QA_STATUS)} · median ${med(wDays) ?? '–'}d · p90 ${p90(wDays) ?? '–'}d`)}
        ${stat('Median close lag', cDays.length ? `${med(cDays)}d` : '–', `Resolved → Closed · ${closed.length.toLocaleString()} closed tickets with both dates`)}
        ${stat('P90 close lag', cDays.length ? `${p90(cDays)}d` : '–', '9 of 10 closed within this many days')}
        ${stat('Closed after 14d wait', String(closed.filter((x) => x.days > 14).length), `of ${closed.length.toLocaleString()} closed · long QA queue signal`)}
      </div>
      <div class="grid2">
        <div>
          <div class="small" style="font-weight:600">Still waiting — age since Resolved</div>
          ${waiting.length ? bucketBars(ageBuckets(wDays), '#e67700') : '<div class="muted small">None in Resolved for this filter.</div>'}
        </div>
        <div>
          <div class="small" style="font-weight:600">Closed tickets — days Dev waited for QA</div>
          ${closed.length ? bucketBars(ageBuckets(cDays), '#5f3dc4') : '<div class="muted small">No Closed tickets with Resolved→Closed dates yet for this filter.</div>'}
        </div>
      </div>
      ${topWait.length ? `<div style="margin-top:10px"><div class="small" style="font-weight:600;margin-bottom:4px">Longest waits still in ${esc(QA_STATUS)}</div>
        <div class="scrollbox" style="max-height:220px"><table class="small-table"><thead><tr><th>Key</th><th>Days waiting</th><th>Resolved on</th><th>Team</th><th>Assignee</th><th>Manager</th></tr></thead><tbody>
        ${topWait.map((x) => `<tr>
          <td><a href="${esc(D.meta.jiraBaseUrl)}/browse/${esc(x.key)}" target="_blank" rel="noopener">${esc(x.key)}</a></td>
          <td class="num warn">${x.days}</td><td>${fmtDay(x.resolved)}</td>
          <td>${esc(x.team)}</td><td>${esc(x.assignee)}</td><td class="muted">${esc(x.manager)}</td>
        </tr>`).join('')}
        </tbody></table></div></div>` : ''}`;
  }

  function renderChronic(rs) {
    const q = state.q.trim().toLowerCase();
    const seen = new Map();
    rs.filter((r) => !r.removed && r.sprintCountEver >= cfg.chronicCarryoverSprints)
      .forEach((r) => { if (!seen.has(r.key)) seen.set(r.key, r); });
    let list = Array.from(seen.values()).sort((a, b) => b.sprintCountEver - a.sprintCountEver);
    if (q) {
      list = list.filter((r) => {
        const i = D.issues[r.key] || [''];
        const vers = (i[5] || []).map((v) => dict.versions[v]).join(' ');
        return `${r.key} ${i[0]} ${r.assignee} ${r.manager} ${r.scrumTeam} ${vers}`.toLowerCase().includes(q);
      });
    }
    const counts = { open: 0, qa: 0, closed: 0 };
    list.forEach((r) => { counts[chronicState(r)] += 1; });
    const shown = state.chronicView === 'all' ? list : list.filter((r) => chronicState(r) === state.chronicView);
    const totalPages = Math.max(1, Math.ceil(shown.length / CHRONIC_PAGE_SIZE));
    const page = Math.min(Math.max(1, Number(state.chronicPage) || 1), totalPages);
    state.chronicPage = page;
    const start = (page - 1) * CHRONIC_PAGE_SIZE;
    const pageRows = shown.slice(start, start + CHRONIC_PAGE_SIZE);
    const from = shown.length ? start + 1 : 0;
    const to = Math.min(start + CHRONIC_PAGE_SIZE, shown.length);
    $('chronic-title').textContent = `Chronic carry-over — ${list.length} tickets planned into ${cfg.chronicCarryoverSprints}+ sprints · ${counts.open} still open`;
    const tab = (v, label, n) => `<button class="btn${state.chronicView === v ? ' on' : ''}" data-chronic="${v}">${label} (${n.toLocaleString()})</button>`;
    const pager = shown.length > CHRONIC_PAGE_SIZE
      ? `<div class="chronic-pager" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap">
          <span class="small muted">Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${shown.length.toLocaleString()}</span>
          <span style="display:flex;gap:6px;align-items:center">
            <button type="button" class="btn" data-chronic-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
            <span class="small">Page ${page} / ${totalPages}</span>
            <button type="button" class="btn" data-chronic-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
          </span>
        </div>`
      : (shown.length
        ? `<div class="small muted" style="margin-top:6px">Showing ${shown.length.toLocaleString()} ticket${shown.length === 1 ? '' : 's'}</div>`
        : '');
    $('chronic').innerHTML = `<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">${tab('open', 'Still open', counts.open)}${tab('qa', `${QA_STATUS} — awaiting QA`, counts.qa)}${tab('closed', 'Closed', counts.closed)}${tab('all', 'All', list.length)}</div>
      <table class="small-table"><thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Status now</th><th>Resolution</th><th>Closed on</th><th>Fix Version(s)</th><th>Shipped in</th><th>Sprints</th><th>Team</th><th>Assignee</th><th>Manager</th></tr></thead><tbody>
      ${pageRows.map((r) => `<tr>${issueRow(r.key, `${versionCells(r.key)}<td class="num warn">${r.sprintCountEver}</td><td>${esc(r.scrumTeam)}</td><td>${esc(r.assignee)}</td><td class="muted">${esc(r.manager)}</td>`)}</tr>`).join('') || '<tr><td colspan="12" class="muted">None for this filter.</td></tr>'}
      </tbody></table>${pager}`;
  }

  function openDrill(team, slot) {
    const rs = filtered().filter((r) => r.scrumTeam === team && r.slot === slot);
    const sl = allSlots.find((s) => s.slot === slot);
    const sections = [
      ['Completed Issues', (r) => r.done && !r.doneElsewhere],
      ['Issues Not Completed', (r) => r.carried],
      ['Issues Removed From Sprint', (r) => r.removed],
      ['Issues completed outside of this sprint', (r) => r.doneElsewhere],
    ];
    const filteredNote = state.leader || state.manager || state.work !== 'all' || D.meta.sprintScope
      ? `<div class="small warn" style="margin-top:4px">Only people in scope (${esc(D.meta.scopeLabel || 'filters')}) are listed, so these lists can be a subset of the JIRA report.</div>` : '';
    const bySprint = Array.from(groupBy(rs, (r) => r.sprintId).entries());
    $('drill-title').innerHTML = `${esc(team)} · ${esc(sl.name)} <span class="muted small">${esc(sl.range)}</span>`;
    $('drill-stats').innerHTML = filteredNote;
    $('drill-body').innerHTML = bySprint.map(([sprintId, sr]) => {
      const w = agg(sr, cfg);
      const head = `<div style="margin:6px 0 2px;font-size:14px;font-weight:600">${sprintLink(sprintId, `${esc(D.sprints[sprintId] || sprintId)} — JIRA Sprint Report ↗`)}</div>
        <div class="small">Say/do <b>${pctTxt(w.sayDo)}</b> (${w.donePlanned}/${w.planned} planned completed) · completed ${w.done} · not completed ${w.carried} · removed ${w.removed} · <span class="star">*</span> added during sprint ${w.added} · ${w.sp} story points completed</div>`;
      const body = sections.map(([title, fn]) => {
        const list = sr.filter(fn).sort((a, b) => a.key.localeCompare(b.key));
        if (!list.length) return '';
        return `<div class="drill-sec">${esc(title)} (${list.length})</div><table class="small-table"><thead><tr><th>Key</th><th>Summary</th><th>Type</th><th title="Status when the sprint closed, as in the JIRA Sprint Report">Status at close</th><th>Assignee</th><th>SP</th></tr></thead><tbody>
          ${list.map((r) => `<tr>${issueRow(r.key, `<td>${esc(r.assignee)}</td><td class="num">${r.sp || ''}</td>`, r.added, r.statusAtClose)}</tr>`).join('')}</tbody></table>`;
      }).join('');
      return head + body;
    }).join('<hr style="border:0;border-top:1px solid #dee2e6;margin:14px 0">');
    $('drill').classList.add('open');
  }

  function render() {
    if (state.range !== 'all' && !RANGES.includes(Number(state.range))) state.range = 'all';
    const rs = filtered();
    slots = slotsWithWork(rangeSlots(), rs);
    renderFilters();
    renderTiles(rs);
    renderQaLag(rs);
    renderTimeline(rs);
    renderCharts(rs);
    renderHeatmap(rs, 'jira');
    renderHeatmap(rs, 'devFinished');
    renderOrg(rs);
    renderSprintRoster(rs);
    renderChronic(rs);
    writeHash();
  }

  function set(patch) {
    const resetsChronicPage = ['leader', 'manager', 'team', 'work', 'range', 'chronicView', 'q']
      .some((k) => Object.prototype.hasOwnProperty.call(patch, k));
    Object.assign(state, patch);
    if (resetsChronicPage && !('chronicPage' in patch)) state.chronicPage = 1;
    if ('leader' in patch && patch.leader && state.manager && !rows.some((r) => r.leader === patch.leader && r.manager === state.manager)) state.manager = '';
    if ('manager' in patch && patch.manager) state.leader = rows.find((r) => r.manager === patch.manager)?.leader || state.leader;
    render();
  }

  document.addEventListener('click', (e) => {
    const p = e.target.closest('.pick');
    if (p) {
      e.preventDefault();
      if (p.dataset.team != null) set({ team: state.team === p.dataset.team ? '' : p.dataset.team });
      else if (p.dataset.manager != null) set({ manager: state.manager === p.dataset.manager ? '' : p.dataset.manager });
      else if (p.dataset.leader != null) set({ leader: state.leader === p.dataset.leader ? '' : p.dataset.leader, manager: '' });
      document.getElementById('filters').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const hs = e.target.closest('[data-heatsort]');
    if (hs) { set({ heatSort: hs.dataset.heatsort }); return; }
    const hsd = e.target.closest('[data-heatsortdev]');
    if (hsd) { set({ heatSortDev: hsd.dataset.heatsortdev }); return; }
    const cell = e.target.closest('td.cell');
    if (cell) { openDrill(cell.dataset.team, Number(cell.dataset.slot)); return; }
    const cj = e.target.closest('.copyjql');
    if (cj) {
      const jql = cj.dataset.jql;
      const done = () => { cj.textContent = 'copied ✓'; setTimeout(() => { cj.textContent = 'copy JQL'; }, 1500); };
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = jql; document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        if (ok) { ta.remove(); done(); } else { ta.style.cssText = 'width:100%;height:80px'; cj.after(ta); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(jql).then(done, fallback);
      else fallback();
      return;
    }
    const cv = e.target.closest('[data-chronic]');
    if (cv) { set({ chronicView: cv.dataset.chronic, chronicPage: 1 }); return; }
    const cp = e.target.closest('[data-chronic-page]');
    if (cp && !cp.disabled) {
      const next = Number(cp.dataset.chronicPage);
      if (Number.isFinite(next) && next >= 1) set({ chronicPage: next });
      return;
    }
    if (e.target.id === 'retired-toggle') { set({ showRetired: !state.showRetired }); return; }
    if (e.target.id === 'f-reset') { set({ leader: '', manager: '', team: '', work: 'all', q: '', chronicPage: 1 }); $('f-q').value = ''; return; }
    if (e.target.id === 'drill-close' || e.target.id === 'drill') $('drill').classList.remove('open');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drill').classList.remove('open'); });
  $('f-range').addEventListener('change', (e) => set({ range: e.target.value }));
  $('f-leader').addEventListener('change', (e) => set({ leader: e.target.value, manager: '' }));
  $('f-manager').addEventListener('change', (e) => set({ manager: e.target.value }));
  $('f-team').addEventListener('change', (e) => set({ team: e.target.value }));
  $('f-work').addEventListener('change', (e) => set({ work: e.target.value }));
  $('f-orgsort').addEventListener('change', (e) => set({ orgSort: e.target.value }));
  $('gate-kinds').addEventListener('change', () => renderTimeline(filtered()));
  $('f-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    state.chronicPage = 1;
    renderChronic(filtered());
  });

  render();
}

module.exports = { sprintPerformanceApp };
