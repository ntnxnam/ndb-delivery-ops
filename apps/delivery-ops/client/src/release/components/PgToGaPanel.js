import React from 'react';

function linked(value, href) {
  if (!href) return value;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}

export function PgToGaPanel({ pgToGa }) {
  return (
    <div className="retro-panel">
      <h3>PG to GA Window</h3>
      <div className="retro-window-grid">
        <div className="retro-window-tile">
          <div className="retro-window-label">Closed in window</div>
          <div className="retro-window-value">
            {linked(pgToGa?.closedInWindow ?? 0, pgToGa?.links?.closedInWindow)}
          </div>
        </div>
        <div className="retro-window-tile">
          <div className="retro-window-label">Deferred in window</div>
          <div className="retro-window-value">
            {linked(pgToGa?.deferredInWindow ?? 0, pgToGa?.links?.deferredInWindow)}
          </div>
        </div>
      </div>
    </div>
  );
}
