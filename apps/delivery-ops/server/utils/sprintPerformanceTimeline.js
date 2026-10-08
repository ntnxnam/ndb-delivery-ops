/* eslint-env browser */
/* global esc, agg, subLabelHeight, subLabelText */
/**
 * Discipline timeline for the interactive Sprint Performance report:
 * splits say/do into phases (largest level shifts first), overlays release
 * gates, and writes a plain-language narrative. Serialised into the HTML with
 * Function.prototype.toString(), so each function must be self-contained.
 */

/**
 * Binary segmentation on a ratio series. Each split must leave ≥ minLen
 * measurable points per side and move the level by ≥ minDiffPts.
 * @param {{num:number, den:number}[]} pts
 * @returns {{from:number, to:number}[]} inclusive index ranges
 */
function segmentPhases(pts, { minLen = 3, minDiffPts = 8, maxPhases = 6 } = {}) {
  const stat = (a, b) => {
    let n = 0; let d = 0; let c = 0;
    for (let i = a; i < b; i += 1) if (pts[i].den) { n += pts[i].num; d += pts[i].den; c += 1; }
    const m = d ? n / d : null;
    let ss = 0;
    for (let i = a; i < b; i += 1) if (pts[i].den) ss += pts[i].den * (pts[i].num / pts[i].den - m) ** 2;
    return { m, ss, c };
  };
  const segs = [[0, pts.length]];
  while (segs.length < maxPhases) {
    let best = null;
    segs.forEach(([a, b], si) => {
      const whole = stat(a, b);
      for (let k = a + 1; k < b; k += 1) {
        const L = stat(a, k); const R = stat(k, b);
        if (L.c < minLen || R.c < minLen || Math.abs(L.m - R.m) * 100 < minDiffPts) continue;
        const gain = whole.ss - L.ss - R.ss;
        if (!best || gain > best.gain) best = { si, k, gain };
      }
    });
    if (!best) break;
    const [a, b] = segs[best.si];
    segs.splice(best.si, 1, [a, best.k], [best.k, b]);
  }
  return segs.map(([a, b]) => ({ from: a, to: b - 1 }));
}

