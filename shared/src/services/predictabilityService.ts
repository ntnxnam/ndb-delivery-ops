/**
 * predictabilityService — RETIRED PENDING PORT.
 *
 * This module previously held a Phase D1 stub. It has been retired in
 * favour of two concrete capabilities tracked in `CONSOLIDATION.md`:
 *
 *   - #4  landingForecastService (port from
 *         release-sprint-analysis-with-chatbot/landing_forecast.py)
 *   - #8  predictiveAnalyticsService (port from
 *         ~/.cursor/skills/predictive-team-exec-analytics/)
 *   - #15 sayVsDoService (port from ndb-say-vs-do/)
 *
 * The class is kept as an export so existing type references resolve,
 * but every method throws at runtime to surface the retirement loudly.
 *
 * When the real services land, delete this file and the re-export in
 * `shared/src/index.ts`.
 */

const RETIRED_MESSAGE =
  'PredictabilityService is retired. ' +
  'Use landingForecastService (#4), predictiveAnalyticsService (#8), or sayVsDoService (#15). ' +
  'See CONSOLIDATION.md for the port plan.';

export interface PredictabilityServiceOptions {
  // Kept loose: the retired class is a no-op shim.
  [k: string]: unknown;
}

export class PredictabilityService {
  constructor(_opts: PredictabilityServiceOptions = {}) {
    // No-op: the retired class is constructed but cannot be used.
  }

  async predictLanding(_productId: string, _releaseName: string): Promise<never> {
    throw new Error(RETIRED_MESSAGE);
  }

  async sayVsDo(
    _productId: string,
    _releaseName: string,
    _options?: unknown
  ): Promise<never> {
    throw new Error(RETIRED_MESSAGE);
  }
}
