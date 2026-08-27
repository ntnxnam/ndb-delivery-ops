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
 *   - Return audience overrides (per-product Team Executive name, etc.)
 *   - Resolve JQL filter prefixes
 *   - Resolve a release-name → product mapping (for parent-projects with
 *     version patterns)
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ProductConfig,
  ProductCustomFields,
  ProductRegistry,
  JiraGlobalConfig,
  AudienceOverrides,
} from '../types/product.js';
import type { AudienceId } from '../types/audience.js';
import { compileVersionPattern } from '../utils/versionPattern.js';

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
   * Optional feature-root project key used by retrospective and feature-level
   * analysis (NDB uses FEAT for Feature roots). Falls back to FEAT.
   */
  getFeatureProjectKey(productId: string): string {
    const p = this.getProduct(productId);
    return p.featureProjectKey ?? 'FEAT';
  }

  /**
   * Non-engineering companion disciplines to show as a separate readiness
   * stream in retrospective views (e.g. TECHPUBS, SDL, LEG, SR, NDBQUAL).
   */
  getCompanionDisciplines(
    productId: string
  ): Array<{ projectKey: string; label: string; hardGate: 'PG' | 'GA' }> {
    const p = this.getProduct(productId);
    return (p.companionDisciplines ?? []).map((row) => ({
      projectKey: row.projectKey,
      label: row.label,
      hardGate: row.hardGate ?? 'GA',
    }));
  }

  /**
   * Returns the JQL fragment for "tickets belonging to this product".
   * For dedicated: `project = ERA`. For parent: `project = ENG AND
   * fixVersion ~ "DataLens"` (parent products are version-scoped).
   */
  buildJqlForProduct(productId: string, extraClauses: string[] = []): string {
    const p = this.getProduct(productId);
    const clauses: string[] = [`project = ${p.projectKey}`];
    if (p.versionPatterns?.length) {
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
   * Per-audience overrides for a product (e.g. Team Executive recipient name).
   * Returns an empty object if no override is configured.
   */
  getAudienceOverrides(productId: string, audience: AudienceId): AudienceOverrides {
    return this.getProduct(productId).audienceOverrides?.[audience] ?? {};
  }

  /**
   * Lowercase label-prefix used to anchor product payload in JIRA labels
   * (e.g. `ndb-2.11-must-have`). Consumed by `payloadJqlService` and
   * `releaseDatasetService` wishlist/deferred sidecars.
   *
   * Defaults to the product `id` when not explicitly configured — safe
   * because `id` is already lowercase and stable.
   */
  getLabelPrefix(productId: string): string {
    const p = this.getProduct(productId);
    return p.labelPrefix ?? p.id;
  }

  /**
   * Release-name prefix used by `releaseClassificationService` to strip
   * the product token off a version string (e.g. `'NDB-'` stripped from
   * `'NDB-2.11'` leaves `'2.11'`). MUST include the trailing separator
   * if one is used in the version-naming convention.
   *
   * Defaults to `${name}-` (e.g. NDB → `'NDB-'`, DataLens → `'DataLens-'`).
   */
  getReleasePrefix(productId: string): string {
    const p = this.getProduct(productId);
    return p.releasePrefix ?? `${p.name}-`;
  }

  /**
   * Returns the list of exact JIRA version names that are always included
   * in the sync alongside any `releasePrefix`-matched versions. Typical
   * examples: `"master"`, `"Era Future"`. Returns an empty array when
   * none are configured.
   */
  getActiveVersionNames(productId: string): string[] {
    return this.getProduct(productId).activeVersionNames ?? [];
  }

  /**
   * Sprint calendar (S1 anchor + sprint length). Required by
   * `sprintsService` and `releaseDatasetService` derived columns.
   *
   * No default: throws if not configured. Sprint cadence varies per
   * team and there is no safe fallback — silently using NDB's calendar
   * for another product would corrupt every sprint-derived metric.
   */
  getSprintCalendar(productId: string): { s1StartIso: string; sprintDays: number } {
    const p = this.getProduct(productId);
    if (!p.sprintCalendar) {
      throw new Error(
        `ProductService: product '${productId}' has no sprintCalendar configured. ` +
          `Edit the team in Admin, set the JIRA sprint board ID, and detect S1 start + sprint length from the board.`
      );
    }
    return p.sprintCalendar;
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
      const entries: { productId: string; regex: RegExp }[] = [];
      for (const pat of p.versionPatterns) {
        const regex = compileVersionPattern(pat);
        if (regex) entries.push({ productId: p.id, regex });
      }
      if (entries.length) index.set(p.id, entries);
    }
    return index;
  }
}

function escapeJqlString(s: string): string {
  // JIRA fixVersion ~ "X" tokens: escape backslashes and double-quotes.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function defaultConfigPath(): string {
  // Walk up from this compiled file's own location to find the monorepo
  // root, then descend into apps/delivery-ops/server/config. This is
  // robust regardless of which directory the caller's process is started
  // from — using process.cwd() doubled the path when callers invoked
  // from inside apps/delivery-ops/server (the most common server cwd).
  //
  // At runtime this file is at:
  //   <monorepo>/shared/dist/services/productService.js
  // so three dirname() calls give us <monorepo>/shared, and one more
  // gives us the monorepo root.
  const here = dirname(fileURLToPath(import.meta.url));
  const sharedRoot = resolve(here, '..', '..'); // shared/dist/services → shared
  const monorepoRoot = resolve(sharedRoot, '..'); // shared → monorepo
  const fromHere = join(
    monorepoRoot,
    'apps',
    'delivery-ops',
    'server',
    'config',
    'teamBoardConfig.json'
  );
  if (existsSync(fromHere)) return fromHere;
  // Fallback: if the file system layout changes, also try cwd resolution
  // so explicit non-monorepo deployments still work.
  return join(
    resolve(process.cwd()),
    'apps',
    'delivery-ops',
    'server',
    'config',
    'teamBoardConfig.json'
  );
}

/**
 * Process-global singleton. Reloads when teamBoardConfig.json changes
 * (admin-created teams / versionPatterns) so pages pick up the new team
 * without a process restart.
 */
let _singleton: ProductService | null = null;
let _singletonPath: string | undefined;
let _singletonMtime = -1;

export function getProductService(configPath?: string): ProductService {
  const resolvedPath = configPath ?? defaultConfigPath();
  let mtime = -1;
  try {
    mtime = statSync(resolvedPath).mtimeMs;
  } catch {
    mtime = -1;
  }
  if (!_singleton || _singletonPath !== resolvedPath || mtime !== _singletonMtime) {
    _singleton = new ProductService(resolvedPath);
    _singletonPath = resolvedPath;
    _singletonMtime = mtime;
  }
  return _singleton;
}

/** Test-only: reset the singleton. */
export function _resetProductService(): void {
  _singleton = null;
  _singletonPath = undefined;
  _singletonMtime = -1;
}
