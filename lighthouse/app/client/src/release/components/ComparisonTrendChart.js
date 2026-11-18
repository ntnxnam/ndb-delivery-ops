import React from 'react';

/**
 * ComparisonTrendChart — tiny inline SVG sparkline of a metric across
 * releases (oldest -> newest). Kept small per ui-density.mdc (well under
 * the 280px chart cap). Purely presentational.
 *
 * @param {{ points: Array<{release: string, value: number|null}>, lowerIsBetter?: boolean }} props
 */
export function ComparisonTrendChart({ points = [], lowerIsBetter = false }) {
  const vals = points.map((p) => (typeof p.value === 'number' ? p.value : null));
  const nums = vals.filter((v) => v != null);
  if (nums.length < 2) return <span style={{ color: 'var(--ds-muted)' }}>—</span>;

  const w = 96;
  const h = 26;
  const pad = 3;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);

  const coords = points.map((p, i) => {
    const v = typeof p.value === 'number' ? p.value : min;
    const x = pad + i * step;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return { x, y, has: typeof p.value === 'number' };
  });

  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  // Trend direction of the last segment for colouring.
  const last = nums[nums.length - 1];
  const prev = nums[nums.length - 2];
  const improved = lowerIsBetter ? last < prev : last > prev;
  const worse = lowerIsBetter ? last > prev : last < prev;
  const stroke = improved ? 'var(--ds-success)' : worse ? 'var(--ds-danger)' : 'var(--ds-muted)';

  return (
    <svg width={w} height={h} role="img" aria-label="trend" style={{ display: 'block' }}>
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" />
      {coords.map((c, i) =>
        c.has ? <circle key={i} cx={c.x} cy={c.y} r={1.6} fill={stroke} /> : null
      )}
    </svg>
  );
}