/** Say/do line + phase bands + per-release gate lanes, sharing one x-axis. */
function disciplineChart({ labels, subLabels, values, phases, lanes, target, levelColors, width }) {
  const pad = { t: 22, r: 40, b: 26 + subLabelHeight(subLabels), l: 92 };
  const plotH = 190;
  const laneH = 18;
  const height = pad.t + plotH + pad.b + lanes.length * laneH + 8;
  const w = width - pad.l - pad.r;
  const step = w / labels.length;
  const x = (i) => pad.l + step * i + step / 2;
  const y = (v) => pad.t + plotH - (v / 100) * plotH;
  const p = [];
  phases.forEach((ph) => {
    const x0 = pad.l + step * ph.from; const x1 = pad.l + step * (ph.to + 1);
    p.push(`<rect x="${x0}" y="${pad.t}" width="${x1 - x0}" height="${plotH}" fill="${levelColors[ph.level][1]}"/>`);
    if (ph.sayDo != null) {
      p.push(`<line x1="${x0 + 2}" x2="${x1 - 2}" y1="${y(ph.sayDo)}" y2="${y(ph.sayDo)}" stroke="${levelColors[ph.level][0]}" stroke-width="3" opacity=".8"/>`);
      p.push(`<text x="${(x0 + x1) / 2}" y="${pad.t + 13}" font-size="11" font-weight="700" text-anchor="middle" fill="${levelColors[ph.level][0]}">${ph.sayDo}%</text>`);
    }
    p.push(`<line x1="${x0}" x2="${x0}" y1="${pad.t}" y2="${pad.t + plotH}" stroke="#fff" stroke-width="2"/>`);
  });
  [0, 25, 50, 75, 100].forEach((v) => {
    p.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(v)}" y2="${y(v)}" stroke="#000" stroke-opacity=".05"/>`);
    p.push(`<text x="${pad.l + w + 6}" y="${y(v) + 4}" font-size="10" fill="#6c757d">${v}%</text>`);
  });
  if (target != null) p.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${y(target)}" y2="${y(target)}" stroke="#2f9e44" stroke-dasharray="4 4"/>`);
  lanes.forEach((ln) => ln.gates.filter((g) => g.style === 'solid' && g.mark).forEach((g) => {
    const gx = pad.l + step * (g.idx + g.frac);
    p.push(`<line x1="${gx}" x2="${gx}" y1="${pad.t}" y2="${pad.t + plotH}" stroke="${g.color}" stroke-opacity=".45" stroke-dasharray="2 3"/>`);
  }));
  const pts = values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`));
  let run = [];
  const flush = () => { if (run.length > 1) p.push(`<polyline fill="none" stroke="#5f3dc4" stroke-width="1.5" opacity=".7" points="${run.join(' ')}"/>`); run = []; };
  pts.forEach((pt) => { if (pt) run.push(pt); else flush(); });
  flush();
  values.forEach((v, i) => {
    if (v != null) p.push(`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#5f3dc4"><title>${esc(labels[i])}: say/do ${v}%</title></circle>`);
    p.push(`<text x="${x(i)}" y="${pad.t + plotH + 14}" font-size="10" text-anchor="middle" fill="#495057">${esc(labels[i])}</text>`);
    p.push(subLabelText(subLabels, i, x(i), pad.t + plotH + 14));
  });
  const laneTop = pad.t + plotH + pad.b;
  lanes.forEach((ln, li) => {
    const ly = laneTop + li * laneH + laneH / 2;
    p.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${ly}" y2="${ly}" stroke="#f1f3f5"/>`);
    p.push(`<text x="${pad.l - 6}" y="${ly + 4}" font-size="10.5" text-anchor="end" fill="#343a40" font-weight="600">${esc(ln.release)}</text>`);
    ln.gates.forEach((g) => {
      const gx = pad.l + step * (g.idx + g.frac);
      const solid = g.style === 'solid';
      const tip = `${ln.release} ${g.label} — ${g.iso}${solid ? '' : ' (superseded date)'}`;
      p.push(`<g><title>${esc(tip)}</title><rect x="${gx - 4}" y="${ly - 4}" width="8" height="8" transform="rotate(45 ${gx} ${ly})" fill="${solid ? g.color : '#fff'}" stroke="${g.color}" stroke-width="1.5" opacity="${solid ? 1 : 0.7}"/>
        ${solid ? `<text x="${gx + 7}" y="${ly + 3.5}" font-size="9" fill="${g.color}" font-weight="700">${esc(g.short)}</text>` : ''}</g>`);
    });
  });
  const legend = [['Say/Do per sprint', '#5f3dc4'], ['Phase average', '#495057'], ['Release gate (◇ = superseded date)', '#868e96']]
    .map(([t, c], i) => `<rect x="${pad.l + i * 170}" y="5" width="10" height="10" fill="${c}" rx="2"/><text x="${pad.l + i * 170 + 14}" y="14" font-size="11" fill="#343a40">${t}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px" role="img">${legend}${p.join('')}</svg>`;
}

/**
 * Narrative + release-impact table for the currently filtered rows.
 * @param {object} ctx  helpers and state from sprintPerformanceApp
 */
