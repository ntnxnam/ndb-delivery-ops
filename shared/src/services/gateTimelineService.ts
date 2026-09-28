/**
 * gateTimelineService — release-gate event parser.
 *
 * Reads the human-curated `releaseGateDates.<release>` section of the
 * legacy `releaseVersionsEmailConfig.json` and produces a normalised,
 * chronologically sorted list of `GateEvent`s that UIs can render as
 * chips, ticks on a Gantt axis, or rows in a calendar.
 *
 * NDB has historically tracked these gates per release:
 *
 *   EC      Early Commitment (single date)
 *   CC1..n  Code Complete cycles  (Streamlit colour: red,    #de350b)
 *   CG1..n  Commit Gate cycles    (Streamlit colour: orange, #ff9800)
 *   PG1..n  Promotion Gate cycles (Streamlit colour: purple, #9c27b0)
 *   GA1..n  General Availability  (Streamlit colour: green,  #28a745)
 *
 * The config supports two shapes per gate cycle (kept for back-compat
 * with the legacy emailer):
 *
 *   Array form:  ccm1Gate: [{ label, date, color, style }, ...]
 *   Object form: commitGate1: { label, date, color, style }
 *
 * `style` semantics from the emailer:
 *   - 'dotted' → planned / superseded (will render strike-through)
 *   - 'solid'  → current / committed
 *
 * D1 (product-agnostic): no NDB-specific strings here. The service
 * accepts whatever release config the caller hands it; the only
 * NDB-coupled bit is the *layout* of the config file itself, which the
 * server route owns.
 *
 * This is the first fusion step for STREAMLIT_PARITY.md row "Gantt gate
 * chips" — the shared primitive that both the Brief page and (Wave 2)
 * the legacy `ReleaseVersionGantt` will consume.
 */

// ── Public types ──────────────────────────────────────────────────────────

export type GateKind = 'EC' | 'CCM' | 'CG' | 'PG' | 'GA' | 'SOFT';

export type GateStyle = 'dotted' | 'solid';

export interface GateEvent {
  /** Stable kind enum the UI uses for grouping / colouring. */
  kind: GateKind;
  /** Human-friendly label exactly as configured (e.g. "Code Complete 2"). */
  label: string;
  /** ISO date (YYYY-MM-DD). */
  iso: string;
  /** Streamlit-style hex colour. Falls back to the canonical palette. */
  color: string;
  /** Treat 'dotted' as planned/superseded (strike-through in UI). */
  style: GateStyle;
  /** Internal source key (e.g. 'commitGate2', 'ccm1Gate[0]') — debugging. */
  source: string;
  /**
   * True when this event's date is today or earlier (server-resolved
   * relative to `now`). UIs can render past events at reduced opacity.
   */
  past: boolean;
}

export interface ReleaseGateTimeline {
  release: string;
  /** Chronologically sorted (earliest first). */
  gates: GateEvent[];
  /** Indexed view for callers that only want the next upcoming gate per kind. */
  nextByKind: Partial<Record<GateKind, GateEvent>>;
  /** Convenience: the next gate of any kind (closest in the future). */
  nextOverall: GateEvent | null;
}

export interface ParseGateTimelineOptions {
  /**
   * The `releaseGateDates[<release>]` object from
   * `releaseVersionsEmailConfig.json`. Shape is loose — see the JSDoc
   * at the top of this file.
   */
  versionConfig: Record<string, unknown> | null | undefined;
  /** Override "today" — tests + deterministic snapshots. */
  now?: Date;
}

// ── Canonical NDB palette (matches the emailer config + Streamlit) ────────

const CANONICAL_COLOR: Record<GateKind, string> = {
  EC: '#1F4E79',
  CCM: '#de350b',
  CG: '#ff9800',
  PG: '#9c27b0',
  GA: '#28a745',
  /** Soft / informational gates — neutral grey, no blocking gate semantics. */
  SOFT: '#6c757d',
};

const KIND_LABELS: Record<GateKind, string> = {
  EC: 'Early Commit',
  CCM: 'Code Complete Met',
  CG: 'Commit Gate',
  PG: 'Promotion Gate',
  GA: 'General Availability',
  SOFT: 'Soft Gate',
};

// ── Public surface ────────────────────────────────────────────────────────

/** Display-friendly label for a kind (e.g. legends, tooltips). */
export function gateKindLabel(kind: GateKind): string {
  return KIND_LABELS[kind];
}

export function gateKindColor(kind: GateKind): string {
  return CANONICAL_COLOR[kind];
}

/**
 * Build a `ReleaseGateTimeline` for a single release from its raw
 * `releaseVersionsEmailConfig.json` section.
 *
 * Returns an empty timeline when `versionConfig` is missing — never
 * throws on shape mismatches; bad entries are dropped silently so a
 * single mis-typed date can't blow up the whole strip.
 */
