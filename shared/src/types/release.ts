/**
 * Release types.
 *
 * Per D13, releases have an explicit status field set by the Portfolio
 * Manager. Services that resolve "active releases" read this status.
 */

export type ReleaseStatus = 'planning' | 'active' | 'shipped' | 'archived';

export type Rag = 'green' | 'amber' | 'red';

export interface Release {
  /** Release identifier matching the JIRA `fixVersion` exactly */
  name: string;
  /** Product this release belongs to (per D1) */
  productId: string;
  /** Lifecycle status — set explicitly by the Portfolio Manager (D13) */
  status: ReleaseStatus;
  /** Target RTM date if scheduled */
  targetRtmDate?: string; // ISO YYYY-MM-DD
  /** Early Commitment date — used as start-date fallback per jira-date-hierarchy.mdc */
  ecDate?: string;
  /** Commit Gate Ready estimated date */
  commitGateDate?: string;
  /** Promotion Gate Ready estimated date */
  promotionGateDate?: string;
  /** Code Complete date */
  codeCompleteDate?: string;
  /** JIRA version ID (if needed for API operations) */
  jiraVersionId?: string;
  /** Human description (visible in JIRA version detail) */
  description?: string;
}

/**
 * Computed RAG with the reason — used in every status rollup.
 *
 * Per `citation-first-output.mdc` (D10), every RAG decision must cite the
 * data that drove it.
 */
export interface ReleaseRag {
  release: string;
  productId: string;
  rag: Rag;
  /** One-line "why" — feeds the headline in Team Executive audience output */
  headline: string;
  /** Citations supporting the RAG decision */
  citations: Citation[];
  /** Timestamp when this RAG was computed (cache invalidation key) */
  computedAt: string; // ISO 8601
}

export interface Citation {
  kind: 'jira-ticket' | 'jira-query' | 'data-source' | 'snapshot' | 'confluence-page' | 'slack-thread';
  /** Display label (e.g. ticket key, or query summary) */
  label: string;
  /** Resolvable URL or query string */
  reference: string;
  /** Optional timestamp (for data-source citations) */
  capturedAt?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Landing-date prediction — output of predictabilityService.predictLanding.
 *
 * Per D15 (Team Executive protocol), this is half of the compound answer.
 */
export interface LandingPrediction {
  release: string;
  productId: string;
  predictedDate: string; // ISO YYYY-MM-DD
  confidence: Confidence;
  /** Confidence interval: [earliest, latest] */
  confidenceBand?: [string, string];
  citations: Citation[];
  /** Underlying inputs (open ticket count, velocity, etc.) for transparency */
  inputs?: {
    openTickets: number;
    avgVelocity?: number;
    historicalPredictability?: number;
  };
  computedAt: string;
}

/**
 * Risk register entry — D15's required output shape for Team Executive audience.
 *
 * Per D15b, the answer is NOT compressed bullets — it's a register format
 * with each entry containing what / owner / ETA / mitigation / impact.
 */
export interface Risk {
  title: string;
  impact: 'high' | 'medium' | 'low';
  /** Owning team or person */
  owner: string;
  /** Expected resolution date if known */
  expectedResolution?: string;
  /** Free-form status text */
  mitigationStatus: string;
  /** Impact on landing date — e.g. "+1 week if not resolved by Wednesday" */
  impactOnLanding: string;
  /** Tickets that constitute this risk */
  tickets: string[];
  citations: Citation[];
}

/**
 * Top-blockers output — the second half of the Team Executive compound answer (D15a).
 */
export interface TopBlockers {
  release: string;
  productId: string;
  risks: Risk[];
  computedAt: string;
}

/**
 * Gate progression — used by rm-specialist (D20).
 */
export interface GateProgression {
  release: string;
  productId: string;
  gates: Array<{
    name: 'EC' | 'CodeComplete' | 'CommitGate' | 'PromotionGate' | 'RTM';
    state: 'achieved' | 'partial' | 'pending' | 'missed';
    achievedDate?: string;
    targetDate?: string;
    detail?: string;
    citations: Citation[];
  }>;
}
