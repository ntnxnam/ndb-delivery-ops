/**
 * useSosTierSummary — per-release SoS team-exec boxes.
 *
 * Loads /api/release-dataset/project-status (bundle), builds a tiny packet
 * (RAG + outstanding + top CRITICAL_ITEMS), then calls
 * POST /api/ai/sos-tier-summary sequentially per tier.
 */

import { useState, useCallback, useRef } from 'react';
import { authenticatedGet, authenticatedPost } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';

export const SOS_TIERS = ['feat', 'standalone', 'direct'];

const TIER_LABELS = {
  feat: 'FEAT Work',
  standalone: 'Standalone Epics',
  direct: 'Direct Tickets',
};

const RAG_RANK = { Red: 0, Yellow: 1, Green: 2, NotSet: 3 };

function sumOutstanding(outstandingByType) {
  return Object.values(outstandingByType || {}).reduce((s, n) => s + (Number(n) || 0), 0);
}

/** Tier has nothing to brief — do not call NAI (avoids fake GREEN "On track"). */
export function isTierEmpty(payload) {
  if (!payload) return true;
  const items = Number(payload.itemCount) || 0;
  const open = sumOutstanding(payload.outstandingByType);
  const critical = (payload.criticalItems || []).length;
  return items === 0 && open === 0 && critical === 0;
}

export function emptyTierSummary(tier, release) {
  const label = TIER_LABELS[tier] || tier || 'Tier';
  return `## ${label} — ${release}\n\nNo items in this tier for this release.`;
}

const STALE_STATUS_DAYS = 14;
const RECENT_MOVE_DAYS = 7;

const DATE_MOVE_LABELS = {
  fsdsDone: 'FS/DS Done Date',
  codeComplete: 'Code Complete Date',
  commitGate: 'Commit Gate Date',
  promotionGate: 'Promotion Gate Date',
  testPlan: 'Test Plan Date',
  statusUpdateDate: 'Status Update Date',
};

/** Map release gate kind → expected JIRA clearance (generic — not CG-only). */
const GATE_CLEARANCE = {
  CCM: { expectedPhase: 'CC Met', statusName: 'Code Complete Met', phaseRank: 3 },
  CC: { expectedPhase: 'CC Met', statusName: 'Code Complete Met', phaseRank: 3 },
  CG: { expectedPhase: 'CG Met', statusName: 'Commit Gate Met', phaseRank: 4 },
  PG: { expectedPhase: 'PG Met', statusName: 'Promotion Gate Met', phaseRank: 5 },
  GA: { expectedPhase: 'Shipped', statusName: 'Closed', phaseRank: 6 },
};

/**
 * Gate → the ticket date field that must land BEFORE that gate closes.
 *
 * Think of each gate as a toll booth with a cutoff date (release calendar).
 * A ticket "misses" the gate if its own date for the prerequisite milestone
 * is scheduled AFTER the gate's cutoff — e.g. ticket says CC will be Dec 20
 * but CG closes Dec 15 → that ticket cannot clear CG in time.
 *
 * For FEAT / X-FEAT / Initiative items (top-level portfolio items), the gate
 * readiness dates are the gate estimation fields themselves:
 *   CG gate  → customfield_35863  (Commit Gate Ready Estimation Date)
 *   PG gate  → customfield_35864  (Promotion Gate Ready Estimation Date)
 *
 * For lower-level items (Epic, Story, Task, Bug…):
 *   CCM / CC gate → ticket's Code Complete date (customfield_11067)
 *   CG gate       → ticket's Code Complete date (customfield_11067)
 *   PG gate       → ticket's Commit Gate Ready date (customfield_35863)
 *   GA gate       → ticket's Promotion Gate Ready date (customfield_35864)
 */
const PORTFOLIO_ISSUE_TYPES = new Set(['feature', 'initiative', 'x-feat', 'capability']);

function isPortfolioItem(item) {
  const t = (item?.issuetype || item?.issueType || '').toLowerCase();
  return PORTFOLIO_ISSUE_TYPES.has(t);
}

const GATE_PREREQUISITE_FIELD = {
  CCM: 'customfield_11067',
  CC:  'customfield_11067',
  CG:  'customfield_11067',  // Code Complete must land before CG closes (non-portfolio)
  PG:  'customfield_35863',  // Commit Gate Ready must land before PG closes
  GA:  'customfield_35864',  // Promotion Gate Ready must land before GA closes
};

