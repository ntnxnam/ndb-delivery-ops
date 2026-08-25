/**
 * @portfolio-delivery-ops/shared — public API root.
 *
 * Layer responsibilities (per ARCHITECTURE.md):
 *   - types/        — domain models, audience IDs, citation shape
 *   - connectors/   — JIRA (+ Confluence/GitHub/Slack/Email in Phase D2)
 *   - services/     — business logic (productService, statusService, ...)
 *
 * Consumers (mcp-server, apps/delivery-ops/server) import from these
 * three sub-paths or from the root re-export.
 */

export * as types from './types/index.js';
export * as connectors from './connectors/index.js';
export * as services from './services/index.js';
export * as agentPack from './agentPack/index.js';

// Common re-exports for convenience.
export { JiraConnector } from './connectors/jiraConnector.js';
export { ConfluenceConnector } from './connectors/confluenceConnector.js';
export { loadEnv } from './connectors/env.js';
export { ProductService, getProductService } from './services/productService.js';
export { StatusService } from './services/statusService.js';
export { PredictabilityService } from './services/predictabilityService.js';
export { DependencyService } from './services/dependencyService.js';
export { ChartService } from './services/chartService.js';
export {
  DateMoverService,
  GATE_DATE_FIELDS,
  isGateDateField,
  buildAuditRow,
} from './services/dateMoverService.js';
export {
  buildEngineeringPayloadJql,
  buildReleasePayloadJql,
  getComponentQueries,
  getWishlistQuery,
  getDeferredQuery,
  getLongTermFundedQuery,
  getExtensionQuery,
  chunkKeys,
  jqlEpicsByParentKeys,
  jqlWorkByEpicKeys,
  FETCH_STRATEGY,
  JQL_IN_CHUNK_SIZE,
  PAYLOAD_BUCKET_KEYS,
  PORTFOLIO_ROOT_TYPES,
  PORTFOLIO_CONTAINER_TYPES,
  WISHLIST_COMPONENT,
  DEFERRED_COMPONENT,
  LONG_TERM_COMPONENT,
  EXTENSION_COMPONENT,
} from './services/payloadJqlService.js';
export type {
  EngineeringPayloadOptions,
  ReleasePayloadOptions,
} from './services/payloadJqlService.js';
export type { PayloadBucketKey } from './services/payloadJqlService.js';
export {
  TicketFetchService,
  buildAllTicketsJql,
  buildWorkItemsJql,
  buildAllTicketsUrl,
  buildWorkItemsUrl,
  isValidProjectKey,
  WORK_ITEMS_EXCLUDED_TYPES,
} from './services/ticketFetchService.js';
export type {
  TicketBreakdown,
  TicketJqlOptions,
  TicketUrlOptions,
  FetchBreakdownOptions,
} from './services/ticketFetchService.js';
export {
  fetchReleaseData,
  fetchBucket,
  ticketFromIssue,
  RELEASE_DATASET_FIELDS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_ISSUES_PER_BUCKET,
  DEFAULT_FETCH_CONCURRENCY,
  SLOW_BUCKETS,
  SLOW_BUCKET_TIMEOUT_MS,
} from './services/releaseDatasetService.js';
export type {
  ProcessedTicket,
  ProcessedTicketWithDerived,
  GateDateHistory,
  GateDateHistoryEntry,
  FetchReleaseResult,
  FetchReleaseOptions,
  FetchBucketResult,
  FetchBucketOptions,
  ProcessMasterOptions,
  LabelOptions,
  ExtractDeferredOptions,
} from './services/releaseDatasetService.js';
export {
  processMaster,
  isDeferredLabel,
  isWishlistLabel,
  extractDeferredSourceReleases,
  priorityBand,
  PROCESSED_DATASET_COLUMNS,
} from './services/releaseDatasetService.js';

// Phase 3 of #1b — cache + sync + changelog enrichment.
export {
  ReleaseDatasetCache,
  CACHE_SCHEMA,
  SYNC_LOCK_STALE_SECONDS,
  computeReleaseJqlHash,
} from './services/releaseDatasetCache.js';
export type {
  CacheOptions,
  ReleaseCacheMeta,
  BucketCacheMeta,
  BundleCacheMeta,
  BundleCachePayload,
  CachedReleaseInfo,
  LoadReleaseOptions,
} from './services/releaseDatasetCache.js';
export {
  syncReleaseDataset,
  rebuildBundleFromDisk,
  enrichClosedDates,
  enrichGateDateHistory,
  extractClosedDate,
  CHANGELOG_REQUIRED_TYPES,
  GATE_HISTORY_TYPES,
  DEFAULT_CHANGELOG_CONCURRENCY,
  syncReleaseBucket,
} from './services/releaseDatasetSync.js';
export type {
  SyncOptions,
  SyncResult,
  SyncProgressEvent,
  EnrichClosedDatesOptions,
  JiraChangelogHistory,
  SyncBucketOptions,
  SyncBucketResult,
} from './services/releaseDatasetSync.js';

