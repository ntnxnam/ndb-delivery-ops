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
  /**
   * Main JIRA project of the base-filter tickets (e.g. 'ERA'). Release
   * versions are listed from this project.
   */
  projectKey: string;
  /** Optional feature-root project key (e.g. FEAT for NDB feature roots). */
  featureProjectKey?: string;
  /**
   * Base JQL filter for product-scoped queries. Already excludes Done
   * (statusCategory != Done) for active-work queries. The sprint scope is
   * derived from it (see `sprintScopeFromBaseFilter`).
   */
  baseFilter: string;
  /**
   * Components in the feature project, keyed by component name, each
   * listing its Primary Component children.
   */
  featureComponents?: Record<string, string[]>;
  /** Per-product custom-field overrides; falls back to global defaults */
  customFields?: ProductCustomFields;
  /** Per-product, per-audience overrides */
  audienceOverrides?: Partial<Record<AudienceId, AudienceOverrides>>;
  /** Confluence space key for product-scoped page operations */
  confluenceSpaceKey?: string;
  /** GitHub org/repo names for the githubConnector (Phase D2+) */
  githubOrgs?: string[];
  githubRepos?: string[];
  /**
   * Lowercase label-prefix used in JIRA labels to anchor product payload
   * (e.g. `ndb-2.11-must-have`, `datalens-x-wishlist`). Consumed by
   * `payloadJqlService` and `releaseDatasetService` wishlist/deferred
   * sidecars. Defaults to `id` when absent.
   */
  labelPrefix?: string;
  /**
   * Uppercase release-name prefix used by `releaseClassificationService`
   * to parse `NDB-2.11`, `DataLens-X`, etc. Defaults to `name` when
   * absent (NDB → "NDB", DataLens → "DataLens").
   */
  releasePrefix?: string;
  /**
   * Exact JIRA version names that are always included in the sync,
   * regardless of whether they match `releasePrefix`. Used for special
   * planning versions such as `"master"` or `"Era Future"` that don't
   * carry the product prefix but belong to the product's dataset.
   */
  activeVersionNames?: string[];
  /**
   * Sprint calendar (S1 anchor + sprint length in days). Required by
   * `sprintsService` and `releaseDatasetService` derived columns. No
   * default — must be explicitly configured per product because cadence
   * varies and there's no safe fallback.
   */
  sprintCalendar?: {
    s1StartIso: string;
    sprintDays: number;
  };
  /**
   * Non-engineering companion projects shown in retrospective readiness views.
   * These are checkpointed at PG and hard-gated at GA by default.
   */
  companionDisciplines?: Array<{
    projectKey: string;
    label: string;
    hardGate?: 'PG' | 'GA';
  }>;
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
