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
  buildPayloadJql,
  getComponentQueries,
  getWishlistQuery,
  getDeferredQuery,
  PAYLOAD_BUCKET_KEYS,
  PORTFOLIO_ROOT_TYPES,
  PORTFOLIO_CONTAINER_TYPES,
  WISHLIST_COMPONENT,
  DEFERRED_COMPONENT,
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
} from './services/releaseDatasetService.js';
export type {
  ProcessedTicket,
  ProcessedTicketWithDerived,
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
