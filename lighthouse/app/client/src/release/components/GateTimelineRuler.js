import React from 'react';

const GATE_COLORS = {
  EC: 'var(--ds-muted)',
  CCM: 'var(--ds-accent)',
  CG: 'var(--ds-warning)',
  PG: 'var(--ds-success)',
  GA: '#a78bfa',
};

export function GateTimelineRuler({ gateTimeline }) {
  const gates = gateTimeline?.gates || [];
  const byKind = ['EC', 'CCM', 'CG', 'PG', 'GA'].map((kind) => {
    const all = gates.filter((g) => g.kind === kind);
    if (!all.length) return { kind, iso: null, style: 'none' };
    const solid = [...all].reverse().find((g) => g.style === 'solid');
    const picked = solid || all[all.length - 1];
    return { kind, iso: picked.iso, style: picked.style };
  });

  return (
    <div className="retro-timeline-row">
      {byKind.map((g) => {
        const color = GATE_COLORS[g.kind] || 'var(--ds-accent)';
        return (
          <div
            key={g.kind}
            className="retro-timeline-item"
            style={{ borderLeftColor: color, borderLeftWidth: 3, borderLeftStyle: 'solid' }}
          >
            <div className="retro-timeline-kind" style={{ color }}>{g.kind}</div>
            <div className="retro-timeline-date">{g.iso || '—'}</div>
            {g.style && g.style !== 'none' ? (
              <div className="retro-timeline-style">{g.style}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
