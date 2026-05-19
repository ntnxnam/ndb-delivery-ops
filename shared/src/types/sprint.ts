/**
 * Sprint types.
 */

export type SprintState = 'future' | 'active' | 'closed';

export interface Sprint {
  id: number;
  name: string;
  state: SprintState;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  boardId?: number;
  goal?: string;
}

/**
 * Per-team weekly delta — output of statusService.teamWeeklyDelta.
 * Used in D17 weekly status email (middle tier).
 */
export interface TeamWeeklyDelta {
  teamId: string;
  teamName: string;
  /** Tickets shipped (transitioned to Done) since the week boundary */
  shipped: Array<{ key: string; summary: string; storyPoints?: number }>;
  /** Tickets at risk — open, with date slip or RAG amber/red */
  atRisk: Array<{ key: string; summary: string; reason: string }>;
  /** Tickets blocked by another team */
  blocked: Array<{ key: string; summary: string; blockedBy: string[] }>;
  /** Commits via githubConnector (Phase D2+) */
  commitCount?: number;
  /** Citation reference for the underlying query */
  jql: string;
  capturedAt: string;
}

/**
 * Standout FEAT callout for D17 weekly status (bottom tier).
 */
export interface FeatCallout {
  featKey: string;
  featTitle: string;
  /** What changed this week */
  change:
    | { kind: 'rag-transition'; from: string; to: string }
    | { kind: 'gate-hit'; gate: string }
    | { kind: 'date-slipped'; field: string; slipDays: number }
    | { kind: 'scope-change'; deltaPoints: number };
  /** One-paragraph human-readable summary */
  narrative: string;
  /** Supporting tickets */
  tickets: string[];
  capturedAt: string;
}
