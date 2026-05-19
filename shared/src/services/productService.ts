/**
 * productService — the foundation of product-agnostic operation.
 *
 * Per D1 (product-agnostic by design) and `product-agnostic.mdc`, every
 * service that touches external systems resolves product-specific values
 * through this service. No NDB-specific strings live outside the config
 * file `teamBoardConfig.json` and this service.
 *
 * Responsibilities:
 *   - Load the on-disk product registry once at startup, cache in memory
 *   - Resolve product config by id
 *   - Return JIRA project key(s) for a product
 *   - Return custom-field IDs (with per-product overrides on top of globals)
 *   - Return audience overrides (per-product VP name, etc.)
 *   - Resolve JQL filter prefixes
 *   - Resolve a release-name → product mapping (for parent-projects with
 *     version patterns)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  ProductConfig,
  ProductCustomFields,
  ProductRegistry,
  JiraGlobalConfig,
  AudienceOverrides,
} from '../types/product.js';
import type { AudienceId } from '../types/audience.js';

/**
 * Nutanix-wide defaults for JIRA custom fields. These come from the legacy
 * `teamBoardConfig.json` top-level fields. Per-product overrides win.
 *
 * Per jira-date-hierarchy.mdc, the gate dates are:
 *   - codeCompleteDateFieldId   → customfield_11067
 *   - commitGateDateFieldId     → customfield_35863
 *   - promotionGateDateFieldId  → customfield_35864
 */
const DEFAULT_CUSTOM_FIELDS: Required<Omit<ProductCustomFields, 'extras'>> = {
  sprintFieldId: 'customfield_10360',
  storyPointsFieldId: 'customfield_10002',
  codeCompleteDateFieldId: 'customfield_11067',
  commitGateDateFieldId: 'customfield_35863',
  promotionGateDateFieldId: 'customfield_35864',
};

const DEFAULT_GLOBAL: JiraGlobalConfig = {
  sprintFieldId: 'customfield_10360',
  storyPointsFieldId: 'customfield_10002',
  completedStatusName: 'Closed',
  pendingQAStatusName: 'Resolved',
};

export class ProductService {
  private registry: ProductRegistry;
  private byId: Map<string, ProductConfig>;
  private versionPatterns: Map<string, { productId: string; regex: RegExp }[]>;

  /**
   * @param configPath Path to `teamBoardConfig.json`. Defaults to the
   *   legacy location under `apps/delivery-ops/server/config/`.
   */
  constructor(configPath?: string) {
    const path = configPath ?? defaultConfigPath();
    if (!existsSync(path)) {
      throw new Error(
        `ProductService: config file not found at ${path}. ` +
          `Set the path explicitly or place teamBoardConfig.json there.`
      );
    }
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as ProductRegistry;
    this.registry = this.normalise(parsed);
    this.byId = new Map(this.registry.teams.map((p) => [p.id, p]));
    this.versionPatterns = this.buildVersionPatternIndex();
  }

  /**
   * Return all configured products.
   */
  listProducts(): ProductConfig[] {
    return this.registry.teams;
  }

  /**
   * Resolve a product by id. Throws if not found — never silently
   * defaults (this would leak NDB-isms back in).
   */
  getProduct(productId: string): ProductConfig {
    const p = this.byId.get(productId);
    if (!p) {
      throw new Error(
        `ProductService: unknown productId '${productId}'. ` +
          `Known: ${[...this.byId.keys()].join(', ')}.`
      );
    }
    return p;
  }

  /**
   * The "default" product id when caller omits one. Reads
   * `registry.defaultTeamId` (legacy name).
   */
  getDefaultProductId(): string {
    return this.registry.defaultTeamId;
  }

  /**
   * Display name (e.g. "NDB", "DataLens").
   */
  getDisplayName(productId: string): string {
    return this.getProduct(productId).name;
  }

  /**
   * Returns the JIRA project key(s) a product's tickets live in. For
   * `dedicated` products that's a single key; for `parent` products the
   * caller may also need versionPatterns to narrow further (use
   * `buildJqlForProduct`).
   */
  getJiraProjects(productId: string): string[] {
    const p = this.getProduct(productId);
    return [p.projectKey];
  }

  /**
   * Returns the JQL fragment for "tickets belonging to this product".
   * For dedicated: `project = ERA`. For parent: `project = ENG AND
   * fixVersion ~ "DataLens"` (parent products are version-scoped).
   */
  buildJqlForProduct(productId: string, extraClauses: string[] = []): string {
    const p = this.getProduct(productId);
    const clauses: string[] = [`project = ${p.projectKey}`];
    if (p.projectType === 'parent' && p.versionPatterns?.length) {
      const versionClauses = p.versionPatterns
        .map((pat) => `fixVersion ~ "${escapeJqlString(pat)}"`)
        .join(' OR ');
      clauses.push(`(${versionClauses})`);
    }
    clauses.push(...extraClauses);
    return clauses.join(' AND ');
  }

  /**
   * Returns the base filter clause for active-work queries (already
   * excludes Done).
   */
  getBaseFilter(productId: string): string {
    return this.getProduct(productId).baseFilter;
  }

