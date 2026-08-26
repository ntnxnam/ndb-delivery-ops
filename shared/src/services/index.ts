/**
 * Services — public API of @portfolio-delivery-ops/shared/services.
 *
 * Implemented (real, not stub):
 *   - productService           (foundation, D1/D5)
 *   - dateMoverService         (D30 — gate-date moves with audit)
 *   - velocityService          (#2 — 3-stream velocity, trunk + live fallback)
 *   - landingForecastService   (#4 — MVP landing date, trunk + live fallback)
 *
 * Partial (some methods working, more to come):
 *   - statusService            (releaseRag + topBlockers only)
 *   - dependencyService        (upstreamOf only)
 *
 * Speculative stubs (scheduled to be retired by their real ports —
 * see CONSOLIDATION.md):
 *   - predictabilityService    (replaced by #4 landingForecastService + #8 predictiveAnalyticsService)
 *   - chartService             (replaced by #5 chartCatalogService)
 *
 * Future ports per CONSOLIDATION.md will add real services here as
 * each capability is migrated from the archived apps.
 */

export * from './productService.js';
export * from './statusService.js';
export * from './predictabilityService.js';
export * from './dependencyService.js';
export * from './chartService.js';
export * from './dateMoverService.js';
export * from './payloadJqlService.js';
export * from './ticketFetchService.js';
export * from './releaseDatasetService.js';
export * from './releaseDatasetCache.js';
export * from './releaseDatasetSync.js';
export * from './releaseClassificationService.js';
export * from './issueGroupsService.js';
export * from './resolutionCategoriesService.js';
export * from './sprintsService.js';
export * from './releaseInsightsService.js';
export * from './velocityService.js';
export * from './landingForecastService.js';
export * from './featureDashboardService.js';
export * from './retroService.js';
export * from './riskIndicator.js';
export * from './sprintMetrics.js';
export * from './releaseIntelligence.js';
