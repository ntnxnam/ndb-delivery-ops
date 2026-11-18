import React from 'react';

/**
 * GateChipStrip — horizontal strip of release-gate chips, sorted
 * chronologically. Each chip is a small pill with a left tick mark of
 * the gate's canonical colour, the gate label, and its ISO date.
 *
 * Designed for two slots:
 *   1. Above-the-fold strip on the Release Brief page (this turn).
 *   2. Mounted above the Gantt time axis (Wave 2 surgery on
 *      ReleaseVersionGantt).
 *
 * Style conventions (matching the legacy emailer config + Streamlit):
 *   - `style: 'dotted'`  → planned / superseded → strike-through + 60% opacity
 *   - `style: 'solid'`   → current commitment   → full opacity, bold
 *   - `past: true`       → date is today-or-earlier → reduced opacity + check
 *
 * Renders nothing when `gates` is empty (callers should show a hint).
 *
 * Props:
 *   gates       Array<{ kind, label, iso, color, style, past }>
 *   onSelect    optional click handler — receives the GateEvent
 *   highlight   optional GateKind to emphasise (e.g. matches Forecast verdict)
 */
export function GateChipStrip({ gates, onSelect, highlight, className = '' }) {
  if (!Array.isArray(gates) || gates.length === 0) return null;
  return (
    <div className={`ds-gate-strip ${className}`} role="list" aria-label="Release gate timeline">
      {gates.map((g, idx) => (
        <GateChip
          key={`${g.kind}-${g.iso}-${idx}`}
          gate={g}
          highlighted={highlight && g.kind === highlight}
          onClick={onSelect ? () => onSelect(g) : undefined}
        />
      ))}
    </div>
  );
}

function GateChip({ gate, highlighted, onClick }) {
  const clickable = typeof onClick === 'function';
  const baseClass = [
    'ds-gate-chip',
    `ds-gate-chip--${gate.kind.toLowerCase()}`,
    gate.style === 'dotted' ? 'ds-gate-chip--planned' : 'ds-gate-chip--current',
    gate.past ? 'ds-gate-chip--past' : '',
    highlighted ? 'ds-gate-chip--highlight' : '',
    clickable ? 'ds-gate-chip--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const Tag = clickable ? 'button' : 'span';
  const tagProps = clickable
    ? { type: 'button', onClick }
    : {};
  return (
    <Tag
      {...tagProps}
      role="listitem"
      className={baseClass}
      style={{ '--ds-gate-color': gate.color }}
      title={`${gate.label} · ${gate.iso}${gate.style === 'dotted' ? ' (planned)' : ''}${gate.past ? ' (past)' : ''}`}
    >
      <span className="ds-gate-chip__tick" aria-hidden="true" />
      <span className="ds-gate-chip__kind">{gate.kind}</span>
      <span className="ds-gate-chip__label">{gate.label}</span>
      <span className="ds-gate-chip__date ds-num">{gate.iso.slice(5)}</span>
    </Tag>
  );
}