// Portfolio items (Feature/Initiative/X-FEAT) use their own gate estimation dates.
const GATE_PREREQUISITE_FIELD_PORTFOLIO = {
  CCM: 'customfield_11067',
  CC:  'customfield_11067',
  CG:  'customfield_35863',  // Commit Gate Ready Estimation Date
  PG:  'customfield_35864',  // Promotion Gate Ready Estimation Date
  GA:  'customfield_35864',
};

export function classifyRiskWord(riskIndicator) {
  const raw = typeof riskIndicator === 'string'
    ? riskIndicator
    : (riskIndicator?.value || '');
  const v = String(raw).split(' ')[0];
  if (v === 'Red' || v === 'Yellow' || v === 'Green') return v;
  return 'NotSet';
}

function daysSinceIso(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function normalizeGateKind(kind) {
  const k = String(kind || '').toUpperCase();
  if (k === 'CC' || k === 'CCM') return 'CCM';
  if (k === 'CG' || k === 'PG' || k === 'GA' || k === 'EC') return k;
  return k;
}

function statusPhaseRank(status) {
  const s = String(status || '').toLowerCase();
  if (!s) return 0;
  if (s.includes('closed') || s === 'resolved' || s === 'done') return 6;
  if (s.includes('promotion gate met')) return 5;
  if (s.includes('commit gate met')) return 4;
  if (s.includes('code complete met')) return 3;
  return 1;
}

/**
 * Past = most recently elapsed clearance gate; next = soonest upcoming.
 * Driven by this release's gate calendar (CCM → CG → PG → GA).
 */
export function resolveReleaseGateContext(gateData, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const byKind = {};
  for (const g of gateData?.gates || []) {
    if (!g?.iso) continue;
    const kind = normalizeGateKind(g.kind);
    if (!GATE_CLEARANCE[kind]) continue;
    const iso = String(g.iso).slice(0, 10);
    const ms = new Date(`${iso}T00:00:00Z`).getTime();
    if (Number.isNaN(ms)) continue;
    const prev = byKind[kind];
    if (!prev || ms >= prev.ms) {
      byKind[kind] = {
        kind,
        iso,
        ms,
        label: g.label || kind,
        past: ms <= todayMs,
        daysFromToday: Math.ceil((ms - todayMs) / 86400000),
        ...GATE_CLEARANCE[kind],
      };
    }
  }

  const pastGate = Object.values(byKind)
    .filter((g) => g.past)
    .sort((a, b) => b.ms - a.ms)[0] || null;
  const nextGate = Object.values(byKind)
    .filter((g) => !g.past)
    .sort((a, b) => a.ms - b.ms)[0] || null;

  return { pastGate, nextGate };
}

function itemDateIso(item, fieldId) {
  const raw = item?.[fieldId];
  if (!raw) return null;
  let iso = null;
  if (typeof raw === 'string') iso = raw.slice(0, 10);
  else if (raw.value) iso = String(raw.value).slice(0, 10);
  // Reject empty strings, "null", "undefined", or anything that isn't a
  // plausible ISO date (YYYY-MM-DD = 10 chars starting with a digit).
  if (!iso || iso.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso;
}

/**
 * Hygiene / movement / gate callouts. Counts always paired with key lists.
 *
 * @param {Array}  items             - ticket objects for this tier
 * @param {object} checkpointHistory - date-move history keyed by ticket key
 * @param {object} gateContext       - { pastGate, nextGate } from resolveReleaseGateContext
 * @param {object} [options]
 * @param {boolean} [options.skipGateDates=false]   - true for standalone/direct: skip
 *   pastGateLagging and datesPastNextGate (those tiers have no CG/PG date fields).
 * @param {boolean} [options.checkDoneByCg=false]   - true for standalone/direct: flag
 *   items whose status is not in the done-family relative to the CG date.
 * @param {string}  [options.cgDate]                - ISO CG date (YYYY-MM-DD), required
 *   when checkDoneByCg is true.
 */
export function buildTierCallouts(items, checkpointHistory = {}, gateContext = null, options = {}) {
  const { skipGateDates = false, checkDoneByCg = false, cgDate = null } = options;
  const list = items || [];
  // Statuses where risk indicator is irrelevant — ticket is definitively done/gone.
  // Source: .cursor/context/jira-workflows-and-resolutions.md §5
  // NOTE: 'resolved' excluded here because status=Resolved means TBV (awaiting QA),
  // not closed — but we still skip it for risk-not-set since dev work is complete.
  const RISK_NOT_SET_EXCLUDE_STATUSES = new Set([
    'closed', 'cancelled', 'done', 'promotion gate met', 'resolved',
  ]);
  const notSetKeys = list
    .filter((i) => {
      if (!i?.key) return false;
      if (RISK_NOT_SET_EXCLUDE_STATUSES.has((i.status || '').toLowerCase())) return false;
      return classifyRiskWord(i.customfield_23560) === 'NotSet';
    })
    .map((i) => i.key);

  const staleKeys = list
    .filter((i) => {
      if (!i?.key) return false;
      const days = daysSinceIso(i.customfield_45660);
      return days != null && days >= STALE_STATUS_DAYS;
    })
    .map((i) => i.key);

  const weekAgoMs = Date.now() - RECENT_MOVE_DAYS * 86400000;
  const movedByField = {};
  for (const i of list) {
    if (!i?.key) continue;
    const moves = checkpointHistory[i.key]?.dateMoves || [];
    for (const m of moves) {
      if (!m?.changedAt || !m.field) continue;
      const t = new Date(m.changedAt).getTime();
      if (Number.isNaN(t) || t < weekAgoMs) continue;
      if (!movedByField[m.field]) movedByField[m.field] = new Set();
      movedByField[m.field].add(i.key);
    }
  }

  const dateMovesLast7d = Object.entries(movedByField)
    .map(([field, keySet]) => ({
      field,
      label: DATE_MOVE_LABELS[field] || field,
      keys: [...keySet],
    }))
    .filter((row) => row.keys.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));

  // ── Gate checks: FEAT only ──────────────────────────────────────────────
  // Standalone Epics and Direct Tickets have no CG/PG date fields.
  // Skip phase-based gate checks for those tiers; use notDoneByCg instead.
  let pastGateLagging = { count: 0, keys: [], gate: null };
  let datesPastNextGate = { count: 0, keys: [], gate: null };

  if (!skipGateDates) {
    const pastGate = gateContext?.pastGate;
    if (pastGate && list.length) {
      const keys = list
        .filter((i) => i?.key && statusPhaseRank(i.status) < pastGate.phaseRank)
        .map((i) => i.key);
      pastGateLagging = {
        count: keys.length,
        keys,
        gate: {
          kind: pastGate.kind,
          label: pastGate.label,
          iso: pastGate.iso,
          expectedStatus: pastGate.statusName,
          expectedPhase: pastGate.expectedPhase,
          daysAgo: Math.abs(pastGate.daysFromToday),
        },
      };
    }

    const nextGate = gateContext?.nextGate;
    if (nextGate && list.length) {
      const gateIso = nextGate.iso;
      // Which ticket date field must land before this gate closes?
      // e.g. next gate = CG (cutoff Dec 15) → check ticket's CC date.
      // A ticket is flagged only when its prerequisite date is scheduled
      // AFTER the release gate cutoff (toll booth closes before they arrive).
      const prereqField = (i) =>
        (isPortfolioItem(i) ? GATE_PREREQUISITE_FIELD_PORTFOLIO : GATE_PREREQUISITE_FIELD)[nextGate.kind]
        || 'customfield_11067';
      const keys = list.filter((i) => {
        if (!i?.key) return false;
        const prereqDate = itemDateIso(i, prereqField(i));
        return !!prereqDate && prereqDate > gateIso;
      }).map((i) => i.key);
      datesPastNextGate = {
        count: keys.length,
        keys,
        gate: {
          kind: nextGate.kind,
          label: nextGate.label,
          iso: nextGate.iso,
          daysUntil: nextGate.daysFromToday,
          prereqField: `${GATE_PREREQUISITE_FIELD[nextGate.kind]} / portfolio: ${GATE_PREREQUISITE_FIELD_PORTFOLIO[nextGate.kind]}`,
        },
      };
    }
  }

  // ── Done-by-CG check: Standalone Epics + Direct Tickets ────────────────
  // The rule for these tiers is simple: every item must reach a done status
  // by the CG date. No gate date fields — just open-vs-closed vs CG deadline.
  const DONE_STATUSES = new Set(['fixed', 'done', 'resolved', 'complete', 'closed', 'cancelled']);
  let notDoneByCg = { count: 0, keys: [], gate: null };
  if (checkDoneByCg && cgDate && list.length) {
    const keys = list
      .filter((i) => i?.key && !DONE_STATUSES.has((i.status || '').toLowerCase()))
      .map((i) => i.key);
    notDoneByCg = {
      count: keys.length,
      keys,
      gate: { kind: 'CG', iso: cgDate, daysUntil: daysUntil(cgDate) },
    };
  }

  const pastGate = gateContext?.pastGate;
  const nextGate = gateContext?.nextGate;
  return {
    riskNotSet: { count: notSetKeys.length, keys: notSetKeys },
    staleStatusUpdates: { count: staleKeys.length, keys: staleKeys, thresholdDays: STALE_STATUS_DAYS },
    dateMovesLast7d,
    pastGateLagging,
    datesPastNextGate,
    notDoneByCg,
    gateContext: {
      pastGate: pastGate
        ? { kind: pastGate.kind, label: pastGate.label, iso: pastGate.iso, expectedStatus: pastGate.statusName }
        : null,
      nextGate: nextGate
        ? { kind: nextGate.kind, label: nextGate.label, iso: nextGate.iso, daysUntil: nextGate.daysFromToday }
        : null,
    },
  };
}

function ragCountsFromItems(items) {
  const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
  for (const i of items || []) {
    counts[classifyRiskWord(i?.customfield_23560)]++;
  }
  return counts;
}

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function gateIsoFromGateData(gateData, kinds) {
  if (!gateData?.gates?.length) return null;
  const want = new Set(kinds.map((k) => k.toUpperCase()));
  // Prefer the latest solid gate of the requested kind(s); dotted = superseded.
  // Fall back to the latest entry of any style when no solid one exists.
  const allMatching = gateData.gates.filter(
    (g) => want.has(String(g.kind || '').toUpperCase()) && g.iso,
  );
  const solidOnes = allMatching.filter((g) => g.style === 'solid');
  const hit = (solidOnes.length ? solidOnes : allMatching).at(-1);
  return hit?.iso ? String(hit.iso).slice(0, 10) : null;
}

function groupsToTotals(groups) {
  const totals = {};
  for (const g of groups || []) {
    if (!g?.label || g.label === 'Project Hierarchy') continue;
    const open = (g.outstanding || 0) + (g.toVerify || 0);
    if (open) totals[g.label] = (totals[g.label] || 0) + open;
  }
  return totals;
}

function sumOutstandingByType(groupsList) {
  const totals = {};
  for (const groups of groupsList) {
    for (const g of groups || []) {
      if (!g?.label || g.label === 'Project Hierarchy') continue;
      const open = (g.outstanding || 0) + (g.toVerify || 0);
      totals[g.label] = (totals[g.label] || 0) + open;
    }
  }
  return totals;
}

/** One-line TLDR from on-screen exec summary (customfield_38460). */
function extractTldrLine(execSummary) {
  if (!execSummary || typeof execSummary !== 'string') return '';
  const tldr = execSummary.match(/TLDR:\s*(.+)/i);
  if (tldr) return tldr[1].replace(/^[🔴🟡🟢]\s*/, '').trim().slice(0, 120);
  return execSummary.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Top Red/Yellow features with key + RAG + one-line TLDR (max 8).
 * Green/NotSet only fill if fewer than 3 critical items.
 */
function buildCriticalItems(features) {
  const rows = (features || [])
    .filter((f) => f?.key)
    .map((f) => ({
      key: f.key,
      rag: classifyRiskWord(f.customfield_23560),
      summary: f.summary || '',
      tldr: extractTldrLine(f.customfield_38460),
    }))
    .sort((a, b) => (RAG_RANK[a.rag] ?? 9) - (RAG_RANK[b.rag] ?? 9));

  const critical = rows.filter((r) => r.rag === 'Red' || r.rag === 'Yellow').slice(0, 8);
  if (critical.length >= 3) return critical;
  const fillers = rows.filter((r) => r.rag !== 'Red' && r.rag !== 'Yellow').slice(0, 3 - critical.length);
  return [...critical, ...fillers].slice(0, 8);
}

function featOutstandingFromBreakdowns(featureKeys, breakdownDataMap) {
  if (!breakdownDataMap || !featureKeys?.length) return null;
  let remaining = 0;
  for (const key of featureKeys) {
    const bd = breakdownDataMap[key];
    if (!bd) continue;
    const stats = bd.overallStats || {};
    remaining += bd.outstandingCount
      || ((stats.toDo || 0) + (stats.inProgress || 0) + (stats.blocked || 0) + (stats.other || 0));
  }
  if (remaining <= 0) return null;
  return { 'Dev Code': remaining };
}

export function assembleTierForRelease({
  release,
  items,
  gateData,
  projectStatus,
  breakdownDataMap = {},
  checkpointHistory = {},
  p0Count = 0,
  mustFixCount = 0,
  p0Keys = [],
  mustFixKeys = [],
}) {
  const features = (items || []).filter((i) => {
    const t = (i.issuetype || i.issueType || '').toLowerCase();
    return t === 'feature' || t === 'initiative';
  });

  const cgDate = gateIsoFromGateData(gateData, ['CG']);
  const pgDate = gateIsoFromGateData(gateData, ['PG']);
  const gateDates = {
    cgDate,
    pgDate,
    daysToCommitGate: daysUntil(cgDate),
    daysToPromotionGate: daysUntil(pgDate),
  };

  const projects = projectStatus?.projects || [];
  const standaloneEpics = projectStatus?.standaloneEpics || [];
  const standaloneTickets = projectStatus?.standaloneTickets || null;
  const tierOutstanding = projectStatus?.tierOutstanding || null;

  let featOutstanding = tierOutstanding?.feat
    ? groupsToTotals(tierOutstanding.feat)
    : sumOutstandingByType(projects.map((p) => p.issueTypeGroups));
  if (Object.values(featOutstanding).reduce((s, n) => s + n, 0) === 0) {
    const fallback = featOutstandingFromBreakdowns(
      features.map((f) => f.key).filter(Boolean),
      breakdownDataMap
    );
    if (fallback) featOutstanding = fallback;
  }

  const standaloneOutstanding = tierOutstanding?.standalone
    ? groupsToTotals(tierOutstanding.standalone)
    : sumOutstandingByType(standaloneEpics.map((p) => p.issueTypeGroups));

  const directOutstanding = tierOutstanding?.direct
    ? groupsToTotals(tierOutstanding.direct)
    : sumOutstandingByType(standaloneTickets ? [standaloneTickets.issueTypeGroups] : []);

  // Derive a meaningful RAG for direct tickets from outstanding open work.
  // We have no per-ticket risk indicator for direct tickets, so we synthesise:
  //   RED    — any Bugs outstanding (direct bugs = highest risk)
  //   YELLOW — any other open work (Improvement / Dev Code / Test / other)
  //   GREEN  — total open is zero
  const directTotalOpen = Object.values(directOutstanding).reduce((s, n) => s + n, 0);
  const directBugsOpen  = directOutstanding['Bug'] || 0;
  const directRagCounts = directTotalOpen === 0
    ? { Red: 0, Yellow: 0, Green: 1, NotSet: 0 }
    : directBugsOpen > 0
      ? { Red: 1, Yellow: directTotalOpen - directBugsOpen > 0 ? 1 : 0, Green: 0, NotSet: 0 }
      : { Red: 0, Yellow: 1, Green: 0, NotSet: 0 };

  const criticalItems = buildCriticalItems(features);
  const releaseGates = resolveReleaseGateContext(gateData);

  // Direct tickets have no per-ticket Risk Indicator or status-update dates.
  // We only know aggregate open counts (no individual keys from the bundle).
  // Gate rule: all items must be done by CG. Represent open count via notDoneByCg.
  const directItemCount = standaloneTickets
    ? (standaloneTickets.issueTypeGroups || []).reduce((s, g) => s + (g.total || 0), 0)
    : 0;
  const directCallouts = {
    ...buildTierCallouts([], checkpointHistory, releaseGates, {
      skipGateDates: true,
      checkDoneByCg: false, // no per-ticket items available; set notDoneByCg manually below
    }),
    // No per-ticket keys available for direct tickets — surface open count only.
    riskNotSet: { count: 0, keys: [] },
    notDoneByCg: {
      count: directTotalOpen,
      keys: [],
      gate: gateDates.cgDate
        ? { kind: 'CG', iso: gateDates.cgDate, daysUntil: gateDates.daysToCommitGate ?? null }
        : null,
    },
  };
  // FEAT Work: full gate checks (CG/PG date fields present on portfolio items).
  const featCallouts = buildTierCallouts(features, checkpointHistory, releaseGates, { skipGateDates: false });

  // Standalone epics have no Risk Indicator on the SoS table — treat every
  // epic key as NotSet hygiene so the model must list them, not invent "four".
  // Exclude epics that are already closed/done (e.g. closed in JIRA since last
  // bundle sync) so they don't appear as "past gate lagging".
  const DONE_STATUSES_CLIENT = new Set(['fixed', 'done', 'resolved', 'complete', 'closed', 'cancelled']);
  const standaloneItems = (standaloneEpics || [])
    .filter((e) => e?.projectKey && !DONE_STATUSES_CLIENT.has((e.status || '').toLowerCase()))
    .map((e) => ({ key: e.projectKey, customfield_23560: null, customfield_45660: null, status: e.status || '' }));
  // Standalone Epics and Direct Tickets skip CG/PG gate-date field checks
  // (they have none). The only gate rule: all items must be done by CG date.
  const doneByCgOptions = { skipGateDates: true, checkDoneByCg: true, cgDate: gateDates.cgDate || null };
  const standaloneCallouts = buildTierCallouts(standaloneItems, checkpointHistory, releaseGates, doneByCgOptions);

  const shared = { release, gateDates, p0Count, mustFixCount, p0Keys, mustFixKeys };

  return {
    feat: {
      ...shared,
      tier: 'feat',
      ragCounts: ragCountsFromItems(features),
      itemCount: features.length,
      outstandingByType: featOutstanding,
      criticalItems,
      callouts: featCallouts,
    },
    standalone: {
      ...shared,
      tier: 'standalone',
      ragCounts: {
        Red: 0,
        Yellow: 0,
        Green: 0,
        NotSet: standaloneItems.length,
      },
      itemCount: standaloneEpics.length,
      outstandingByType: standaloneOutstanding,
      criticalItems: (standaloneEpics || []).slice(0, 8).map((e) => ({
        key: e.projectKey,
        rag: 'NotSet',
        summary: e.projectName || e.projectKey,
        tldr: e.projectName || '',
      })).filter((c) => c.key),
      callouts: standaloneCallouts,
    },
    direct: {
      ...shared,
      tier: 'direct',
      ragCounts: directRagCounts,
      itemCount: directItemCount,
      outstandingByType: directOutstanding,
      criticalItems: [],
      callouts: directCallouts,
    },
  };
}

export function useSosTierSummary() {
  const [tierSummaries, setTierSummaries] = useState({});
  const [projectStatusByRelease, setProjectStatusByRelease] = useState({});
  const projectStatusRef = useRef({});
  const [generating, setGenerating] = useState(false);
  const [generatingRelease, setGeneratingRelease] = useState(null);
  const [generateError, setGenerateError] = useState(null);

  const fetchProjectStatus = useCallback(async (productId, release, { force = false } = {}) => {
    const cached = projectStatusRef.current[release];
    if (!force && cached) return cached;
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    const resp = await authenticatedGet(
      '/api/release-dataset/project-status',
      { productId, release },
      { jiraToken, username }
    );
    if (!resp.data?.success) {
      throw new Error(resp.data?.error || `Failed to load project-status for ${release}`);
    }
    const data = resp.data.data || {};
    projectStatusRef.current = { ...projectStatusRef.current, [release]: data };
    setProjectStatusByRelease((prev) => ({ ...prev, [release]: data }));
    return data;
  }, []);

  const generateForRelease = useCallback(async ({
    productId,
    release,
    items,
    gateData,
    breakdownDataMap = {},
    checkpointHistory = {},
    p0Count = 0,
    mustFixCount = 0,
    p0Keys = [],
    mustFixKeys = [],
  }) => {
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setGenerating(true);
    setGeneratingRelease(release);
    setGenerateError(null);

    setTierSummaries((prev) => {
      const releaseState = { ...(prev[release] || {}) };
      for (const tier of SOS_TIERS) {
        releaseState[tier] = { state: 'loading', summary: null, error: null, generatedAt: null };
      }
      return { ...prev, [release]: releaseState };
    });

    try {
      const projectStatus = await fetchProjectStatus(productId, release, { force: true });
      const payloads = assembleTierForRelease({
        release,
        items,
        gateData,
        projectStatus,
        breakdownDataMap,
        checkpointHistory,
        p0Count,
        mustFixCount,
        p0Keys,
        mustFixKeys,
      });

      for (const tier of SOS_TIERS) {
        try {
          if (isTierEmpty(payloads[tier])) {
            setTierSummaries((prev) => ({
              ...prev,
              [release]: {
                ...(prev[release] || {}),
                [tier]: {
                  state: 'done',
                  summary: emptyTierSummary(tier, release),
                  error: null,
                  generatedAt: new Date().toISOString(),
                  empty: true,
                },
              },
            }));
            continue;
          }
          const resp = await authenticatedPost(
            '/api/ai/sos-tier-summary',
            payloads[tier],
            { jiraToken, username }
          );
          const summary = resp.data?.summary || '';
          setTierSummaries((prev) => ({
            ...prev,
            [release]: {
              ...(prev[release] || {}),
              [tier]: {
                state: 'done',
                summary,
                error: null,
                generatedAt: resp.data?.generatedAt || new Date().toISOString(),
              },
            },
          }));
        } catch (err) {
          setTierSummaries((prev) => ({
            ...prev,
            [release]: {
              ...(prev[release] || {}),
              [tier]: {
                state: 'error',
                summary: null,
                error: getUserFacingMessage(err, {
                  context: 'sos-tier-summary',
                  fallback: err.response?.data?.error || err.message || 'Generation failed',
                }),
                generatedAt: null,
              },
            },
          }));
        }
      }
    } catch (err) {
      const msg = getUserFacingMessage(err, {
        context: 'sos-tier-summary',
        fallback: err.message || 'Failed to load tier data',
      });
      setGenerateError(msg);
      setTierSummaries((prev) => {
        const releaseState = { ...(prev[release] || {}) };
        for (const tier of SOS_TIERS) {
          releaseState[tier] = { state: 'error', summary: null, error: msg, generatedAt: null };
        }
        return { ...prev, [release]: releaseState };
      });
    } finally {
      setGenerating(false);
      setGeneratingRelease(null);
    }
  }, [fetchProjectStatus]);

  const retryTier = useCallback(async ({
    productId,
    release,
    tier,
    items,
    gateData,
    breakdownDataMap = {},
    checkpointHistory = {},
    p0Count = 0,
    mustFixCount = 0,
    p0Keys = [],
    mustFixKeys = [],
  }) => {
    if (!SOS_TIERS.includes(tier)) return;
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setTierSummaries((prev) => ({
      ...prev,
      [release]: {
        ...(prev[release] || {}),
        [tier]: { state: 'loading', summary: null, error: null, generatedAt: null },
      },
    }));

    try {
      const projectStatus = await fetchProjectStatus(productId, release, { force: true });
      const payloads = assembleTierForRelease({
        release, items, gateData, projectStatus, breakdownDataMap,
        checkpointHistory,
        p0Count, mustFixCount, p0Keys, mustFixKeys,
      });
      if (isTierEmpty(payloads[tier])) {
        setTierSummaries((prev) => ({
          ...prev,
          [release]: {
            ...(prev[release] || {}),
            [tier]: {
              state: 'done',
              summary: emptyTierSummary(tier, release),
              error: null,
              generatedAt: new Date().toISOString(),
              empty: true,
            },
          },
        }));
        return;
      }
      const resp = await authenticatedPost(
        '/api/ai/sos-tier-summary',
        payloads[tier],
        { jiraToken, username }
      );
      setTierSummaries((prev) => ({
        ...prev,
        [release]: {
          ...(prev[release] || {}),
          [tier]: {
            state: 'done',
            summary: resp.data?.summary || '',
            error: null,
            generatedAt: resp.data?.generatedAt || new Date().toISOString(),
          },
        },
      }));
    } catch (err) {
      setTierSummaries((prev) => ({
        ...prev,
        [release]: {
          ...(prev[release] || {}),
          [tier]: {
            state: 'error',
            summary: null,
            error: getUserFacingMessage(err, {
              context: 'sos-tier-summary',
              fallback: err.response?.data?.error || err.message || 'Generation failed',
            }),
            generatedAt: null,
          },
        },
      }));
    }
  }, [fetchProjectStatus]);

  return {
    tierSummaries,
    projectStatusByRelease,
    generating,
    generatingRelease,
    generateError,
    generateForRelease,
    retryTier,
    fetchProjectStatus,
    TIER_LABELS,
    SOS_TIERS,
  };
}
