/**
 * Chart types — used by chartService (D4) to render charts inline in
 * agent answers, reports, and emails.
 *
 * The actual rendering implementation is deferred to Phase D2. This file
 * defines the contract.
 */

export type ChartKind =
  | 'rag-over-time'
  | 'landing-date-confidence'
  | 'risk-burndown'
  | 'top-risks-by-owner'
  | 'predictability-say-vs-do'
  | 'scope-creep'
  | 'team-velocity'
  | 'sprint-carryover';

export interface ChartSpec {
  kind: ChartKind;
  title: string;
  data: unknown;
  /** Optional explicit width/height in pixels for HTML rendering */
  width?: number;
  height?: number;
}

/**
 * Reference to a rendered chart — what agents emit and renderers consume.
 *
 * Per D4, charts are produced as SVG (inline-able in email/HTML/chat) and
 * optionally PNG for clients that don't render SVG.
 */
export interface ChartRef {
  spec: ChartSpec;
  /** SVG markup or data URI */
  svg: string;
  /** Optional PNG fallback (base64 data URI) */
  pngDataUri?: string;
  /** Data-source caption (per citation-first-output.mdc) */
  caption: string;
}
