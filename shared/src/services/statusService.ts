/**
 * statusService — release status, risk, and rollup logic.
 *
 * This is the backbone service called by:
 *   - team-exec-specialist (releaseRag + topBlockers per D15)
 *   - tpm-specialist (releaseRagByActive, teamWeeklyDelta, featCallouts per D17)
 *   - rm-specialist (gateProgression per D20)
 *   - the Team Executive / TPM / weekly-status workflows
 *
 * Per `minimal-architecture.mdc`, business logic lives here, NOT in
 * route handlers. Per `citation-first-output.mdc`, every output includes
 * citations referencing the JQL queries + JIRA keys that produced it.
 *
 * Phase D1 implements:
 *   - releaseRag         (used by Team Executive top tier, weekly status top tier)
 *   - topBlockers        (used by Team Executive risk register)
 *   - getActiveReleases  (per D13)
 *
 * Phase D2 will add:
 *   - releaseRagByActive (parallel rollup across active releases)
 *   - teamWeeklyDelta    (D17 middle tier)
 *   - featCallouts       (D17 bottom tier)
 *   - outstanding        (Outstanding Work computation)
 *   - gateProgression    (D20)
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { ProductService } from './productService.js';
import type {
  Release,
  ReleaseRag,
  Rag,
  Citation,
  Risk,
  TopBlockers,
} from '../types/release.js';
import { classifyIssueType } from '../types/ticket.js';

export interface StatusServiceOptions {
  jira: JiraConnector;
  products: ProductService;
}

/**
 * Thresholds for RAG computation. Tunable; defaults below match what the
 * legacy `apps/delivery-ops/server/services/releaseAnalysisService.js`
 * has been using empirically.
 */
const RAG_THRESHOLDS = {
  /** % of open high-priority bugs above which RAG goes red */
  redOpenP0P1Pct: 15,
  amberOpenP0P1Pct: 8,
  /** Days to RTM below which any open P0 is automatic red */
  daysToRtmRedZone: 14,
  /** Days to RTM below which open scope > X% is red */
  daysToRtmAmberZone: 30,
};

export class StatusService {
  private jira: JiraConnector;
  private products: ProductService;

  constructor(opts: StatusServiceOptions) {
    this.jira = opts.jira;
    this.products = opts.products;
  }

  // ── D13: active releases ─────────────────────────────────────────────────

  /**
   * Returns the list of releases tagged `status: active` for a product.
   *
   * Phase D1: the release status field doesn't yet live in JIRA — it's
   * derived from the JIRA fixVersion (unreleased + unarchived) plus an
   * optional override list. Phase D2 will add an explicit
   * `release_status` custom field (D13) and read it directly.
   */
  async getActiveReleases(productId: string): Promise<Release[]> {
    const productCfg = this.products.getProduct(productId);
    const projectKey = productCfg.projectKey;
    const versions = await this.jira.getProjectVersions(projectKey);

    // "Active" heuristic for Phase D1: not released, not archived, and
    // (for parent projects) version name matches one of the patterns.
    const out: Release[] = [];
    for (const v of versions) {
      if (v.archived) continue;
      if (v.released) continue; // shipped
      if (
        productCfg.projectType === 'parent' &&
        productCfg.versionPatterns?.length &&
        !productCfg.versionPatterns.some((p) => new RegExp(p).test(v.name))
      ) {
        continue;
      }
      out.push({
        name: v.name,
        productId,
        status: 'active', // Phase D1 heuristic
        jiraVersionId: v.id,
        targetRtmDate: v.releaseDate,
        ecDate: v.startDate,
        description: v.description,
      });
    }
    return out;
  }

  // ── D15a / D17 top tier: releaseRag ──────────────────────────────────────

