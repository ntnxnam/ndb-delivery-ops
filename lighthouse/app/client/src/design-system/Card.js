import React from 'react';

/**
 * Card — the base surface primitive of the new design system.
 *
 * Wraps content in a dark surface with a subtle border + shadow.
 * Variants:
 *   - default  surface tier
 *   - quiet    no background, no border (use as a content slot inside
 *              a SectionPanel when you want padding-only without
 *              double-borders)
 *   - raised   one tier brighter — for "selected" or "active" cards
 *   - clickable adds hover/active affordance
 *
 * Composition: pass any children. Card never renders its own headers
 * or actions — that's `SectionPanel`'s job.
 */
export function Card({
  children,
  variant = 'default',
  clickable = false,
  className = '',
  as: Tag = 'div',
  ...rest
}) {
  const classes = [
    'ds-card',
    variant === 'quiet' && 'ds-card--quiet',
    variant === 'raised' && 'ds-card--raised',
    clickable && 'ds-card--clickable',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
