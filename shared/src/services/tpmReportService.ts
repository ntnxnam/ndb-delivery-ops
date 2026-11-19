/**
 * tpm-report — compose report from 1-4 phase fetches per mode.
 * Binds to tpm-contracts, fan-out + stitch. Only this service sends via emailConnector.
 * D1 product-agnostic, D10 citation-first, D26 auth, D30 gate audit.
 */
import type { TpmScope, TpmFetchResult, TpmReportMode } from '../types/tpm.js';
import { TPM_PHASE_SKILLS } from '../types/tpm.js';

export type PhaseFetcher = (skill: string, input: { scope: TpmScope; jqlExtra?: string | null }) => Promise<TpmFetchResult>;

export const MODE_SCOPE_KIND: Record<TpmReportMode, TpmScope['kind']> = {
  'my-focus': 'me',
  release: 'release',
  digest: 'team',
  rollup: 'org',
};

export type TpmReport = {
  mode: TpmReportMode;
  scope: TpmScope;
  sections: { phase: string; result: TpmFetchResult }[];
  gateDeadlines?: { label: string; date: string }[];
  deferralSummary?: { deferred: number; pending: number };
  totals: { total: number; open: number; done: number };
  links: { jiraSearchUrl: string; combinedJql: string }[];
  cited: { jql: string; ts: string }[];
  emailPreview?: { to: string[]; cc: string[]; subject: string; html: string };
  warnings?: string[];
};

export type TpmReportInput = {
  mode: TpmReportMode;
  scope: TpmScope;
  jqlExtra?: string | null;
  fetcher: PhaseFetcher;
  gateDeadlinesProvider?: () => { label: string; date: string }[];
  // Deferral inputs
  promotionGateDate?: string | null; // ISO date of live release PG
  deferredTickets?: { key: string; movedAt: string }[];
  pendingDeferrals?: { key: string }[];
  // Email
  sendEmail?: (opts: { to: string[]; cc: string[]; subject: string; html: string }) => Promise<void>;
  recipients?: { to: string[]; cc: string[] };
  isAuthorized?: (recipients: string[]) => boolean;
  previewOnly?: boolean;
};

function validateModeScope(mode: TpmReportMode, scope: TpmScope): string | null {
  const expected = MODE_SCOPE_KIND[mode];
  if (scope.kind !== expected) {
    return `Mode ${mode} requires scope kind ${expected}, got ${scope.kind}`;
  }
  return null;
}

export function needsDeferralTag(movedAt: string, promotionGateDate: string | null): boolean {
  if (!promotionGateDate) return false;
  // Only tickets moved AFTER PG need deferral tag
  return new Date(movedAt).getTime() > new Date(promotionGateDate).getTime();
}

export function buildDeferralSummary(
  deferredTickets: { key: string; movedAt: string }[] | undefined,
  pendingDeferrals: { key: string }[] | undefined,
  promotionGateDate: string | null | undefined,
): { deferred: number; pending: number } {
  const deferred = (deferredTickets || []).filter((t) => needsDeferralTag(t.movedAt, promotionGateDate ?? null)).length;
  const pending = (pendingDeferrals || []).length;
  return { deferred, pending };
}

export async function composeReport(input: TpmReportInput): Promise<TpmReport> {
  const scopeErr = validateModeScope(input.mode, input.scope);
  if (scopeErr) throw new Error(scopeErr);

  const sections = await Promise.all(
    TPM_PHASE_SKILLS.map(async (phase) => ({
      phase,
      result: await input.fetcher(phase, { scope: input.scope, jqlExtra: input.jqlExtra ?? null }),
    })),
  );

  // Aggregate totals
  const totals = sections.reduce(
    (acc, s) => ({ total: acc.total + s.result.totals.total, open: acc.open + s.result.totals.open, done: acc.done + s.result.totals.done }),
    { total: 0, open: 0, done: 0 },
  );
  const links = sections.map((s) => s.result.links);
  const cited = sections.flatMap((s) => s.result.cited);

  // Gate deadlines for digest (next 7d)
  let gateDeadlines: { label: string; date: string }[] | undefined;
  if (input.mode === 'digest' && input.gateDeadlinesProvider) {
    const all = input.gateDeadlinesProvider();
    const now = Date.now();
    const weekMs = 7 * 24 * 3600 * 1000;
    gateDeadlines = all.filter((g) => {
      const t = new Date(g.date).getTime();
      return t >= now && t <= now + weekMs;
    });
  }

  const deferralSummary = buildDeferralSummary(input.deferredTickets, input.pendingDeferrals, input.promotionGateDate);

  let emailPreview: TpmReport['emailPreview'] | undefined;
  if (input.recipients && input.sendEmail) {
    if (input.isAuthorized && !input.isAuthorized([...input.recipients.to, ...input.recipients.cc])) {
      throw new Error('D26: recipients not authorized');
    }
    const subject = `TPM ${input.mode} report — ${JSON.stringify(input.scope)}`;
    const html = `<h2>TPM ${input.mode}</h2><p>Total: ${totals.total} open: ${totals.open}</p>`;
    emailPreview = { to: input.recipients.to, cc: input.recipients.cc, subject, html };
    if (!input.previewOnly) {
      await input.sendEmail(emailPreview);
    }
  }

  return { mode: input.mode, scope: input.scope, sections, gateDeadlines, deferralSummary, totals, links, cited, emailPreview };
}
