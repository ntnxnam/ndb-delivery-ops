/**
 * Release briefing aggregation — shared SoT (Wave 3 / D41).
 *
 * Pure. Fetch / JQL stay in the app service. This file classifies features,
 * builds compact LLM records, and assembles the intelligence package + health.
 */

import {
  computeReleaseHealthVerdict,
  countSelfReportedRisk,
} from './riskIndicator.js';
import type { ReleaseHealthResult } from './riskIndicator.js';

export const PHASE_ORDER: Record<string, number> = {
  Inception: 0,
  Design: 1,
  Coding: 2,
  'Coding (late)': 2,
  'CC Met': 3,
  'CG Met': 4,
  'PG Met': 5,
  Shipped: 6,
};

export type FeatureBucket =
  | 'clear'
  | 'gate-lagging'
  | 'compliance'
  | 'blocked'
  | 'dark'
  | 'watching';

export interface FeatureSignals {
  phase?: string;
  phaseRationale?: string;
  latestPassedMarker?: string | null;
  criticalRisks?: string[];
  nextGate?: unknown;
  statusUpdate?: { ageDays?: number | null } | null;
  compliance?: {
    security?: { filed?: boolean };
    legal?: { filed?: boolean };
  } | null;
  dates?: {
    codeComplete?: { effectiveValue?: string | null };
    commitGate?: { value?: string | null; overshootMarker?: string | number | null };
    promotionGate?: { value?: string | null; overshootMarket?: string | number | null };
  } | null;
}

export interface FeatureRecord {
  key: string;
  summary: string;
  status: string;
  jiraRisk: string;
  phase: string;
  phaseRationale?: string;
  latestPassedMarker?: string | null;
  criticalRisks: string[];
  nextGate?: unknown;
  assignee: string;
  tpmOwner: string | null;
  statusUpdateAgeDays: number | null;
  compliance?: FeatureSignals['compliance'];
  dates: {
    codeComplete: string | null;
    commitGate: string | null;
    promotionGate: string | null;
  };
  buckets: FeatureBucket[];
  error?: string;
}

export interface TicketLite {
  key: string;
  summary: string;
  assignee: string;
  status: string;
  priority?: string;
  issueType?: string;
}

export interface ReleaseIntelligence {
  version: string;
  totalFeatures: number;
  p0BugsCount: number;
  p0Bugs: TicketLite[];
  mustFixTickets: TicketLite[];
  phaseDist: Record<string, number>;
  selfReportedRisk: Record<'red' | 'yellow' | 'green' | 'notSet', number>;
  dateMetrics: { daysFromCutoff?: number | null } | null;
  buckets: Record<FeatureBucket, FeatureRecord[]>;
  health: ReleaseHealthResult;
  generatedAt: string;
}

/**
 * Classify a single feature's signals into one or more bucket labels.
 * A feature may appear in multiple buckets (e.g. gate-lagging AND dark).
 */
export function classifyFeature(signals: FeatureSignals): FeatureBucket[] {
  const buckets = new Set<FeatureBucket>();
  const s = signals;

  if (s.phase === 'Shipped' || s.phase === 'PG Met') {
    buckets.add('clear');
    return [...buckets];
  }

  const hasMissedGate = (s.criticalRisks || []).some((r) => r.startsWith('MISSED GATE'));
  if (hasMissedGate) buckets.add('gate-lagging');

  const comp = s.compliance;
  if (comp) {
    const hasGap = !comp.security?.filed || !comp.legal?.filed;
    if (hasGap) buckets.add('compliance');
  }

  const hasBlocker = (s.criticalRisks || []).some(
    (r) => /P0|P1|blocker/i.test(r) && !r.startsWith('MISSED GATE')
  );
  if (hasBlocker) buckets.add('blocked');

  if (s.statusUpdate?.ageDays != null && s.statusUpdate.ageDays >= 14) {
    buckets.add('dark');
  }

  const cgOvershoot = s.dates?.commitGate?.overshootMarker;
  const pgOvershoot = s.dates?.promotionGate?.overshootMarket;
  const cgMet = ['CG Met', 'PG Met', 'Shipped'].includes(s.phase || '');
  const pgMet = ['PG Met', 'Shipped'].includes(s.phase || '');
  if (cgOvershoot && parseInt(String(cgOvershoot), 10) > 0 && !cgMet) {
    buckets.add('gate-lagging');
  }
  if (pgOvershoot && parseInt(String(pgOvershoot), 10) > 0 && !pgMet) {
    buckets.add('gate-lagging');
  }

  if (buckets.size === 0) buckets.add('watching');
  return [...buckets];
}

