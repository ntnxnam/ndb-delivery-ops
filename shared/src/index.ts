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