  getSprintBaseFilter(productId: string): string {
    return this.getProduct(productId).sprintBaseFilter;
  }

  /**
   * Returns the JIRA board id for a product, or null if the product has
   * no dedicated board (parent products typically don't).
   */
  getBoardId(productId: string): number | null {
    return this.getProduct(productId).boardId;
  }

  /**
   * Returns the merged custom-field map for a product (global defaults +
   * per-product overrides). Per `minimal-architecture.mdc` hard line #3,
   * this is THE single source of truth for customfield_NNNNN values.
   */
  getCustomFields(productId: string): Required<Omit<ProductCustomFields, 'extras'>> & {
    extras: Record<string, string>;
  } {
    const p = this.getProduct(productId);
    const cf = p.customFields ?? {};
    return {
      sprintFieldId: cf.sprintFieldId ?? this.registry.sprintFieldId ?? DEFAULT_CUSTOM_FIELDS.sprintFieldId,
      storyPointsFieldId:
        cf.storyPointsFieldId ?? this.registry.storyPointsFieldId ?? DEFAULT_CUSTOM_FIELDS.storyPointsFieldId,
      codeCompleteDateFieldId:
        cf.codeCompleteDateFieldId ?? DEFAULT_CUSTOM_FIELDS.codeCompleteDateFieldId,
      commitGateDateFieldId:
        cf.commitGateDateFieldId ?? DEFAULT_CUSTOM_FIELDS.commitGateDateFieldId,
      promotionGateDateFieldId:
        cf.promotionGateDateFieldId ?? DEFAULT_CUSTOM_FIELDS.promotionGateDateFieldId,
      extras: cf.extras ?? {},
    };
  }

  /**
   * Returns global JIRA config (status names, etc.).
   */
  getGlobalConfig(): JiraGlobalConfig {
    return {
      sprintFieldId: this.registry.sprintFieldId ?? DEFAULT_GLOBAL.sprintFieldId,
      storyPointsFieldId: this.registry.storyPointsFieldId ?? DEFAULT_GLOBAL.storyPointsFieldId,
      completedStatusName: this.registry.completedStatusName ?? DEFAULT_GLOBAL.completedStatusName,
      pendingQAStatusName: this.registry.pendingQAStatusName ?? DEFAULT_GLOBAL.pendingQAStatusName,
    };
  }

  /**
   * Per-audience overrides for a product (e.g. VP recipient name).
   * Returns an empty object if no override is configured.
   */
  getAudienceOverrides(productId: string, audience: AudienceId): AudienceOverrides {
    return this.getProduct(productId).audienceOverrides?.[audience] ?? {};
  }

  /**
   * Given a JIRA fixVersion name (e.g. "NDB-2.11", "DataLens-X"), resolve
   * the owning product id. Useful when the caller only has a release
   * name but needs the product context.
   *
   * For dedicated products, the version name doesn't necessarily contain
   * the project key, so we fall back to scanning version patterns.
   */
  resolveProductForVersion(versionName: string): string | null {
    for (const [productId, patterns] of this.versionPatterns) {
      for (const { regex } of patterns) {
        if (regex.test(versionName)) return productId;
      }
    }
    return null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private normalise(parsed: ProductRegistry): ProductRegistry {
    // The legacy file has minimal validation. Apply small sanity checks
    // here so downstream code can assume a clean shape.
    if (!Array.isArray(parsed.teams) || parsed.teams.length === 0) {
      throw new Error('ProductService: registry has no teams/products.');
    }
    if (!parsed.defaultTeamId) {
      parsed.defaultTeamId = parsed.teams[0]!.id;
    }
    return parsed;
  }

  private buildVersionPatternIndex(): Map<string, { productId: string; regex: RegExp }[]> {
    const index = new Map<string, { productId: string; regex: RegExp }[]>();
    for (const p of this.registry.teams) {
      if (!p.versionPatterns?.length) continue;
      const entries = p.versionPatterns.map((pat) => ({
        productId: p.id,
        regex: new RegExp(pat),
      }));
      index.set(p.id, entries);
    }
    return index;
  }
}

function escapeJqlString(s: string): string {
  // JIRA fixVersion ~ "X" tokens: escape backslashes and double-quotes.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function defaultConfigPath(): string {
  // From `shared/dist/services/productService.js` at runtime, walk up to
  // the monorepo root then into apps/delivery-ops/server/config.
  // The path is computed lazily so callers can override via constructor.
  const monorepoRoot = resolve(process.cwd());
  return join(
    monorepoRoot,
    'apps',
    'delivery-ops',
    'server',
    'config',
    'teamBoardConfig.json'
  );
}

/**
 * Process-global singleton. Most callers should use this.
 */
let _singleton: ProductService | null = null;

export function getProductService(configPath?: string): ProductService {
  if (!_singleton) {
    _singleton = new ProductService(configPath);
  }
  return _singleton;
}

/** Test-only: reset the singleton. */
export function _resetProductService(): void {
  _singleton = null;
}