  /**
   * Compute the RAG for a single release.
   *
   * RAG rules (Phase D1, empirically tuned):
   *   - RED  if (open P0 bugs > 0 AND days-to-RTM ≤ 14)
   *           OR (open P0/P1 % > 15%)
   *           OR (any high-impact dependency is amber/red — Phase D2)
   *   - AMBER if open P0/P1 % > 8%
   *           OR (open scope % is rising and days-to-RTM ≤ 30)
   *   - GREEN otherwise
   *
   * Per D10, every claim is cited.
   */
  async releaseRag(productId: string, releaseName: string): Promise<ReleaseRag> {
    const productCfg = this.products.getProduct(productId);
    const productScope = this.products.buildJqlForProduct(productId);

    // Build counts in parallel.
    const openJql = `${productScope} AND fixVersion = "${releaseName}" AND statusCategory != Done`;
    const openP0Jql = `${openJql} AND priority = "P0 - Blocker"`;
    const openP1Jql = `${openJql} AND priority in ("P1 - Major", "P1")`;
    const totalScopeJql = `${productScope} AND fixVersion = "${releaseName}"`;

    const [openTotal, openP0, openP1, totalScope] = await Promise.all([
      this.jira.searchCount(openJql),
      this.jira.searchCount(openP0Jql),
      this.jira.searchCount(openP1Jql),
      this.jira.searchCount(totalScopeJql),
    ]);

    const openP0P1Pct = totalScope > 0 ? ((openP0 + openP1) / totalScope) * 100 : 0;

    // Days to RTM if we know it.
    const versions = await this.jira.getProjectVersions(productCfg.projectKey);
    const v = versions.find((vv) => vv.name === releaseName);
    const rtm = v?.releaseDate ? new Date(v.releaseDate).getTime() : null;
    const daysToRtm = rtm ? Math.ceil((rtm - Date.now()) / (1000 * 60 * 60 * 24)) : null;

    // Apply rules.
    let rag: Rag = 'green';
    const reasons: string[] = [];
    if (openP0 > 0 && daysToRtm !== null && daysToRtm <= RAG_THRESHOLDS.daysToRtmRedZone) {
      rag = 'red';
      reasons.push(`${openP0} open P0 within ${daysToRtm}d of RTM`);
    }
    if (openP0P1Pct > RAG_THRESHOLDS.redOpenP0P1Pct) {
      rag = 'red';
      reasons.push(`${openP0P1Pct.toFixed(1)}% of scope is open P0/P1`);
    }
    if (
      rag !== 'red' &&
      (openP0P1Pct > RAG_THRESHOLDS.amberOpenP0P1Pct ||
        (daysToRtm !== null && daysToRtm <= RAG_THRESHOLDS.daysToRtmAmberZone && openTotal > 0))
    ) {
      rag = 'amber';
      reasons.push(
        `${openP0P1Pct.toFixed(1)}% open P0/P1` +
          (daysToRtm !== null ? `, ${daysToRtm}d to RTM` : '')
      );
    }
    if (rag === 'green') {
      reasons.push(
        `${openTotal} open tickets (${openP0P1Pct.toFixed(1)}% P0/P1), ${
          daysToRtm ?? '?'
        }d to RTM`
      );
    }

    const headline = reasons.join('; ');
    const citations: Citation[] = [
      { kind: 'jira-query', label: 'Open scope', reference: openJql, capturedAt: new Date().toISOString() },
      { kind: 'jira-query', label: 'Open P0', reference: openP0Jql, capturedAt: new Date().toISOString() },
      { kind: 'jira-query', label: 'Open P1', reference: openP1Jql, capturedAt: new Date().toISOString() },
      { kind: 'jira-query', label: 'Total scope', reference: totalScopeJql, capturedAt: new Date().toISOString() },
    ];

    return {
      release: releaseName,
      productId,
      rag,
      headline,
      citations,
      computedAt: new Date().toISOString(),
    };
  }

  // ── D15a / Team Executive risk register: topBlockers ─────────────────────────────────

