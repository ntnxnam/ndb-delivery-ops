/*
 * design-system — barrel export.
 *
 * Import pattern at call sites:
 *
 *   import { Card, KPICard, SectionPanel, MutedLabel, Pill } from '../design-system';
 *
 * Wrap any new route in a `.ds-scope` (and ideally `.ds-page` for
 * full-page layouts) for the dark tokens to apply.
 *
 * Tokens + primitive CSS load via side-effect imports below so a
 * single `import 'design-system'` (or import of any primitive) ensures
 * the stylesheets are in the bundle.
 */
import './tokens.css';
import './primitives.css';

export { Card } from './Card.js';
export { KPICard } from './KPICard.js';
export { SectionPanel } from './SectionPanel.js';
export { MutedLabel } from './MutedLabel.js';
export { Pill } from './Pill.js';
export { GateChipStrip } from './GateChipStrip.js';
export { GateTimeline } from './GateTimeline.js';
