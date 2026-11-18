import React from 'react';

/**
 * Compact chips for median days in each status (top N).
 * Display-only — medians come from changelog sample, not a live status= JQL.
 */
export default function StatusDwellTiles({ statusDwell, max = 5 }) {
  const rows = (statusDwell || []).slice(0, max);
  if (!rows.length) {
    return <p className="kpi-pulse-muted">No in-flight status dwell in the sample yet.</p>;
  }

  return (
    <div className="kpi-pulse-dwell" aria-label="Time spent in status">
      {rows.map((r) => (
        <span
          key={r.status}
          className="kpi-pulse-dwell-chip"
          title={`Median days in “${r.status}” before Done (sample n=${r.sampleSize})`}
        >
          {r.status}: {r.medianDays}d med
        </span>
      ))}
    </div>
  );
}