/**
 * Compact feature record for LLM consumption.
 * Field IDs are grandfathered from the app service — do not add new literals.
 */
export function buildFeatureRecord(
  item: { key: string; fields?: Record<string, unknown> },
  signals: FeatureSignals
): FeatureRecord {
  const f = item.fields || {};
  const riskRaw = f.customfield_23560;
  const riskVal = riskRaw
    ? typeof riskRaw === 'object' && riskRaw !== null
      ? String(
          (riskRaw as { value?: string; name?: string }).value ||
            (riskRaw as { value?: string; name?: string }).name ||
            ''
        )
      : String(riskRaw)
    : 'not set';

  const tpm = f.customfield_27764 as { displayName?: string; name?: string } | undefined;
  const assignee = f.assignee as { displayName?: string; name?: string } | undefined;
  const status = f.status as { name?: string } | undefined;

  return {
    key: item.key,
    summary: String(f.summary || '').slice(0, 80),
    status: status?.name || 'Unknown',
    jiraRisk: riskVal,
    phase: signals.phase || 'Unknown',
    phaseRationale: signals.phaseRationale,
    latestPassedMarker: signals.latestPassedMarker,
    criticalRisks: signals.criticalRisks || [],
    nextGate: signals.nextGate,
    assignee: assignee?.displayName || assignee?.name || 'Unassigned',
    tpmOwner: tpm?.displayName || tpm?.name || null,
    statusUpdateAgeDays: signals.statusUpdate?.ageDays ?? null,
    compliance: signals.compliance,
    dates: {
      codeComplete: signals.dates?.codeComplete?.effectiveValue || null,
      commitGate: signals.dates?.commitGate?.value || null,
      promotionGate: signals.dates?.promotionGate?.value || null,
    },
    buckets: classifyFeature(signals),
  };
}

export function assembleReleaseIntelligence(input: {
  version: string;
  featureRecords: FeatureRecord[];
  p0Bugs: TicketLite[];
  mustFixTickets: TicketLite[];
  dateMetrics: { daysFromCutoff?: number | null } | null;
  generatedAt?: string;
}): ReleaseIntelligence {
  const buckets: Record<FeatureBucket, FeatureRecord[]> = {
    'gate-lagging': [],
    compliance: [],
    blocked: [],
    dark: [],
    watching: [],
    clear: [],
  };
  for (const rec of input.featureRecords) {
    for (const b of rec.buckets) {
      buckets[b].push(rec);
    }
  }

  const phaseDist: Record<string, number> = {};
  for (const rec of input.featureRecords) {
    phaseDist[rec.phase] = (phaseDist[rec.phase] || 0) + 1;
  }

  const selfReportedRisk = countSelfReportedRisk(input.featureRecords.map((rec) => rec.jiraRisk));
  const health = computeReleaseHealthVerdict({
    openP0Blockers: input.p0Bugs.length,
    openMustFixTickets: input.mustFixTickets.length,
    daysToPg: input.dateMetrics?.daysFromCutoff ?? null,
    gateLaggingCount: buckets['gate-lagging']?.length ?? 0,
    darkCount: buckets.dark?.length ?? 0,
    committedCount: input.featureRecords.length,
    complianceAtRiskCount: buckets.compliance?.length ?? 0,
  });

  return {
    version: input.version,
    totalFeatures: input.featureRecords.length,
    p0BugsCount: input.p0Bugs.length,
    p0Bugs: input.p0Bugs,
    mustFixTickets: input.mustFixTickets,
    phaseDist,
    selfReportedRisk,
    dateMetrics: input.dateMetrics,
    buckets,
    health,
    generatedAt: input.generatedAt || new Date().toISOString(),
  };
}