export function parseReleaseGateTimeline(
  release: string,
  options: ParseGateTimelineOptions
): ReleaseGateTimeline {
  const cfg = options?.versionConfig;
  const now = options?.now ?? new Date();
  const todayIso = isoDateOnly(now);

  const gates: GateEvent[] = [];

  if (cfg && typeof cfg === 'object') {
    // EC is a flat field, not a gate object. Treat the date as a 'solid' event.
    const ec = (cfg as Record<string, unknown>).ecDate;
    if (typeof ec === 'string' && isIsoDate(ec)) {
      gates.push({
        kind: 'EC',
        label: 'Early Commitment',
        iso: ec.slice(0, 10),
        color: CANONICAL_COLOR.EC,
        style: 'solid',
        source: 'ecDate',
        past: ec.slice(0, 10) <= todayIso,
      });
    }

    // CC variants live under ccm{N}Gate (array). Some configs use ccm with no number.
    extractNumberedGate(cfg, 'ccm', 'Gate', 'CCM', gates, todayIso);

    // CG / PG variants live under commitGate{N} / promotionGate{N} (object or array).
    extractNumberedGate(cfg, 'commitGate', '', 'CG', gates, todayIso);
    extractNumberedGate(cfg, 'promotionGate', '', 'PG', gates, todayIso);

    // GA variants live under ga{N}.
    extractNumberedGate(cfg, 'ga', '', 'GA', gates, todayIso);

    // ── Soft / informational gates ──────────────────────────────────────
    // These are milestones that inform the schedule but are not blocking
    // release gates (e.g. Deferral Complete, Pre-CC, Concept Commit).
    // Keys supported:
    //   deferralComplete         — single object  { label, date, color?, style? }
    //   conceptCommit{N}         — numbered objects (Pre-CC checkpoints)
    //   preEc                    — single object
    const SOFT_SINGLE_KEYS = ['deferralComplete', 'preEc'] as const;
    for (const key of SOFT_SINGLE_KEYS) {
      const raw = (cfg as Record<string, unknown>)[key];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const ev = makeSoftEvent(raw, key, todayIso);
        if (ev) gates.push(ev);
      }
    }
    // conceptCommit{N} — numbered, same pattern as commitGate{N}
    extractNumberedSoftGate(cfg, 'conceptCommit', '', gates, todayIso);
  }

  gates.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));

  const nextByKind: Partial<Record<GateKind, GateEvent>> = {};
  for (const g of gates) {
    if (g.past) continue;
    if (!nextByKind[g.kind]) nextByKind[g.kind] = g;
  }
  const nextOverall = gates.find((g) => !g.past) ?? null;

  return { release, gates, nextByKind, nextOverall };
}

// ── Internals ─────────────────────────────────────────────────────────────

function extractNumberedGate(
  cfg: Record<string, unknown>,
  prefix: string,
  suffix: string,
  kind: GateKind,
  out: GateEvent[],
  todayIso: string,
  maxCycles = 10
): void {
  for (let i = 1; i <= maxCycles; i += 1) {
    const key = `${prefix}${i}${suffix}`;
    const raw = cfg[key];
    if (!raw) continue;
    if (Array.isArray(raw)) {
      raw.forEach((entry, idx) => {
        const ev = makeEvent(entry, kind, `${key}[${idx}]`, todayIso);
        if (ev) out.push(ev);
      });
      continue;
    }
    if (typeof raw === 'object') {
      const ev = makeEvent(raw, kind, key, todayIso);
      if (ev) out.push(ev);
    }
  }
}

function makeEvent(
  raw: unknown,
  kind: GateKind,
  source: string,
  todayIso: string
): GateEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const date = typeof r.date === 'string' ? r.date : null;
  if (!date || !isIsoDate(date)) return null;
  const iso = date.slice(0, 10);
  const labelRaw = typeof r.label === 'string' && r.label ? r.label : KIND_LABELS[kind];
  const colorRaw = typeof r.color === 'string' && r.color ? r.color : CANONICAL_COLOR[kind];
  const styleRaw = r.style === 'dotted' ? 'dotted' : 'solid';
  return {
    kind,
    label: labelRaw,
    iso,
    color: colorRaw,
    style: styleRaw,
    source,
    past: iso <= todayIso,
  };
}

/**
 * Build a SOFT GateEvent from a raw config object.
 * Falls back to the SOFT canonical colour but respects an explicit `color`
 * in the config (e.g. grey Pre-CC markers already have `#6c757d`).
 */
function makeSoftEvent(
  raw: unknown,
  source: string,
  todayIso: string
): GateEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const date = typeof r.date === 'string' ? r.date : null;
  if (!date || !isIsoDate(date)) return null;
  const iso = date.slice(0, 10);
  const labelRaw =
    typeof r.label === 'string' && r.label ? r.label : KIND_LABELS.SOFT;
  const colorRaw =
    typeof r.color === 'string' && r.color ? r.color : CANONICAL_COLOR.SOFT;
  const styleRaw = r.style === 'dotted' ? 'dotted' : ('solid' as GateStyle);
  return {
    kind: 'SOFT',
    label: labelRaw,
    iso,
    color: colorRaw,
    style: styleRaw,
    source,
    past: iso <= todayIso,
  };
}

/**
 * Extract numbered soft-gate entries (e.g. conceptCommit1, conceptCommit2).
 * Same looping logic as `extractNumberedGate` but always produces SOFT kind.
 */
function extractNumberedSoftGate(
  cfg: Record<string, unknown>,
  prefix: string,
  suffix: string,
  out: GateEvent[],
  todayIso: string,
  maxCycles = 10
): void {
  for (let i = 1; i <= maxCycles; i += 1) {
    const key = `${prefix}${i}${suffix}`;
    const raw = cfg[key];
    if (!raw) continue;
    if (Array.isArray(raw)) {
      raw.forEach((entry, idx) => {
        const ev = makeSoftEvent(entry, `${key}[${idx}]`, todayIso);
        if (ev) out.push(ev);
      });
      continue;
    }
    if (typeof raw === 'object') {
      const ev = makeSoftEvent(raw, key, todayIso);
      if (ev) out.push(ev);
    }
  }
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

function isoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
