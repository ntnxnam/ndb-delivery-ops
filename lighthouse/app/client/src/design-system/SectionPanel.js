import React from 'react';

/**
 * SectionPanel — the dominant page-section primitive. Header strip
 * (title + caption + optional actions) sits above a padded body.
 *
 * Use `flush` body when the section wraps a table or another full-bleed
 * surface that owns its own padding (e.g. a Gantt chart).
 *
 * Composition expectation: every new page is a vertical stack of
 * SectionPanels. Keeps rhythm consistent across surfaces.
 */
export function SectionPanel({
  title,
  caption,
  actions,
  children,
  flush = false,
  className = '',
}) {
  return (
    <section className={`ds-section ${className}`}>
      {(title || caption || actions) && (
        <header className="ds-section__header">
          {title && <h3 className="ds-section__title">{title}</h3>}
          {caption && <p className="ds-section__caption">{caption}</p>}
          {actions && <div className="ds-section__actions">{actions}</div>}
        </header>
      )}
      <div className={`ds-section__body ${flush ? 'ds-section__body--flush' : ''}`}>
        {children}
      </div>
    </section>
  );
}
