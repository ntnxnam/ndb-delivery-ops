import React from 'react';
import { Card } from './Card.js';

/**
 * KPICard — single-metric card. Standard composition of the new
 * Release Brief and Team-Exec dashboards.
 *
 * Anatomy:
 *
 *   ┌───────────────────────────────────────────┐
 *   │ ● RELEASE PAYLOAD            (rag dot)    │
 *   │                                           │
 *   │ 1,247 tickets                             │
 *   │ ▲ +28 w/w                                 │
 *   │ Includes wishlist + deferred              │
 *   └───────────────────────────────────────────┘
 *
 * Props:
 *   - label       string         uppercase muted column heading
 *   - value       string|number  big number
 *   - unit        string         optional suffix (e.g. "tickets", "%")
 *   - delta       string|number  optional change indicator (no symbol)
 *   - deltaTrend  'up'|'down'|'flat'  drives color + arrow
 *   - caption     string         small line below the value
 *   - rag         'green'|'amber'|'red'|'grey'  optional status dot
 *   - href        string         turn the card into a JIRA link
 *                                (per jira-authenticity-links.mdc)
 *   - title       string         tooltip — usually the JQL behind the count
 *   - children    overrides the body if a non-numeric KPI is needed
 */
export function KPICard({
  label,
  value,
  unit,
  delta,
  deltaTrend = 'flat',
  caption,
  rag,
  href,
  title,
  className = '',
  children,
}) {
  const ArrowGlyph = deltaTrend === 'up'
    ? '▲'
    : deltaTrend === 'down'
      ? '▼'
      : '–';
  const body = (
    <div className="ds-kpi">
      {(label || rag) && (
        <div className="ds-kpi__label">
          {rag && <span className={`ds-kpi__rag ds-kpi__rag--${rag}`} aria-label={`status: ${rag}`} />}
          {label && <span>{label}</span>}
        </div>
      )}
      {children ? (
        children
      ) : (
        <>
          <div className="ds-kpi__value">
            <span className="ds-kpi__number">{value ?? '–'}</span>
            {unit && <span className="ds-kpi__unit">{unit}</span>}
          </div>
          {delta !== undefined && delta !== null && (
            <div className={`ds-kpi__delta ds-kpi__delta--${deltaTrend}`}>
              <span aria-hidden="true">{ArrowGlyph}</span>
              <span>{delta}</span>
            </div>
          )}
          {caption && <div className="ds-kpi__caption">{caption}</div>}
        </>
      )}
    </div>
  );

  if (href) {
    return (
      <Card clickable className={className} as="a" href={href} target="_blank" rel="noopener noreferrer" title={title}>
        {body}
      </Card>
    );
  }
  return (
    <Card className={className} title={title}>
      {body}
    </Card>
  );
}