export {
  parseVersion,
  classifyRelease,
  isAtLeastVersion,
  sortKey,
  compareSortKeys,
  PRE_RELEASE_SUFFIXES,
  CLASSIFICATION_COLORS,
} from './services/releaseClassificationService.js';
export type {
  ReleaseType,
  ParsedVersion,
  ClassificationOptions,
  SortKey,
} from './services/releaseClassificationService.js';

export {
  groupFor,
  workTypeFor,
  groupFilterJql,
  PROJECT_HIERARCHY,
  DEV_CODE,
  KNOWN_EVERYTHING_ELSE,
  ALL_GROUPS,
  DISPLAY_GROUPS,
} from './services/issueGroupsService.js';
export type { IssueGroup, WorkType } from './services/issueGroupsService.js';

export {
  categorizeResolution,
  categoryFilterJql,
  isDoneResolution,
  DONE_RESOLUTIONS,
  DUPE_RESOLUTIONS,
  RESOLUTION_CATEGORIES,
} from './services/resolutionCategoriesService.js';
export type { ResolutionCategory } from './services/resolutionCategoriesService.js';

export {
  sprintFor,
  sprintWindow,
  currentSprint,
  enumerateSprints,
  sprintLabel,
  NDB_SPRINT_CALENDAR,
} from './services/sprintsService.js';
export type { SprintCalendar } from './services/sprintsService.js';

export {
  computeSprintVelocity,
  computeRecentSprintVelocity,
  QA_VERIFICATION_EFFORT_RATIO,
} from './services/velocityService.js';
export type {
  ComputeSprintVelocityOptions,
  SprintVelocityStream,
  SprintVelocityResult,
} from './services/velocityService.js';

export {
  buildOutstandingJqls,
  computeOutstandingCounts,
  OUTSTANDING_TILE_KEYS,
} from './services/outstandingService.js';
export type {
  OutstandingJqlOptions,
  OutstandingTileKey,
  OutstandingTileResult,
} from './services/outstandingService.js';

export {
  computeLandingForecast,
  classifyConfidence,
  classifyVerdict,
  gapPhrase,
  buildForecastOneLiner,
  FORECAST_VERDICT_COLORS,
  FORECAST_VERDICT_LABELS,
  FORECAST_CONFIDENCE_LABELS,
} from './services/landingForecastService.js';
export type {
  ComputeLandingForecastOptions,
  LandingForecastResult,
  ForecastVerdict,
  ForecastConfidence,
} from './services/landingForecastService.js';

export {
  parseReleaseGateTimeline,
  gateKindLabel,
  gateKindColor,
} from './services/gateTimelineService.js';
export type {
  GateKind,
  GateStyle,
  GateEvent,
  ReleaseGateTimeline,
  ParseGateTimelineOptions,
} from './services/gateTimelineService.js';

export {
  buildRetroJqls,
  resolveGateDates,
  getRetroBootstrap,
  getRetroProjectsPage,
  getRetroProjectDetail,
  runRetroGateChecks,
  runNaughtyList,
} from './services/retroService.js';
export type {
  RetrospectiveOptions,
  RetroProjectsPageOptions,
  RetrospectiveParentProject,
  RetrospectiveDiscipline,
} from './services/retroService.js';

export {
  computePayloadMetrics,
  computeLabelAnchoredMetrics,
  computeReleaseInsights,
  filterVisiblePayload,
  filterFullRelease,
  VISIBLE_COMPONENTS,
} from './services/releaseInsightsService.js';
export type {
  PayloadMetrics,
  PayloadMetricsContext,
  LabelAnchoredMetrics,
  LabelAnchoredOptions,
  ReleaseInsights,
  ReleaseInsightsOptions,
} from './services/releaseInsightsService.js';

export {
  buildFeatureListJql,
  buildCanonicalPayloadJql,
  buildFeatIdMentionJql,
  buildFeatNumberMentionJql,
  issueFromJira,
  toFeatureListItem,
  diffByKey,
  buildFlowSeries,
  buildFeatureKpis,
  parseStatusUpdate20,
  FEATURE_DASHBOARD_FIELDS,
} from './services/featureDashboardService.js';
export type {
  FeatureListItem,
  FeatureOverviewGates,
  FeatureDashboardIssue,
  FeatureFlowPoint,
  FeatureKpiTile,
  StatusUpdateSection,
} from './services/featureDashboardService.js';

export {
  loadAgentPack,
  resolveAgentPackRoot,
  listSkillsByType,
  listSkillsByToolClass,
} from './agentPack/index.js';
export type {
  AgentPack,
  AgentPackManifest,
  CapabilityType,
  IdentityRole,
  LoadedIdentity,
  LoadedRule,
  LoadedSkill,
  LoadedWorkflow,
  ToolClass,
} from './agentPack/index.js';
