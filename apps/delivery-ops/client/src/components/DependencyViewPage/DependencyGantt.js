import React, { useMemo } from 'react';
import {
  filterPartnersOfRelated,
  filterRelatedWishlist,
  meaningfulLinks,
} from './wishlistRelated';

const LABEL_W = 280;
const ROW_H = 36;
const PAD_TOP = 32;
const PAD_BOTTOM = 16;
const MAX_ROWS = 40;
const DAY_MS = 86400000;

function parseDay(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function fmtTick(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function daySpan(startMs, endMs) {
  if (startMs == null || endMs == null) return null;
  return Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1);
}

function fmtDaySpan(days) {
  if (days == null) return '';
  return days === 1 ? '1 day' : `${days} days`;
}

function browseUrl(jiraBaseUrl, key) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return `${base}/browse/${key}`;
}

function truncate(s, n = 36) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function gateMsList(ndbGates) {
  if (!ndbGates || typeof ndbGates !== 'object') return [];
  const out = [];
  if (ndbGates.ecDate) out.push({ label: 'EC', ms: parseDay(ndbGates.ecDate) });
  if (ndbGates.gaDate) out.push({ label: 'GA', ms: parseDay(ndbGates.gaDate) });
  ['ccm1Gate', 'ccm2Gate', 'commitGate1', 'commitGate2', 'promotionGate1', 'promotionGate2', 'ga1', 'ga2'].forEach(
    (k) => {
      const g = ndbGates[k];
      if (g?.date) out.push({ label: g.label || k, ms: parseDay(g.date) });
    }
  );
  return out.filter((g) => g.ms != null);
}

function toneFor(role, barKind) {
  if (barKind === 'undated') return 'muted';
  if (role === 'orphan') return 'orphan';
  if (role === 'unlinked') return 'warn';
  if (role === 'wishlist') return 'wishlist';
  if (role === 'upstream') return 'upstream';
  if (role === 'downstream') return 'downstream';
  return 'partner';
}

/**
 * Build Gantt rows for the relationship subgraph only:
 * related wishlist parents + their linked partners (indented).
 * Label-only wishlist (no links), orphans, and floating partners are excluded.
 */
function buildRows(filtered, ignoredLinkTypePatterns) {
  const relatedWishlist = filterRelatedWishlist(
    filtered?.wishlist,
    filtered?.wishlistUnlinked,
    ignoredLinkTypePatterns
  );
  const partners = filterPartnersOfRelated(
    relatedWishlist,
    filtered?.wishlistLinked || [],
    ignoredLinkTypePatterns
  );
  const partnerByKey = new Map(partners.map((i) => [i.key, i]));
  const used = new Set();
  const rows = [];

  relatedWishlist.forEach((parent) => {
    rows.push({ issue: parent, depth: 0, role: 'wishlist' });
    used.add(parent.key);
    const childKeys = meaningfulLinks(parent, ignoredLinkTypePatterns)
      .map((l) => l.key)
      .filter((k) => partnerByKey.has(k));
    partners.forEach((p) => {
      if (childKeys.includes(p.key)) return;
      const back = meaningfulLinks(p, ignoredLinkTypePatterns).some(
        (l) => l.key === parent.key
      );
      if (back) childKeys.push(p.key);
    });
    childKeys.forEach((ck) => {
      const child = partnerByKey.get(ck);
      if (!child || used.has(ck)) return;
      rows.push({ issue: child, depth: 1, role: 'partner', parentKey: parent.key });
      used.add(ck);
    });
  });

  // Optional partnership rows (blocks / blocked-by) when mode includes them
  const blockedBy = filtered?.partnershipBlockedBy || [];
  const blocks = filtered?.partnershipBlocks || [];
  blockedBy.forEach((iss) => {
    if (used.has(iss.key)) return;
    rows.push({ issue: { ...iss, source: iss.source || 'partnership' }, depth: 0, role: 'upstream' });
    used.add(iss.key);
  });
  blocks.forEach((iss) => {
    if (used.has(iss.key)) return;
    rows.push({
      issue: { ...iss, source: iss.source || 'partnership_blocks' },
      depth: 0,
      role: 'downstream',
    });
    used.add(iss.key);
  });

  return rows.slice(0, MAX_ROWS);
}

