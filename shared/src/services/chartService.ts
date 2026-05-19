/**
 * chartService — RETIRED PENDING PORT.
 *
 * This module previously held a Phase D1 placeholder that returned a
 * grey "[chart placeholder]" SVG. It has been retired in favour of the
 * concrete capability tracked in `CONSOLIDATION.md`:
 *
 *   - #5 chartCatalogService (port from
 *        release-sprint-analysis-with-chatbot/chart_catalog.py with
 *        `[chart:<id>]` token substitution for the NAI chatbot)
 *
 * The class is kept as an export so existing type references resolve,
 * but `render()` throws at runtime to surface the retirement loudly.
 *
 * When the real service lands, delete this file and the re-export in
 * `shared/src/index.ts`.
 */

import type { ChartSpec, ChartRef } from '../types/chart.js';

const RETIRED_MESSAGE =
  'ChartService is retired. ' +
  'Use chartCatalogService (#5 in CONSOLIDATION.md) once it is ported. ' +
  'The placeholder SVG implementation was misleading consumers.';

export class ChartService {
  async render(_spec: ChartSpec): Promise<ChartRef> {
    throw new Error(RETIRED_MESSAGE);
  }
}
