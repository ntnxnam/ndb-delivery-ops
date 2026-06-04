import React from 'react';

/**
 * MutedLabel — the uppercase, letter-spaced micro-label used everywhere
 * in the bin-packing aesthetic (column headers, KPI labels, sidebar
 * sub-headings).
 *
 * Variants:
 *   - default: muted color
 *   - strong:  full text color (use for labels that act as section
 *              dividers rather than supporting metadata)
 *
 * Polymorphic via `as` so it can render as `<span>`, `<th>`, `<div>`, etc.
 */
export function MutedLabel({
  children,
  strong = false,
  className = '',
  as: Tag = 'span',
  ...rest
}) {
  const classes = [
    'ds-muted-label',
    strong && 'ds-muted-label--strong',
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
