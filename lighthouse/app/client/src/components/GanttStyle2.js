/**
 * GanttStyle2 — simple multi-release dot-on-line timeline.
 *
 * This is the original SoS release timeline (ReleaseGantt):
 * one horizontal axis per release version, showing CC/EC/CG/PG/GA as
 * dot markers with a Today line. Compact, read-only, no per-feature rows.
 *
 * Used by: SosSummaryPage (top-of-page multi-release overview).
 * Contrast with GanttStyle1 / ReleaseVersionGantt which renders per-feature
 * bar rows with full vertical gate markers.
 *
 * Re-exports ReleaseGantt unchanged so the style is preserved, not rebuilt.
 */
export { default } from './ReleaseGantt';
