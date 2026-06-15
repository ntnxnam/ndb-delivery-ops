import React from 'react';

function linked(value, href) {
  if (!href) return value;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}

export function CompanionReadinessPanel({ companionReadiness }) {
  const rows = companionReadiness?.rows || [];
  return (
    <div className="retro-panel">
      <h3>Companion Disciplines</h3>
      <p className="retro-hint">
        PG is checkpoint mode for companion projects; GA is the hard gate.
      </p>
      <div className="retro-table-wrap">
        <table className="retro-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Label</th>
              <th>Open@PG</th>
              <th>Open@GA</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>No companion rows.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.projectKey}>
                  <td>{r.projectKey}</td>
                  <td>{r.label}</td>
                  <td>{linked(r.openAtPg, r.links?.openAtPg)}</td>
                  <td>{linked(r.openAtGa, r.links?.openAtGa)}</td>
                  <td>{r.statusLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
