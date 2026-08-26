/**
 * Shared risk + release-health primitives.
 *
 * One implementation for web AI briefing, MCP tools, and any future host.
 * Do not re-derive RAG from prompt text.
 */

export type RiskBucket = 'red' | 'yellow' | 'green' | 'not_set';

export type ReleaseHealthVerdict = 'RED' | 'YELLOW' | 'GREEN';

export interface ReleaseHealthInput {
  openP0Blockers: number;
  openMustFixTickets: number;
  daysToPg: number | null;
  gateLaggingCount: number;
  darkCount: number;
  committedCount: number;
  complianceAtRiskCount: number;
}

export interface ReleaseHealthResult {
  verdict: ReleaseHealthVerdict;
  reason: string;
  rule: 1 | 2 | 3 | 4 | 5 | 6;
}

const MUSTFIX_RED_DAYS_TO_PG = 14;

/** Pull a display string out of a JIRA select / string / object field. */
export function extractRiskText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const obj = raw as { value?: string; name?: string };
    return String(obj.value ?? obj.name ?? '');
  }
  return String(raw);
}

/**
 * Map a JIRA Risk Indicator (or similar) to a four-bucket label.
 * Used for self-reported team color — secondary to computeReleaseHealthVerdict.
 */
export function classifyRiskIndicator(raw: unknown): RiskBucket {
  const v = extractRiskText(raw).toLowerCase().trim();
  if (!v) return 'not_set';
  if (v.includes('red') || v.includes('critical') || v.includes('high') || v.includes('big risk')) {
    return 'red';
  }
  if (
    v.includes('yellow') ||
    v.includes('amber') ||
    v.includes('moderate') ||
    v.includes('medium') ||
    v.includes('at risk')
  ) {
    return 'yellow';
  }
  if (v.includes('green') || v.includes('on track') || v.includes('low')) {
    return 'green';
  }
  return 'not_set';
}

export function countSelfReportedRisk(
  values: unknown[]
): Record<'red' | 'yellow' | 'green' | 'notSet', number> {
  const counts = { red: 0, yellow: 0, green: 0, notSet: 0 };
  for (const value of values) {
    const bucket = classifyRiskIndicator(value);
    if (bucket === 'not_set') counts.notSet += 1;
    else counts[bucket] += 1;
  }
  return counts;
}

/**
 * Constitutional release-health table (ai-ticket-key-integrity / briefing).
 * First match wins. GREEN only when every blocker class is clean.
 */
export function computeReleaseHealthVerdict(input: ReleaseHealthInput): ReleaseHealthResult {
  const darkPct =
    input.committedCount > 0 ? (input.darkCount / input.committedCount) * 100 : 0;
  const daysToPg = input.daysToPg;

  if (input.openP0Blockers > 0) {
    return {
      verdict: 'RED',
      rule: 1,
      reason: `${input.openP0Blockers} open P0 blocker(s)`,
    };
  }
  if (input.openMustFixTickets > 0 && daysToPg !== null && daysToPg <= MUSTFIX_RED_DAYS_TO_PG) {
    return {
      verdict: 'RED',
      rule: 2,
      reason: `${input.openMustFixTickets} open must-fix ticket(s) and ${daysToPg}d to PG`,
    };
  }
  if (input.gateLaggingCount > 2) {
    return {
      verdict: 'RED',
      rule: 3,
      reason: `${input.gateLaggingCount} gate-lagging features`,
    };
  }
  if (input.openMustFixTickets > 0) {
    return {
      verdict: 'YELLOW',
      rule: 4,
      reason: `${input.openMustFixTickets} open must-fix ticket(s)`,
    };
  }
  if (
    input.gateLaggingCount >= 1 ||
    darkPct > 20 ||
    input.complianceAtRiskCount > 0
  ) {
    const parts = [];
    if (input.gateLaggingCount >= 1) parts.push(`${input.gateLaggingCount} gate-lagging`);
    if (darkPct > 20) parts.push(`dark ${darkPct.toFixed(0)}%`);
    if (input.complianceAtRiskCount > 0) {
      parts.push(`${input.complianceAtRiskCount} compliance-at-risk`);
    }
    return {
      verdict: 'YELLOW',
      rule: 5,
      reason: parts.join('; '),
    };
  }
  return {
    verdict: 'GREEN',
    rule: 6,
    reason: 'No open P0s, must-fix, gate-lag, dark>20%, or compliance-at-risk',
  };
}

export function bucketCounts<T>(
  buckets: Record<string, T[] | undefined>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(buckets).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
  );
}