function renderDisciplineTimeline(ctx) {
  const { rs, slots, subLabels, cfg, releases, seriesOf, jiraFor, linkOr, heat, pctTxt, creepTxt, slotLink, gateKinds, showSuperseded } = ctx;
  const LEVEL = { strong: ['#2b8a3e', '#ebfbee', 'strong sprint discipline'], mixed: ['#e67700', '#fff9db', 'mixed discipline'], weak: ['#c92a2a', '#fff5f5', 'weak discipline'] };
  const SHORT = { EC: 'EC', CCM: 'CC', CG: 'CG', PG: 'PG', GA: 'GA' };
  const levelOf = (v) => (v == null ? 'mixed' : v >= cfg.rag.greenSayDoPct ? 'strong' : v >= cfg.rag.yellowSayDoPct ? 'mixed' : 'weak');
  const fmt = (iso) => `${iso.slice(8, 10)} ${'JanFebMarAprMayJunJulAugSepOctNovDec'.substr((Number(iso.slice(5, 7)) - 1) * 3, 3)} ${iso.slice(0, 4)}`;
  const endIso = (s) => new Date(new Date(`${s.startIso}T00:00:00Z`).getTime() + ((ctx.sprintDays || 21) - 1) * 86400000).toISOString().slice(0, 10);

  const series = seriesOf(rs);
  const first = series.findIndex((x) => x.planned > 0);
  let last = -1;
  series.forEach((x, i) => { if (x.planned > 0) last = i; });
  if (first < 0) return { chart: '<div class="muted">No planned work for this filter.</div>', narrative: '', table: '' };

  const pts = series.slice(first, last + 1).map((x) => ({ num: x.donePlanned, den: x.planned }));
  const phases = segmentPhases(pts, { minLen: cfg.phaseMinSprints || 3, minDiffPts: cfg.phaseMinShiftPts || 8 }).map((ph) => {
    const from = ph.from + first; const to = ph.to + first;
    const slotNums = new Set(slots.slice(from, to + 1).map((s) => s.slot));
    const prs = rs.filter((r) => slotNums.has(r.slot));
    const w = agg(prs, cfg);
    return { from, to, rows: prs, w, sayDo: w.sayDo, level: levelOf(w.sayDo) };
  });

  const slotIdx = new Map(slots.map((s, i) => [s.slot, i]));
  const lanes = releases.map((r) => ({
    release: r.release,
    type: r.type,
    gates: r.gates
      .filter((g) => slotIdx.has(g.slot) && gateKinds.includes(g.kind) && (showSuperseded || g.style === 'solid'))
      .map((g) => ({ ...g, idx: slotIdx.get(g.slot), short: SHORT[g.kind], mark: g.kind === 'GA' || g.kind === 'CCM' })),
  })).filter((ln) => ln.gates.length);

  const chart = disciplineChart({
    labels: slots.map((s) => s.name),
    subLabels,
    values: series.map((x) => x.sayDo),
    phases,
    lanes,
    target: cfg.rag.greenSayDoPct,
    levelColors: LEVEL,
    width: Math.max(760, Math.min(1320, slots.length * 34 + 140)),
  });

  const gatesIn = (ph) => lanes.flatMap((ln) => ln.gates.filter((g) => g.style === 'solid' && g.idx >= ph.from && g.idx <= ph.to)
    .map((g) => ({ ...g, release: ln.release })))
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const slipKeys = (prs) => new Set(prs.filter((r) => r.carried).map((r) => r.key));
  const slipCount = (prs) => slipKeys(prs).size;
  const slipOpen = (prs) => { const k = slipKeys(prs); return new Set(prs.filter((r) => k.has(r.key) && r.unresolvedNow).map((r) => r.key)).size; };
  const metric = (label, value, url) => `${label} <b>${linkOr(url, value)}</b>`;
  const delta = (d) => (d == null ? '' : `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} pts</span>`);

  const items = phases.map((ph, i) => {
    const a = slots[ph.from]; const b = slots[ph.to];
    const span = `${slotLink(a, a.name)}–${slotLink(b, b.name)}`;
    const dates = `${fmt(a.startIso)} → ${fmt(endIso(b))} · ${ph.to - ph.from + 1} sprints`;
    const url = jiraFor(ph.rows);
    const prev = phases[i - 1];
    const d = prev && ph.sayDo != null && prev.sayDo != null ? ph.sayDo - prev.sayDo : null;
    let lead;
    if (!prev) lead = `<b>Between ${fmt(a.startIso)} and ${fmt(endIso(b))}</b> (${span}, ${dates.split(' · ')[1]}) the team showed <b style="color:${LEVEL[ph.level][0]}">${LEVEL[ph.level][2]}</b>`;
    else {
      const verb = `<b style="color:${d >= 0 ? '#2b8a3e' : '#c92a2a'}">${d >= 0 ? 'improved' : 'dwindled'}</b> ${delta(d)}`;
      const level = `<b style="color:${LEVEL[ph.level][0]}">${LEVEL[ph.level][2]}</b>`;
      lead = `<b>After that, from ${fmt(a.startIso)} to ${fmt(endIso(b))}</b> (${span}), discipline ${verb} ${ph.level === prev.level ? `but stayed <b style="color:${LEVEL[ph.level][0]}">${ph.level}</b>` : `to ${level}`}`;
    }
    const facts = [
      metric('Say/Do', `${pctTxt(ph.w.sayDo)}`, url) + ` <span class="muted">(${ph.w.donePlanned.toLocaleString()}/${ph.w.planned.toLocaleString()} planned done)</span>`,
      metric('completion', pctTxt(ph.w.completion)),
      metric('scope added mid-sprint', creepTxt(ph.w.scopeCreep)),
      `<b>${slipCount(ph.rows).toLocaleString()}</b> tickets slipped past a sprint end (${slipOpen(ph.rows).toLocaleString()} still open today)`,
    ];
    const g = gatesIn(ph);
    const gateTxt = g.length
      ? `<div class="small" style="margin-top:2px">Release gates in this period: ${g.map((x) => `<span style="color:${x.color};font-weight:600">${esc(x.release)} ${SHORT[x.kind]}</span> ${fmt(x.iso)}`).join(' · ')}</div>`
      : '<div class="small muted" style="margin-top:2px">No release gates in this period.</div>';
    return `<li style="border-left:4px solid ${LEVEL[ph.level][0]};padding-left:10px;margin:8px 0;list-style:none">${lead}: ${facts.join(', ')}.${gateTxt}</li>`;
  });
  const scored = phases.filter((p) => p.sayDo != null);
  const best = scored.slice().sort((p, q) => q.sayDo - p.sayDo)[0];
  const now = scored[scored.length - 1];
  const head = phases.length === 1
    ? `Say/Do held steady at <b>${pctTxt(phases[0].sayDo)}</b> across this range — no shift of ${cfg.phaseMinShiftPts || 8}+ points lasting ${cfg.phaseMinSprints || 3}+ sprints.`
    : best === now
      ? `The latest stretch (${slots[now.from].name}–${slots[now.to].name}) is the strongest in this range at <b>${pctTxt(now.sayDo)}</b>.`
      : `Best stretch: <b>${slots[best.from].name}–${slots[best.to].name}</b> at <b>${pctTxt(best.sayDo)}</b>. Latest stretch: <b>${slots[now.from].name}–${slots[now.to].name}</b> at <b>${pctTxt(now.sayDo)}</b> ${delta(now.sayDo - best.sayDo)}.`;
  const narrative = `<div style="font-size:14px;margin-bottom:4px">${head}</div><ul style="margin:0;padding:0">${items.join('')}</ul>`;

  const sayDoOver = (i0, i1) => {
    const nums = new Set(slots.slice(Math.max(0, i0), Math.min(slots.length, i1 + 1)).map((s) => s.slot));
    if (i1 < 0 || i0 >= slots.length || !nums.size) return { v: null, rows: [] };
    const sub = rs.filter((r) => nums.has(r.slot));
    return { v: agg(sub, cfg).sayDo, rows: sub };
  };
  const cell = (o) => {
    if (o.v == null) return `<td class="num" style="${heat(null)}">–</td>`;
    const url = jiraFor(o.rows);
    return `<td class="num" style="${heat(o.v)}">${linkOr(url, `${o.v}%`, 'color:inherit')}</td>`;
  };
  const gateRows = lanes.flatMap((ln) => ln.gates.filter((g) => g.style === 'solid').map((g) => ({ ...g, release: ln.release, type: ln.type })))
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .map((g) => {
      const before = sayDoOver(g.idx - 2, g.idx - 1); const at = sayDoOver(g.idx, g.idx); const after = sayDoOver(g.idx + 1, g.idx + 2);
      const d = before.v != null && after.v != null ? after.v - before.v : null;
      return `<tr><td class="name">${esc(g.release)} <span class="muted small">${esc(g.type)}</span></td><td style="color:${g.color};font-weight:600">${esc(g.label)}</td><td style="white-space:nowrap">${fmt(g.iso)}</td><td>${slotLink(slots[g.idx], slots[g.idx].name)}</td>${cell(before)}${cell(at)}${cell(after)}<td>${delta(d)}</td></tr>`;
    }).join('');
  const table = gateRows
    ? `<table class="small-table"><thead><tr><th>Release</th><th>Gate</th><th>Date</th><th>Sprint</th><th>Say/Do 2 sprints before</th><th>Gate sprint</th><th>2 sprints after</th><th>After vs before</th></tr></thead><tbody>${gateRows}</tbody></table>`
    : '<div class="muted small">No release gates in this range.</div>';
  return { chart, narrative, table };
}

module.exports = { segmentPhases, disciplineChart, renderDisciplineTimeline };
