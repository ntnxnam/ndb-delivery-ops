/**
 * Minimal inline-SVG charts for self-contained HTML reports (no JS, no CDN).
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Extra bottom space for optional per-label sub-lines (e.g. sprint end date, year). */
function subLabelHeight(subLabels) {
  return subLabels ? Math.max(0, ...subLabels.map((l) => l.filter(Boolean).length)) * 11 : 0;
}

/**
 * Sub-lines under an axis label. Each entry is a string or
 * `{ text, title?, kind?: 'gate'|'date'|'year' }` (falsy entries skipped).
 * Gate lines use a stronger indigo so they stay visible on dense sprint axes.
 */
function subLabelText(subLabels, i, x, y) {
  return ((subLabels && subLabels[i]) || []).filter(Boolean)
    .map((entry, k) => {
      const t = typeof entry === 'string' ? entry : entry.text;
      const title = typeof entry === 'string' ? entry : (entry.title || entry.text);
      const kind = typeof entry === 'string'
        ? (k === 0 ? 'date' : (/\b(EC|CC|CG|PG|GA)\b/.test(t) ? 'gate' : 'year'))
        : (entry.kind || 'date');
      const fill = kind === 'gate' ? '#364fc7' : (kind === 'year' ? '#adb5bd' : '#868e96');
      const size = kind === 'gate' ? 8 : 9;
      const weight = kind === 'gate' ? ' font-weight="600"' : '';
      return `<text x="${x}" y="${y + 11 * (k + 1)}" font-size="${size}" text-anchor="middle" fill="${fill}"${weight}><title>${esc(title)}</title>${esc(t)}</text>`;
    }).join('');
}

/**
 * Bars (left axis, counts) + lines (right axis, 0–100%).
 * `bars` may be one series or an array of series (grouped per label).
 * `gateMarks` optional: `[{ index, title }]` — vertical dashed markers (readable labels live outside the SVG).
 * `lineDash` optional per line via `dash?: string` (e.g. `"4 3"`).
 * `legendMode`: `'svg'` (default) draws legend inside the SVG; `'none'` leaves legend to the host HTML.
 * @param {{ labels: string[], bars: {name,color,values:number[]}|{name,color,values:number[]}[], lines: {name,color,values:(number|null)[], dash?: string}[], gateMarks?: {index:number,title:string}[], target?: number, width?, height?, legendMode?: 'svg'|'none' }} o
 */
