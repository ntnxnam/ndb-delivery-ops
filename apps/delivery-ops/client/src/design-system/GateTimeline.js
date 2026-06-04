import React, { useMemo } from 'react';

/**
 * GateTimeline — proportional horizontal timeline of release gate events.
 *
 * Sibling of `GateChipStrip` — same data, same vocabulary (kind colour,
 * dotted/solid for planned/current, dimmed for past) but laid out on a
 * calendar-proportional axis so users can see *when* gates land relative
 * to each other and to today.
 *
 * Anatomy:
 *
 *     EC ─── CC ─── CG ─── PG ──── GA
 *     │  ┄┄┄  │      │      │       │
 *     ●───────●──────●──────●───────●──────►
 *                       ↑ today
 *
 * Drift lines (`┄┄┄`) connect the earliest and latest events of the same
 * kind so a slipped gate reads at a glance (e.g. EC planned 2026-01-15
 * → current 2026-02-28 shows as a long dashed segment below the axis).
 *
 * Track assignment (label above vs below the axis) is done greedily
 * with a simple x-distance threshold — adjacent gates get put on
 * opposite sides so labels don't overlap. Works well for the typical
 * 4–8 gate count in NDB release configs.
 *
 * Props:
 *   gates       Array<GateEvent>   — same shape as GateChipStrip
 *   highlight   optional GateKind  — emphasised gate (e.g. matches forecast verdict)
 *   onSelect    optional handler   — receives the GateEvent on click
 *   todayIso    optional 'YYYY-MM-DD' — overridable for testing/storybook
 *   className   optional
 */
export function GateTimeline({
  gates,
  highlight,
  onSelect,
  todayIso,
  className = '',
}) {
  const layout = useMemo(
    () => computeLayout(gates, todayIso),
    [gates, todayIso]
  );

  if (!layout) return null;

  const { positioned, drifts, todayPct, domainStartIso, domainEndIso } = layout;
  const clickable = typeof onSelect === 'function';

  return (
    <div
      className={`ds-gate-timeline ${className}`}
      role="figure"
      aria-label="Release gate timeline"
    >
      <div className="ds-gate-timeline__lane">
        <div className="ds-gate-timeline__axis" aria-hidden="true" />

        {drifts.map((d, i) => (
          <div
            key={`drift-${d.kind}-${i}`}
            className="ds-gate-timeline__drift"
            style={{
              left: `${d.fromPct}%`,
              width: `${Math.max(0, d.toPct - d.fromPct)}%`,
              '--ds-gate-color': d.color,
            }}
            title={`${d.kind} drift: ${d.fromIso} → ${d.toIso} (${d.daysDelta > 0 ? '+' : ''}${d.daysDelta}d)`}
            aria-hidden="true"
          />
        ))}

        {todayPct != null && (
          <div
            className="ds-gate-timeline__today"
            style={{ left: `${todayPct}%` }}
            aria-label={`Today: ${todayIsoStr(todayIso)}`}
          >
            <div className="ds-gate-timeline__today-line" />
            <div className="ds-gate-timeline__today-label">TODAY</div>
          </div>
        )}

        {positioned.map((g, idx) => (
          <GateMarker
            key={`${g.kind}-${g.iso}-${idx}`}
            gate={g}
            highlighted={highlight && g.kind === highlight}
            onClick={clickable ? () => onSelect(g) : undefined}
          />
        ))}
      </div>

      <div className="ds-gate-timeline__scale" aria-hidden="true">
        <span className="ds-gate-timeline__scale-end ds-num">{domainStartIso}</span>
        <span className="ds-gate-timeline__scale-end ds-num">{domainEndIso}</span>
      </div>
    </div>
  );
}

