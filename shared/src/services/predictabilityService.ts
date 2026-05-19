/**
 * predictabilityService — landing predictions, say-vs-do.
 *
 * Phase D1 ships a stub returning a heuristic prediction with `low`
 * confidence so the VP path runs end-to-end without crashing. Phase D2
 * replaces it with the real historical-velocity-based predictor (existing
 * code lives in `apps/delivery-ops/server/services/releaseAnalysisService.js`
 * and the `crystalball-i/` package).
 *
 * Cross-references:
 *   - DECISIONS.md → D15 (VP protocol uses predictLanding)
 *   - .cursor/skills/vp-status-answer/SKILL.md
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { ProductService } from './productService.js';
import type { StatusService } from './statusService.js';
import type {
  LandingPrediction,
  Citation,
} from '../types/release.js';

export interface PredictabilityServiceOptions {
  jira: JiraConnector;
  products: ProductService;
  status: StatusService;
}

export class PredictabilityService {
  // Reserved for Phase D2 — full velocity-based predictor will use these.
  // private jira: JiraConnector;
  // private products: ProductService;
  private status: StatusService;

  constructor(opts: PredictabilityServiceOptions) {
    // this.jira = opts.jira;
    // this.products = opts.products;
    this.status = opts.status;
  }

  /**
   * Phase D1 implementation: best-effort landing prediction.
   *
   * Algorithm:
   *   1. Read the active release's targetRtmDate from JIRA (if set)
   *   2. Compute open scope count via statusService
   *   3. Adjust target date by a fixed "open-scope nudge" with low confidence
   *
   * Phase D2 will replace with real velocity-based forecasting (existing
   * CrystalBall-I code).
   */
  async predictLanding(productId: string, releaseName: string): Promise<LandingPrediction> {
    const activeReleases = await this.status.getActiveReleases(productId);
    const release = activeReleases.find((r) => r.name === releaseName);
    const baseDate = release?.targetRtmDate
      ? new Date(release.targetRtmDate)
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // +60d default
    const predictedDate = baseDate.toISOString().split('T')[0]!;
    const citations: Citation[] = [
      {
        kind: 'data-source',
        label: 'predictabilityService.predictLanding (Phase D1 stub)',
        reference: `release:${releaseName}, target_rtm:${release?.targetRtmDate ?? 'unset'}`,
        capturedAt: new Date().toISOString(),
      },
    ];
    return {
      release: releaseName,
      productId,
      predictedDate,
      confidence: 'low',
      citations,
      inputs: {
        openTickets: 0, // Phase D2 will populate from statusService
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Say-vs-Do predictability metric — % of committed sprint work
   * actually delivered, averaged over N recent sprints.
   *
   * Phase D2: implement using sprintService once it exists.
   */
  async sayVsDo(
    _productId: string,
    _releaseName: string,
    _options: { sprints?: number } = {}
  ): Promise<{ percent: number; confidence: 'high' | 'medium' | 'low'; citations: Citation[] }> {
    // Phase D2 stub.
    return {
      percent: 0,
      confidence: 'low',
      citations: [
        {
          kind: 'data-source',
          label: 'predictabilityService.sayVsDo (Phase D2 stub)',
          reference: 'not-implemented',
        },
      ],
    };
  }
}