function barLineChart({ labels, subLabels, bars, lines, gateMarks, target, width = 640, height = 240, legendMode = 'svg' }) {
  const barSeries = Array.isArray(bars) ? bars : (bars ? [bars] : []);
  const lineSeries = lines || [];
  const marks = gateMarks || [];
  const legendItems = [...barSeries, ...lineSeries];
  const drawLegend = legendMode !== 'none';
  // 2 columns when labels are long (Bug/Imp names) so legend text doesn't collide.
  const legendCols = legendItems.some((l) => String(l.name || '').length > 22) ? 2 : 3;
  const legendRows = drawLegend ? (Math.ceil(legendItems.length / legendCols) || 1) : 0;
  const extra = subLabelHeight(subLabels);
  const legendBlock = legendRows * 16 + (drawLegend ? 4 : 0);
  height += extra + legendBlock;
  const pad = { t: 8 + legendBlock + (marks.length ? 8 : 0), r: 44, b: 40 + extra, l: 44 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const n = labels.length;
  const step = w / n;
  const maxBar = Math.max(1, ...barSeries.flatMap((b) => b.values)) * 1.8;
  const yBar = (v) => pad.t + h - (v / maxBar) * h;
  const yPct = (v) => pad.t + h - (v / 100) * h;
  const x = (i) => pad.l + step * i + step / 2;
  const parts = [];
  [0, 25, 50, 75, 100].forEach((p) => {
    parts.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${yPct(p)}" y2="${yPct(p)}" stroke="#eef0f3"/>`);
    parts.push(`<text x="${pad.l + w + 6}" y="${yPct(p) + 4}" font-size="10" fill="#6c757d">${p}%</text>`);
  });
  marks.forEach((m) => {
    if (m.index < 0 || m.index >= n) return;
    const mx = x(m.index);
    parts.push(`<line x1="${mx}" x2="${mx}" y1="${pad.t}" y2="${pad.t + h}" stroke="#748ffc" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.85"><title>${esc(labels[m.index])}: ${esc(m.title)}</title></line>`);
    parts.push(`<polygon points="${mx},${pad.t - 1} ${mx - 4},${pad.t - 7} ${mx + 4},${pad.t - 7}" fill="#364fc7"><title>${esc(labels[m.index])}: ${esc(m.title)}</title></polygon>`);
  });
  const bw = Math.min(16, (step * 0.7) / Math.max(1, barSeries.length));
  labels.forEach((lab, i) => {
    const x0 = x(i) - (bw * barSeries.length) / 2;
    barSeries.forEach((b, j) => {
      const v = b.values[i] || 0;
      parts.push(`<rect x="${x0 + j * bw}" y="${yBar(v)}" width="${Math.max(1, bw - 1)}" height="${pad.t + h - yBar(v)}" fill="${b.color}" rx="2"><title>${esc(lab)}: ${v} ${esc(b.name)}</title></rect>`);
    });
    parts.push(`<text x="${x(i)}" y="${pad.t + h + 16}" font-size="11" text-anchor="middle" fill="#343a40">${esc(lab)}</text>`);
    parts.push(subLabelText(subLabels, i, x(i), pad.t + h + 16));
  });
  if (target != null) {
    parts.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${yPct(target)}" y2="${yPct(target)}" stroke="#2f9e44" stroke-dasharray="4 4"/>`);
    parts.push(`<text x="${pad.l + 4}" y="${yPct(target) - 4}" font-size="10" fill="#2f9e44">target ${target}%</text>`);
  }
  lineSeries.forEach((ln) => {
    const pts = ln.values.map((v, i) => (v == null ? null : [x(i), yPct(v)])).filter(Boolean);
    const dash = ln.dash ? ` stroke-dasharray="${ln.dash}"` : '';
    // Dashed / dotted overlays are thicker so they stay visible over bars + solid % lines.
    const sw = ln.dash ? 3.2 : 2.5;
    parts.push(`<polyline fill="none" stroke="${ln.color}" stroke-width="${sw}"${dash} points="${pts.map((p) => p.join(',')).join(' ')}"/>`);
    ln.values.forEach((v, i) => {
      if (v == null) return;
      parts.push(`<circle cx="${x(i)}" cy="${yPct(v)}" r="${ln.dash ? 4 : 3.5}" fill="${ln.color}"${ln.dash ? ' stroke="#fff" stroke-width="1"' : ''}><title>${esc(labels[i])} ${esc(ln.name)}: ${v}%</title></circle>`);
    });
  });
  let legend = '';
  if (drawLegend) {
    const colW = Math.max(160, Math.floor(w / legendCols));
    legend = legendItems
      .map((l, i) => {
        const col = i % legendCols;
        const row = Math.floor(i / legendCols);
        const lx = pad.l + col * colW;
        const ly = 6 + row * 16;
        const swatch = l.dash
          ? `<line x1="${lx}" x2="${lx + 14}" y1="${ly + 5}" y2="${ly + 5}" stroke="${l.color}" stroke-width="3" stroke-dasharray="${l.dash}"/>`
          : `<rect x="${lx}" y="${ly}" width="10" height="10" fill="${l.color}" rx="2"/>`;
        return `${swatch}<text x="${lx + 18}" y="${ly + 9}" font-size="11" fill="#343a40">${esc(l.name)}</text>`;
      })
      .join('');
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px" role="img">${legend}${parts.join('')}</svg>`;
}

/**
 * Grouped bars per label (one bar per series, never summed).
 * @param {{ labels: string[], series: {name,color,values:number[]}[], width?, height? }} o
 */
function groupedBars({ labels, subLabels, series, width = 640, height = 220 }) {
  const extra = subLabelHeight(subLabels);
  height += extra;
  const pad = { t: 24, r: 12, b: 36 + extra, l: 36 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const step = w / labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values)) * 1.15;
  const bw = Math.min(22, (step * 0.8) / series.length);
  const parts = [];
  labels.forEach((lab, i) => {
    const x0 = pad.l + step * i + (step - bw * series.length) / 2;
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      const y = pad.t + h - (v / max) * h;
      parts.push(`<rect x="${x0 + j * bw}" y="${y}" width="${bw - 2}" height="${pad.t + h - y}" fill="${s.color}" rx="2"><title>${esc(lab)} ${esc(s.name)}: ${v}</title></rect>`);
      if (bw >= 14) parts.push(`<text x="${x0 + j * bw + (bw - 2) / 2}" y="${y - 3}" font-size="9" text-anchor="middle" fill="#6c757d">${v}</text>`);
    });
    parts.push(`<text x="${pad.l + step * i + step / 2}" y="${pad.t + h + 16}" font-size="11" text-anchor="middle" fill="#343a40">${esc(lab)}</text>`);
    parts.push(subLabelText(subLabels, i, pad.l + step * i + step / 2, pad.t + h + 16));
  });
  parts.push(`<line x1="${pad.l}" x2="${pad.l + w}" y1="${pad.t + h}" y2="${pad.t + h}" stroke="#ced4da"/>`);
  const legend = series.map((s, i) => `<rect x="${pad.l + i * 190}" y="6" width="10" height="10" fill="${s.color}" rx="2"/><text x="${pad.l + i * 190 + 14}" y="15" font-size="11" fill="#343a40">${esc(s.name)}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px" role="img">${legend}${parts.join('')}</svg>`;
}

function sparkline(values, { width = 96, height = 26, color = '#1f77b4', min = 0, max = 100 } = {}) {
  const pts = values.map((v, i) => (v == null ? null : [
    2 + (i * (width - 4)) / Math.max(1, values.length - 1),
    height - 2 - ((v - min) / (max - min || 1)) * (height - 4),
  ])).filter(Boolean);
  if (pts.length === 0) return '';
  const last = pts[pts.length - 1];
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${values.map((v) => (v == null ? '–' : `${v}%`)).join(' → ')}</title><polyline fill="none" stroke="${color}" stroke-width="1.8" points="${pts.map((p) => p.join(',')).join(' ')}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${color}"/></svg>`;
}

module.exports = { barLineChart, groupedBars, sparkline, subLabelHeight, subLabelText, esc };