/**
 * Directed edges from JIRA link direction:
 * - outward on A→B: arrow A → B
 * - inward on A←B (A stores inward to B): arrow B → A
 * Opposite directions are opposite arrows (not finish-to-start timeline stubs).
 */
function buildEdges(rows, ignoredLinkTypePatterns) {
  const indexByKey = new Map(rows.map((r, i) => [r.issue.key, i]));
  const edges = [];
  const seen = new Set();

  const addEdge = (fromIdx, toIdx, type, direction) => {
    if (fromIdx == null || toIdx == null || fromIdx === toIdx) return;
    const id = `${rows[fromIdx].issue.key}->${rows[toIdx].issue.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({
      from: fromIdx,
      to: toIdx,
      type: type || 'link',
      direction: direction || 'outward',
    });
  };

  rows.forEach((row, fromIdx) => {
    meaningfulLinks(row.issue, ignoredLinkTypePatterns).forEach((link) => {
      const otherIdx = indexByKey.get(link.key);
      if (otherIdx == null) return;
      if (link.direction === 'inward') {
        // Other points at this row → arrow other → this
        addEdge(otherIdx, fromIdx, link.type || link.typeName, 'inward');
      } else {
        // This points at other → arrow this → other
        addEdge(fromIdx, otherIdx, link.type || link.typeName, 'outward');
      }
    });
  });
  return edges;
}

export default function DependencyGantt({
  filtered,
  ndbGates,
  jiraBaseUrl,
  release,
  ignoredLinkTypePatterns,
}) {
  const rows = useMemo(
    () => buildRows(filtered, ignoredLinkTypePatterns),
    [filtered, ignoredLinkTypePatterns]
  );
  const edges = useMemo(
    () => buildEdges(rows, ignoredLinkTypePatterns),
    [rows, ignoredLinkTypePatterns]
  );

  const timeline = useMemo(() => {
    const gateList = gateMsList(ndbGates);
    const dates = [];
    rows.forEach((r) => {
      const a = parseDay(r.issue.startDate);
      const b = parseDay(r.issue.endDate);
      if (a != null) dates.push(a);
      if (b != null) dates.push(b);
    });
    gateList.forEach((g) => dates.push(g.ms));
    if (!dates.length) {
      const today = Date.now();
      return {
        startMs: today - 14 * DAY_MS,
        endMs: today + 28 * DAY_MS,
        ticks: [],
        gates: [],
        todayPct: 33,
      };
    }
    let startMs = Math.min(...dates);
    let endMs = Math.max(...dates);
    // pad 5%
    const pad = Math.max(DAY_MS, (endMs - startMs) * 0.08);
    startMs -= pad;
    endMs += pad;
    if (endMs <= startMs) endMs = startMs + 21 * DAY_MS;

    const span = endMs - startMs;
    const tickCount = Math.min(8, Math.max(4, Math.round(span / (7 * DAY_MS))));
    const ticks = [];
    for (let i = 0; i <= tickCount; i += 1) {
      const ms = startMs + (span * i) / tickCount;
      ticks.push({ ms, pct: (i / tickCount) * 100, label: fmtTick(ms) });
    }
    const today = Date.now();
    const todayPct =
      today >= startMs && today <= endMs ? ((today - startMs) / span) * 100 : null;
    const gates = gateList
      .map((g) => ({
        ...g,
        pct: ((g.ms - startMs) / span) * 100,
      }))
      .filter((g) => g.pct >= -2 && g.pct <= 102);

    return { startMs, endMs, span, ticks, gates, todayPct };
  }, [rows, ndbGates]);

  const layout = useMemo(() => {
    const chartH = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM;
    const bars = rows.map((row, i) => {
      const start = parseDay(row.issue.startDate);
      const end = parseDay(row.issue.endDate);
      const days = daySpan(start, end);
      const y = PAD_TOP + i * ROW_H + ROW_H / 2;
      let leftPct = null;
      let widthPct = null;
      let kind = row.issue.barKind || 'range';
      if (start != null && end != null && timeline.span > 0) {
        leftPct = ((start - timeline.startMs) / timeline.span) * 100;
        // True calendar proportion — do not inflate for text; labels sit outside short bars
        widthPct = Math.max(0.6, ((end - start) / timeline.span) * 100);
        if (kind === 'milestone' || start === end) {
          kind = 'milestone';
          widthPct = 0;
        }
      }
      const narrow = kind === 'range' && widthPct != null && widthPct < 10;
      return {
        row,
        i,
        y,
        leftPct,
        widthPct,
        days,
        kind,
        narrow,
        tone: toneFor(row.role, kind),
      };
    });

    const linkPaths = edges
      .map((e) => {
        const from = bars[e.from];
        const to = bars[e.to];
        if (!from || !to || from.leftPct == null || to.leftPct == null) return null;
        // Center-to-center so arrow follows link direction, not bar finish→start
        const fromW = from.kind === 'milestone' ? 0 : from.widthPct || 0;
        const toW = to.kind === 'milestone' ? 0 : to.widthPct || 0;
        const x1 = from.leftPct + fromW / 2;
        const x2 = to.leftPct + toW / 2;
        const y1 = from.y - PAD_TOP;
        const y2 = to.y - PAD_TOP;
        return {
          x1,
          y1,
          x2,
          y2,
          type: e.type,
          direction: e.direction || 'outward',
        };
      })
      .filter(Boolean);

    return { chartH, bars, linkPaths };
  }, [rows, edges, timeline]);

  if (!rows.length) {
    return <div className="dv-empty">No dated / linked issues to plot on the Gantt.</div>;
  }

  const chartH = layout.chartH;
  const bodyH = Math.max(ROW_H, chartH - PAD_TOP);

  return (
    <div className="dv-gantt">
      <div className="dv-gantt-head">
        <span className="dv-gantt-title">Dependency Gantt{release ? ` · ${release}` : ''}</span>
        <span className="dv-meta">
          {rows.length} rows · solid red arrow = outward link · dashed orange = inward
        </span>
      </div>
      <div className="dv-gantt-scale" role="note">
        <strong>Bar width = calendar duration</strong> (start date → end date on the time axis).
        Longer bar = more days spanned — <em>not</em> priority, story points, or impact.
        Short / stub bars are short date ranges. Diamonds = single-day milestone.
        Read the ticket key in the left column (always fully visible).
      </div>
      <div className="dv-gantt-scroll">
        <div className="dv-gantt-grid" style={{ minHeight: chartH }}>
          <div className="dv-gantt-labels" style={{ width: LABEL_W }}>
            <div className="dv-gantt-axis-spacer" style={{ height: PAD_TOP }}>
              <span className="dv-gantt-col-head">Ticket</span>
            </div>
            {layout.bars.map((b) => (
              <div
                key={b.row.issue.key}
                className="dv-gantt-label-row"
                style={{ height: ROW_H, paddingLeft: 8 + b.row.depth * 14 }}
              >
                <a
                  href={browseUrl(jiraBaseUrl, b.row.issue.key)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={b.row.issue.summary}
                >
                  {b.row.depth > 0 ? '↳ ' : ''}
                  {b.row.issue.key}
                </a>
                <span className="dv-gantt-label-sum">{truncate(b.row.issue.summary, 42)}</span>
                <span className="dv-gantt-label-days">
                  {b.kind === 'milestone'
                    ? 'milestone'
                    : b.days != null
                      ? fmtDaySpan(b.days)
                      : 'no dates'}
                </span>
              </div>
            ))}
          </div>

          <div className="dv-gantt-chart">
            <div className="dv-gantt-axis" style={{ height: PAD_TOP }}>
              <span className="dv-gantt-axis-caption">Time → (calendar)</span>
              {timeline.ticks.map((t) => (
                <span key={t.ms} className="dv-gantt-tick" style={{ left: `${t.pct}%` }}>
                  {t.label}
                </span>
              ))}
            </div>

            <div className="dv-gantt-body" style={{ height: chartH - PAD_TOP }}>
              {timeline.gates.map((g) => (
                <div
                  key={`${g.label}-${g.ms}`}
                  className="dv-gantt-gate"
                  style={{ left: `${g.pct}%` }}
                  title={g.label}
                >
                  <span>{g.label}</span>
                </div>
              ))}
              {timeline.todayPct != null && (
                <div className="dv-gantt-today" style={{ left: `${timeline.todayPct}%` }} title="Today" />
              )}

              {layout.bars.map((b) => (
                <div
                  key={b.row.issue.key}
                  className="dv-gantt-row-bg"
                  style={{ top: b.y - PAD_TOP - ROW_H / 2, height: ROW_H }}
                />
              ))}

              <svg
                className="dv-gantt-links"
                viewBox={`0 0 100 ${bodyH}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="dv-gantt-arrow-out"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M0,0 L7,3.5 L0,7 Z" fill="#c92a2a" />
                  </marker>
                  <marker
                    id="dv-gantt-arrow-in"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M0,0 L7,3.5 L0,7 Z" fill="#e67700" />
                  </marker>
                </defs>
                {layout.linkPaths.map((p, idx) => {
                  const midX = (p.x1 + p.x2) / 2;
                  const bend = p.direction === 'inward' ? 8 : -8;
                  const d = `M ${p.x1} ${p.y1} C ${midX} ${p.y1 + bend}, ${midX} ${p.y2 + bend}, ${p.x2} ${p.y2}`;
                  const inward = p.direction === 'inward';
                  return (
                    <path
                      key={`e-${idx}`}
                      d={d}
                      className={`dv-gantt-link-path ${
                        inward ? 'dv-gantt-link-path--in' : 'dv-gantt-link-path--out'
                      }`}
                      markerEnd={inward ? 'url(#dv-gantt-arrow-in)' : 'url(#dv-gantt-arrow-out)'}
                    >
                      <title>{`${inward ? 'Inward' : 'Outward'}: ${p.type || 'link'}`}</title>
                    </path>
                  );
                })}
              </svg>

              {layout.bars.map((b) => {
                const top = b.y - PAD_TOP - 10;
                const tip = `${b.row.issue.key}: ${b.row.issue.summary || ''}\n${
                  b.row.issue.startDate || '?'
                } → ${b.row.issue.endDate || '?'} (${
                  b.kind === 'milestone' ? 'milestone' : fmtDaySpan(b.days) || 'no dates'
                })\nBar width = calendar days on this axis — not priority.`;

                if (b.leftPct == null || b.kind === 'undated') {
                  return (
                    <div
                      key={`bar-${b.row.issue.key}`}
                      className="dv-gantt-undated"
                      style={{ top }}
                      title={tip}
                    >
                      no dates
                    </div>
                  );
                }
                if (b.kind === 'milestone') {
                  return (
                    <React.Fragment key={`bar-${b.row.issue.key}`}>
                      <a
                        className={`dv-gantt-diamond dv-tone-${b.tone}`}
                        style={{ left: `${b.leftPct}%`, top: b.y - PAD_TOP - 8 }}
                        href={browseUrl(jiraBaseUrl, b.row.issue.key)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={tip}
                      />
                      <span
                        className="dv-gantt-bar-sidecar"
                        style={{
                          left: `calc(${b.leftPct}% + 10px)`,
                          top: b.y - PAD_TOP - 6,
                        }}
                      >
                        {b.row.issue.key} · milestone
                      </span>
                    </React.Fragment>
                  );
                }
                // Wide bars: key inside. Narrow bars: empty stub + sidecar label (avoids "P." / "N.")
                const showInside = !b.narrow && b.widthPct >= 10;
                return (
                  <React.Fragment key={`bar-${b.row.issue.key}`}>
                    <a
                      className={`dv-gantt-bar dv-tone-${b.tone}${
                        b.kind === 'estimated' ? ' dv-gantt-bar--est' : ''
                      }${b.narrow ? ' dv-gantt-bar--narrow' : ''}`}
                      style={{
                        left: `${b.leftPct}%`,
                        width: `${Math.max(b.widthPct, 0.8)}%`,
                        top,
                      }}
                      href={browseUrl(jiraBaseUrl, b.row.issue.key)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={tip}
                    >
                      {showInside ? <span>{b.row.issue.key}</span> : null}
                    </a>
                    {b.narrow ? (
                      <span
                        className="dv-gantt-bar-sidecar"
                        style={{
                          left: `calc(${b.leftPct + Math.max(b.widthPct, 0.8)}% + 4px)`,
                          top: b.y - PAD_TOP - 6,
                        }}
                        title={tip}
                      >
                        {b.row.issue.key} · {fmtDaySpan(b.days)}
                      </span>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {rows.length >= MAX_ROWS ? (
        <div className="dv-meta">Showing first {MAX_ROWS} rows — expand Ticket lists below for the rest.</div>
      ) : null}
    </div>
  );
}
