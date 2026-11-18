import React from 'react';

const GATE_COLORS = {
  CCM: 'var(--ds-accent)',
  CG: 'var(--ds-warning)',
  PG: 'var(--ds-success)',
  GA: '#a78bfa',
};

function RagPill({ value }) {
  return <span className={`retro-rag retro-rag-${value || 'none'}`}>{value || 'n/a'}</span>;
}

export function GateComplianceCard({ title, contract, metrics = [] }) {
  const color = GATE_COLORS[title] || 'var(--ds-accent)';
  return (
    <div className="retro-card">
      <div className="retro-card-head">
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 20%, transparent)`,
            flexShrink: 0,
          }}
        />
        <h4 style={{ color }}>{title}</h4>
      </div>
      <div className="retro-card-contract">{contract}</div>
      <div className="retro-card-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="retro-metric-row">
            <span className="retro-metric-label">{m.label}</span>
            <span className="retro-metric-value">
              {typeof m.href === 'string' && m.href ? (
                <a href={m.href} target="_blank" rel="noreferrer">
                  {m.value}
                </a>
              ) : (
                m.value
              )}
            </span>
            {m.rag ? <RagPill value={m.rag} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
