import React from 'react';

/**
 * Pill — small inline status / category tag. Six tones map to the
 * design-system status palette.
 */
export function Pill({ tone = 'muted', children, className = '', ...rest }) {
  return (
    <span className={`ds-pill ds-pill--${tone} ${className}`} {...rest}>
      {children}
    </span>
  );
}
