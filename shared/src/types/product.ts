/**
 * Product config — the per-product registry.
 *
 * Per D1 (product-agnostic by design) and D5 (product-aware config, not
 * full multi-tenancy), each product (NDB, DataLens, NCM, …) has a config
 * entry. Services consult productService to resolve product-specific
 * values; no NDB-specific strings live in code.
 *
 * The on-disk file is `apps/delivery-ops/server/config/teamBoardConfig.json`
 * (legacy name). Each "team" entry in that file IS a product in the new
 * model.
 */

import type { AudienceId } from './audience.js';

/**
 * Project type. "Dedicated" = the product has its own JIRA project
 * (e.g. NDB → ERA). "Parent" = the product shares a JIRA project with
 * other products and is identified by version-name patterns (e.g.
 * DataLens lives inside ENG, filtered by versions matching `^DataLens.*`).
 */
export type ProductProjectType = 'dedicated' | 'parent';

/**
 * Custom-field overrides per product. If a key is absent, the global
 * default from `JiraGlobalConfig` is used (e.g. `sprintFieldId`,
 * `storyPointsFieldId` at the top of `teamBoardConfig.json`).
 *
 * Per `minimal-architecture.mdc` hard line #3, customfield IDs only
 * appear in this config — never inline in services.
 */
export interface ProductCustomFields {
  sprintFieldId?: string;
  storyPointsFieldId?: string;
  /** Code Complete date (Nutanix-wide default: customfield_11067) */
  codeCompleteDateFieldId?: string;
  /** Commit Gate Ready Estimation Date (default: customfield_35863) */
  commitGateDateFieldId?: string;
  /** Promotion Gate Ready Estimation Date (default: customfield_35864) */
  promotionGateDateFieldId?: string;
  /** Generic extension point for per-product field overrides */
  extras?: Record<string, string>;
}

/**
 * Per-audience overrides per product. e.g. NDB's Team Executive has a different
 * name than DataLens's Team Executive; the renderer reads display names from here.
 */
export interface AudienceOverrides {
  /** Display name of the recipient ("Hi <recipientName>,") */
  recipientName?: string;
  /** Email address for digests (if differs from default routing) */
  recipientEmail?: string;
  /** Override for the audience's preferred chart style */
  chartStyle?: 'compact' | 'detailed';
}

export interface ProductConfig {
  /** Stable lowercase id used throughout the platform (e.g. 'ndb') */
  id: string;
  /** Display name for UI/reports (e.g. 'NDB', 'DataLens', 'NCM') */
  name: string;
  /** JIRA Agile board ID, or null if the product has no dedicated board */
  boardId: number | null;
  /** JIRA project key the product's tickets live under (e.g. 'ERA') */
  projectKey: string;
  /** Whether the product has a dedicated project or shares a parent */
  projectType: ProductProjectType;
  /**
   * Version-name regex patterns when projectType=parent. The product's
   * releases are JIRA versions matching ANY of these.
   */
  versionPatterns?: string[];
  /**
   * Base JQL filter for product-scoped queries. Already excludes Done
   * (statusCategory != Done) for active-work queries.
   */
  baseFilter: string;
  /** Sprint-scoped JQL filter (typically broader than baseFilter). */
  sprintBaseFilter: string;
  /** Per-product custom-field overrides; falls back to global defaults */
  customFields?: ProductCustomFields;
  /** Per-product, per-audience overrides */
  audienceOverrides?: Partial<Record<AudienceId, AudienceOverrides>>;
  /** Confluence space key for product-scoped page operations */
  confluenceSpaceKey?: string;
  /** GitHub org/repo names for the githubConnector (Phase D2+) */
  githubOrgs?: string[];
  githubRepos?: string[];
}

/**
 * Global config shared across all products (top of teamBoardConfig.json).
 * Used as defaults when ProductCustomFields omits a key.
 */
export interface JiraGlobalConfig {
  sprintFieldId: string;
  storyPointsFieldId: string;
  /** Status name that means "Done / Closed / Completed" */
  completedStatusName: string;
  /** Status name for tickets in QA / Resolved waiting for verification */
  pendingQAStatusName: string;
}

/**
 * The top-level shape of teamBoardConfig.json.
 */
export interface ProductRegistry extends JiraGlobalConfig {
  _schema_version?: string;
  _description?: string;
  teams: ProductConfig[];
  defaultTeamId: string;
}

/**
 * The session-scoped active-product set (per D5). A user picks one or
 * more products in the top-bar product picker; every service call
 * receives this set.
 */
export interface ActiveProductSet {
  productIds: string[];
  /** Optional default: the user's primary product for unscoped queries */
  primary?: string;
}