function GateMarker({ gate, highlighted, onClick }) {
  const clickable = typeof onClick === 'function';
  const trackClass =
    gate.track === 'above'
      ? 'ds-gate-timeline__marker--above'
      : 'ds-gate-timeline__marker--below';
  const baseClass = [
    'ds-gate-timeline__marker',
    trackClass,
    gate.style === 'dotted' ? 'ds-gate-timeline__marker--planned' : '',
    gate.past ? 'ds-gate-timeline__marker--past' : '',
    highlighted ? 'ds-gate-timeline__marker--highlight' : '',
    clickable ? 'ds-gate-timeline__marker--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const Tag = clickable ? 'button' : 'div';
  const tagProps = clickable ? { type: 'button', onClick } : {};
  const daysFromToday = gate.daysFromToday;
  const relPhrase =
    daysFromToday == null
      ? ''
      : daysFromToday === 0
      ? 'today'
      : daysFromToday > 0
      ? `in ${daysFromToday}d`
      : `${Math.abs(daysFromToday)}d ago`;
  return (
    <Tag
      {...tagProps}
      className={baseClass}
      style={{
        left: `${gate.xPct}%`,
        '--ds-gate-color': gate.color,
      }}
      title={`${gate.kind} · ${gate.label} · ${gate.iso}${
        gate.style === 'dotted' ? ' (planned)' : ''
      }${relPhrase ? ` · ${relPhrase}` : ''}`}
    >
      <span className="ds-gate-timeline__dot" aria-hidden="true" />
      <span className="ds-gate-timeline__label">
        <span className="ds-gate-timeline__kind">{gate.kind}</span>
        <span className="ds-gate-timeline__date ds-num">{gate.iso.slice(5)}</span>
      </span>
    </Tag>
  );
}

// ─────────────────────────── layout maths ─────────────────────────────────

function computeLayout(rawGates, todayIso) {
  if (!Array.isArray(rawGates) || rawGates.length === 0) return null;

  // Stable copy sorted by ISO date.
  const gates = [...rawGates]
    .filter((g) => g && typeof g.iso === 'string')
    .sort((a, b) => a.iso.localeCompare(b.iso));
  if (gates.length === 0) return null;

  const startMs = isoToMs(gates[0].iso);
  const endMs = isoToMs(gates[gates.length - 1].iso);
  let domainStartMs = startMs;
  let domainEndMs = endMs;

  // If start == end (single gate or all same date), give the lane a
  // synthetic ±14 day window so the dot doesn't sit at 0% with nothing
  // around it.
  if (domainStartMs === domainEndMs) {
    domainStartMs -= 14 * DAY_MS;
    domainEndMs += 14 * DAY_MS;
  } else {
    // 6% padding either side, with a 7-day floor so a tight 3-week
    // release window still has breathing room.
    const range = domainEndMs - domainStartMs;
    const pad = Math.max(range * 0.06, 7 * DAY_MS);
    domainStartMs -= pad;
    domainEndMs += pad;
  }
  const domainRange = domainEndMs - domainStartMs;
  const todayMs = todayIso ? isoToMs(todayIso) : Date.now();

  const xPctFor = (ms) => clampPct(((ms - domainStartMs) / domainRange) * 100);

  // Drift segments per kind: earliest → latest of same kind, only when
  // multiple events exist for that kind. The earliest is usually
  // 'dotted' (planned/superseded), latest is 'solid' (current).
  const byKind = new Map();
  for (const g of gates) {
    if (!byKind.has(g.kind)) byKind.set(g.kind, []);
    byKind.get(g.kind).push(g);
  }
  const drifts = [];
  for (const [kind, list] of byKind.entries()) {
    if (list.length < 2) continue;
    const first = list[0];
    const last = list[list.length - 1];
    if (first.iso === last.iso) continue;
    drifts.push({
      kind,
      fromIso: first.iso,
      toIso: last.iso,
      fromPct: xPctFor(isoToMs(first.iso)),
      toPct: xPctFor(isoToMs(last.iso)),
      daysDelta: Math.round(
        (isoToMs(last.iso) - isoToMs(first.iso)) / DAY_MS
      ),
      // Use the current (last) event's colour for the drift line.
      color: last.color || first.color,
    });
  }

  // Track assignment: greedy alternating placement. If a gate's x is
  // within MIN_GAP_PCT of the previous gate on the same track, push to
  // the other track. Three tracks total: above, below, above-far is
  // overkill — two tracks handle every NDB config we have.
  const MIN_GAP_PCT = 9; // ~80–100px on an 800px lane
  const positioned = [];
  let lastAbove = -Infinity;
  let lastBelow = -Infinity;
  for (const g of gates) {
    const xPct = xPctFor(isoToMs(g.iso));
    const aboveOk = xPct - lastAbove >= MIN_GAP_PCT;
    const belowOk = xPct - lastBelow >= MIN_GAP_PCT;
    let track;
    if (aboveOk && belowOk) {
      // Default: above. Looks more natural — dates appear "stamped"
      // above the timeline.
      track = 'above';
    } else if (aboveOk) {
      track = 'above';
    } else if (belowOk) {
      track = 'below';
    } else {
      // Both tracks too crowded — pick the one with more room.
      track = xPct - lastAbove >= xPct - lastBelow ? 'above' : 'below';
    }
    if (track === 'above') lastAbove = xPct;
    else lastBelow = xPct;
    positioned.push({
      ...g,
      xPct,
      track,
      daysFromToday: Math.round((isoToMs(g.iso) - todayMs) / DAY_MS),
    });
  }

  const todayPctRaw = ((todayMs - domainStartMs) / domainRange) * 100;
  const todayInRange = todayPctRaw >= 0 && todayPctRaw <= 100;

  return {
    positioned,
    drifts,
    todayPct: todayInRange ? clampPct(todayPctRaw) : null,
    domainStartIso: msToIso(domainStartMs),
    domainEndIso: msToIso(domainEndMs),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoToMs(iso) {
  // Treat as UTC midnight so calendar-day arithmetic isn't pulled by TZ.
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );
}

function msToIso(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayIsoStr(provided) {
  if (provided) return provided;
  return msToIso(Date.now());
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