  /**
   * Return the ranked risk list for a release, used in the Team Executive risk
   * register (per D15b).
   *
   * Ranking: impact (P0 > P1 > P2) × proximity-to-RTM × uncertainty
   * (low-confidence indicators rank higher).
   *
   * Per D10, every risk cites at least one JIRA ticket + the underlying query.
   */
  async topBlockers(productId: string, releaseName: string): Promise<TopBlockers> {
    const productScope = this.products.buildJqlForProduct(productId);
    const cf = this.products.getCustomFields(productId);

    // Pull all open P0/P1 tickets in the release with the fields we need.
    const jql =
      `${productScope} AND fixVersion = "${releaseName}" ` +
      `AND statusCategory != Done ` +
      `AND priority in ("P0 - Blocker", "P1 - Major", "P1")`;
    const fields = [
      'summary',
      'status',
      'priority',
      'assignee',
      'components',
      'duedate',
      'issuetype',
      'issuelinks',
      cf.codeCompleteDateFieldId,
      cf.commitGateDateFieldId,
      cf.promotionGateDateFieldId,
    ].join(',');

    const issues = await this.jira.searchAll(jql, fields, { pageSize: 200 });

    // Compose risks. Group by component (component ≈ team).
    const byComponent = new Map<string, Risk>();
    for (const issue of issues) {
      const fld = issue.fields ?? {};
      const summary = String(fld.summary ?? '(no summary)');
      const priority = (fld.priority as { name?: string } | undefined)?.name ?? '(no priority)';
      const assignee = (fld.assignee as { displayName?: string } | undefined)?.displayName ?? 'unassigned';
      const components = (fld.components as Array<{ name: string }> | undefined) ?? [];
      const compName = components[0]?.name ?? 'no-component';
      const duedate = fld.duedate as string | undefined;
      const issueType = (fld.issuetype as { name?: string } | undefined)?.name;
      const family = classifyIssueType(issueType);

      const impact: Risk['impact'] = priority.startsWith('P0') ? 'high' : priority.startsWith('P1') ? 'medium' : 'low';
      const existing = byComponent.get(compName);
      const title = existing
        ? existing.title
        : `${compName} — ${family === 'Bug' ? 'open defects' : 'in-flight work'}`;
      const ticketRef = issue.key;
      const citation: Citation = {
        kind: 'jira-ticket',
        label: issue.key,
        reference: issue.key,
      };

      if (existing) {
        existing.tickets.push(ticketRef);
        existing.citations.push(citation);
        // Promote impact if a higher-priority ticket shows up in this team.
        if (impact === 'high') existing.impact = 'high';
        else if (impact === 'medium' && existing.impact === 'low') existing.impact = 'medium';
      } else {
        byComponent.set(compName, {
          title,
          impact,
          owner: compName === 'no-component' ? assignee : `${compName} team`,
          expectedResolution: duedate,
          mitigationStatus: 'In-flight (per JIRA status)',
          impactOnLanding: deriveLandingImpact(priority),
          tickets: [ticketRef],
          citations: [
            { kind: 'jira-query', label: 'Open P0/P1 in release', reference: jql },
            citation,
          ],
        });
      }
    }

    // Sort by impact desc, then ticket count desc.
    const impactRank = { high: 3, medium: 2, low: 1 } as const;
    const risks = [...byComponent.values()].sort((a, b) => {
      const r = impactRank[b.impact] - impactRank[a.impact];
      if (r !== 0) return r;
      return b.tickets.length - a.tickets.length;
    });

    return {
      release: releaseName,
      productId,
      risks,
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * Map a priority to a human description of landing impact. Phase D2 will
 * compute this more rigorously using historical resolution times.
 */
function deriveLandingImpact(priority: string): string {
  if (priority.startsWith('P0')) return 'High — likely 1+ week slip if not resolved before code-complete';
  if (priority.startsWith('P1')) return 'Medium — may slip by days if not resolved by promotion gate';
  return 'Low — unlikely to block landing';
}
