/**
 * Executive Summary Signal Derivation — shared SoT (Wave 3 / D41).
 *
 * CJS so Express can require() this file. App shim:
 *   apps/delivery-ops/server/utils/execSummarySignals.js
 *
 * Pure function that takes raw JIRA item + ganttConfig + breakdownData and returns
 * a structured "signals" object the NAI prompt uses to write phase-aware exec summaries.
 *
 * Why this exists: feeding NAI raw JIRA fields leads to it discussing irrelevant
 * milestones (e.g. mentioning FS/DS Done Date on a feature that's already past
 * Code Complete Met). Here we deterministically compute:
 *   - The feature's lifecycle phase
 *   - Which signals MATTER for that phase (focus/ignore)
 *   - Numeric facts (days to gates, overshoot, task counts, QI%)
 *   - Team N/A declarations from the 20-point status update
 *
 * The result is a JSON-friendly object the prompt layer can stringify.
 */

const MS_PER_DAY = 86400000;

// ── Phase relevance map ────────────────────────────────────────────────────
// What the AI should MENTION vs IGNORE for each phase.
// "ignore" entries are signals that no longer materially affect the assessment
// at this stage (e.g. FS/DS Done Date is irrelevant once Code Complete is met).
const PHASE_RELEVANCE = {
  Inception: {
    focus: ['fsdsDone', 'testPlan', 'designDoc', 'requirementsLink'],
    ignore: ['cg', 'pg', 'bugs', 'qi', 'security', 'legal'],
  },
  Design: {
    focus: ['fsdsDone', 'testPlan', 'designDoc', 'requirementsLink', 'codeComplete'],
    ignore: ['cg', 'pg', 'bugs', 'qi'],
  },
  Coding: {
    focus: ['codeComplete', 'taskOutstanding', 'testPlanLink', 'extension'],
    ignore: ['fsdsDone', 'testPlan'],
  },
  'Coding (late)': {
    focus: ['codeComplete', 'codeCompleteOvershoot', 'extension', 'taskOutstanding', 'qi'],
    ignore: ['fsdsDone', 'testPlan'],
  },
  'CC Met': {
    focus: ['commitGate', 'securityFiled', 'legalFiled', 'manualQI', 'systemTestQI', 'openBugs', 'taskOutstanding'],
    ignore: ['fsdsDone', 'testPlan'],
  },
  'CG Met': {
    focus: ['promotionGate', 'p0p1Open', 'securityClosed', 'legalClosed', 'automationQI', 'systemTestQI', 'longevityPerf', 'docsComplete'],
    ignore: ['fsdsDone', 'testPlan', 'codeComplete'],
  },
  'PG Met': {
    focus: ['residualP0P1', 'docsFinal', 'gaReadiness'],
    ignore: ['fsdsDone', 'testPlan', 'codeComplete', 'commitGate'],
  },
  Shipped: {
    focus: ['confirmation'],
    ignore: ['*'],
  },
};

// ── 20-point status update sections that can be team-marked N/A ────────────
// Keyed by camelCase signal name; value is the section label patterns to match.
const NA_SECTIONS = {
  requirements: ['requirements'],
  ux: ['ux'],
  techDesign: ['tech design'],
  testPlan: ['test plan'],
  manualTesting: ['manual testing'],
  automation: ['automation'],
  frameworkChanges: ['framework changes'],
  integrationTesting: ['integration testing'],
  systemTesting: ['system testing'],
  longevityPerf: ['longevity', 'longevity & performance', 'longevity and performance'],
  telemetry: ['telemetry'],
  fmea: ['fmea'],
  threatModelling: ['threat modelling', 'threat modeling'],
  rbac: ['rbac'],
  backwardCompatibility: ['backward compatibility'],
  cpbr: ['cpbr'],
  apisAuditing: ['apis auditing', 'api auditing'],
  acp: ['acp'],
  legal: ['legal'],
  a11y: ['a11y', 'accessibility'],
  techPubs: ['techpubs', 'tech pubs'],
  serviceability: ['serviceability'],
  securityReview: ['security review'],
  penTesting: ['pen testing', 'pentest', 'penetration testing'],
};

// Regex for detecting "N/A" markings (case-insensitive, whitespace-tolerant)
const NA_VALUE_REGEX = /^\s*(n[/.]?\s*a|not\s+applicable|n[/.]?a\.?)\s*$/i;

// ── String/value helpers ────────────────────────────────────────────────────
function getStringValue(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field.trim();
  if (typeof field === 'object') {
    return (field.value || field.name || field.content || '').toString().trim();
  }
  return String(field).trim();
}

const MAX_NARRATIVE_CHARS = 600;

function extractAdfPlain(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const parts = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  }
  walk(raw);
  return parts.join(' ').trim();
}

/** Plain text for Risk Assessment / Path to Green (string, select, or ADF). */
function extractNarrativeField(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') {
    if (raw.type === 'doc') return extractAdfPlain(raw);
    const v = raw.value ?? raw.name ?? raw.display ?? '';
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object' && v.type === 'doc') return extractAdfPlain(v);
  }
  return String(raw).trim();
}

function isBlankNarrative(text) {
  const t = (text || '').trim().toLowerCase();
  return !t || t === 'not set' || t === 'n/a' || t === 'na' || t === 'none';
}

function classifyIndicatorBucket(raw) {
  const v = (typeof raw === 'string' ? raw : getStringValue(raw)).toLowerCase().trim();
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

/**
 * Mirrors evaluateTeamRiskContext in riskIndicator.ts — keep rules in sync.
 */
function evaluateTeamRiskNarrative(indicatorRaw, assessmentText, pathText) {
  const indicator = classifyIndicatorBucket(indicatorRaw);
  const assessment = (assessmentText || '').trim();
  const pathToGreen = (pathText || '').trim();
  const assessmentMissing = isBlankNarrative(assessment);
  const pathToGreenMissing = isBlankNarrative(pathToGreen);
  const gaps = [];

  if (indicator === 'yellow' || indicator === 'red') {
    const color = indicator === 'red' ? 'Red' : 'Yellow';
    if (pathToGreenMissing) {
      gaps.push(
        `Path to Green not set while Risk Indicator is ${color} — team attested risk without a recovery path.`
      );
    }
    if (assessmentMissing) {
      gaps.push(
        `Risk Assessment not set while Risk Indicator is ${color} — no written rationale for the color.`
      );
    }
  }

  let verdictFloor = null;
  if (indicator === 'red') verdictFloor = 'RED';
  else if (indicator === 'yellow' || gaps.length > 0) verdictFloor = 'YELLOW';

  const clip = (s) =>
    s.length > MAX_NARRATIVE_CHARS ? `${s.slice(0, MAX_NARRATIVE_CHARS)}…` : s;

  return {
    indicator,
    assessment: assessmentMissing ? '' : clip(assessment),
    pathToGreen: pathToGreenMissing ? '' : clip(pathToGreen),
    assessmentMissing,
    pathToGreenMissing,
    gaps,
    verdictFloor,
  };
}

function parseDate(value) {
  const str = getStringValue(value);
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from, to) {
  if (!from || !to) return null;
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function isoDate(d) {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

// ── Label / extension parsing ───────────────────────────────────────────────
function getLabels(item) {
  if (Array.isArray(item.labels)) return item.labels;
  if (typeof item.labelsString === 'string') {
    return item.labelsString.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (typeof item.labels === 'string') {
    return item.labels.includes(',')
      ? item.labels.split(',').map(s => s.trim()).filter(Boolean)
      : item.labels.split(/\s+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// Detect "<release>-<ddmmmyyyy>-code-complete-extension-recieved" label and parse the date.
function detectExtensionLabel(item) {
  const labels = getLabels(item);
  const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const suffix = 'code-complete-extension-recieved';
  for (const label of labels) {
    const lower = String(label).toLowerCase().trim();
    if (!lower.endsWith(suffix)) continue;
    const withoutSuffix = lower.replace(`-${suffix}`, '');
    for (const part of withoutSuffix.split('-')) {
      const m = part.match(/^(\d{1,2})([a-z]{3})(\d{4})$/);
      if (m) {
        const day = parseInt(m[1], 10);
        const month = monthMap[m[2]];
        const year = parseInt(m[3], 10);
        if (month != null && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
          const d = new Date(year, month, day);
          d.setHours(0, 0, 0, 0);
          if (!isNaN(d.getTime())) return d;
        }
      }
    }
  }
  return null;
}

// Compliance detection: union of (linked compliance tickets) + (parent labels).
//
// Why union: SDL/LEG/TECHPUBS tickets are the authoritative source of truth —
// a linked SDL-* ticket that's Closed means security is done, regardless of
// what labels the parent feature carries. But some teams historically marked
// compliance with labels before filing real tickets, so we keep label
// detection as a fallback hint (labelOnly=true) rather than removing it.
//
// Inputs:
//   - item.issuelinks: optional, used when narrative isn't available
//   - complianceFromNarrative: optional, takes precedence over item.issuelinks
//
// Output per area (security / legal / docs):
//   {
//     filed:       true if any ticket OR label found
//     allClosed:   true only when tickets exist AND every ticket is closed
//     labelOnly:   true when filed only via label, no real tickets located
//     tickets:     [{ key, status, closed, relationship, summary }]
//   }
const COMPLIANCE_LABEL_KEYWORDS = {
  security: ['security', 'sec-review', 'security-review', 'sdl'],
  legal: ['legal', 'legal-review', 'compliance', 'leg-'],
  docs: ['techpubs', 'tech-pubs', 'documentation', 'doc-review'],
};

const COMPLIANCE_PROJECT_PREFIXES = {
  SDL: 'security',
  LEG: 'legal',
  TECHPUBS: 'docs',
};

const CLOSED_COMPLIANCE_STATUSES = new Set([
  'closed',
  'resolved',
  'done',
  'complete',
  'fixed',
]);

// Walk item.issuelinks (when narrative didn't fetch it) and produce the same
// shape as narrative.compliance. Keeps deriveSignals usable on its own.
function extractComplianceFromItemLinks(item) {
  const out = { security: [], legal: [], docs: [] };
  const links = Array.isArray(item?.issuelinks) ? item.issuelinks : [];
  for (const link of links) {
    const other = link?.inwardIssue || link?.outwardIssue;
    if (!other?.key) continue;
    const project = String(other.key).split('-')[0];
    const bucket = COMPLIANCE_PROJECT_PREFIXES[project];
    if (!bucket) continue;
    const statusName = (other.fields?.status?.name || other.status?.name || '').toString();
    out[bucket].push({
      key: other.key,
      status: statusName || 'unknown',
      closed: CLOSED_COMPLIANCE_STATUSES.has(statusName.toLowerCase()),
      relationship: link?.type?.inward || link?.type?.outward || link?.type?.name || 'links to',
      summary: (other.fields?.summary || '').toString().slice(0, 150),
    });
  }
  return out;
}

// Decide whether to expose the compliance block to the LLM at all.
//
// Keep it when:
//   - Phase is pre-CG-Met (filing is still a forward concern at Inception
//     through CC Met) — compliance gaps matter.
//   - ANY bucket has at least one open (non-closed) ticket — those are real
//     in-flight items that the AI should mention regardless of phase.
//
// Drop it when:
//   - Phase is CG Met / PG Met / Shipped AND every bucket is either empty or
//     all-closed — the team either never needed compliance review or already
//     finished it, and leaving empty arrays in the prompt invites the model
//     to fabricate "unfiled" claims.
function shouldSurfaceCompliance(phase, compliance) {
  const lateGate = phase === 'CG Met' || phase === 'PG Met' || phase === 'Shipped';
  if (!lateGate) return true;
  const buckets = [compliance.security, compliance.legal, compliance.docs];
  const hasOpenTicket = buckets.some(b => Array.isArray(b?.tickets) && b.tickets.some(t => !t.closed));
  return hasOpenTicket;
}

function detectCompliance(item, complianceFromNarrative = null) {
  const tickets = complianceFromNarrative && typeof complianceFromNarrative === 'object'
    ? {
        security: Array.isArray(complianceFromNarrative.security) ? complianceFromNarrative.security : [],
        legal: Array.isArray(complianceFromNarrative.legal) ? complianceFromNarrative.legal : [],
        docs: Array.isArray(complianceFromNarrative.docs) ? complianceFromNarrative.docs : [],
      }
    : extractComplianceFromItemLinks(item);

  const labels = getLabels(item).map(l => String(l).toLowerCase());

  const summarise = (area) => {
    const areaTickets = tickets[area] || [];
    const matchedLabel = COMPLIANCE_LABEL_KEYWORDS[area].some(kw =>
      labels.some(l => l.includes(kw))
    );
    const hasTickets = areaTickets.length > 0;
    const allClosed = hasTickets && areaTickets.every(t => t.closed);
    return {
      filed: hasTickets || matchedLabel,
      allClosed,
      labelOnly: matchedLabel && !hasTickets,
      tickets: areaTickets,
    };
  };

  return {
    security: summarise('security'),
    legal: summarise('legal'),
    docs: summarise('docs'),
  };
}

// ── Gantt config marker date extraction ─────────────────────────────────────
// Parse "+15d" or "-7d" overshoot string back to an integer day count.
// Returns null if not parseable. Used to lift overshoot into criticalRisks.
function parseOvershootDays(overshootStr) {
  if (!overshootStr || typeof overshootStr !== 'string') return null;
  const m = overshootStr.match(/^([+-]?)(\d+)d$/);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return m[1] === '-' ? -n : n;
}

// Walk the per-version gantt config and pick the BINDING gate marker for a
// given family (e.g. all "ccm*", "commitGate*", "promotionGate*" entries).
//
// Selection rules, in order:
//   1. Prefer entries with style: "solid" — by convention these are the
//      final/binding gates (e.g. CG2). Earlier "dotted" entries (e.g. CG1)
//      are soft checkpoints we treat as informational only.
//   2. Among multiple solid entries (rare; usually shouldn't happen for the
//      same family), pick the latest by date.
//   3. If no solid entry exists, fall back to the latest dotted entry.
//
// Returns { date, label, style } or null. The label lets the prompt name
// the gate explicitly ("Commit Gate 2") instead of just dropping a bare date.
function getBindingMarker(ganttConfig, prefix) {
  if (!ganttConfig || typeof ganttConfig !== 'object') return null;
  const candidates = [];
  for (const key of Object.keys(ganttConfig)) {
    if (!key.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const gate = ganttConfig[key];
    if (!gate) continue;
    const entries = Array.isArray(gate) ? gate : [gate];
    for (const g of entries) {
      const d = parseDate(g?.date);
      if (!d) continue;
      candidates.push({
        date: d,
        label: g?.label || key,
        style: (g?.style || '').toLowerCase(),
      });
    }
  }
  if (candidates.length === 0) return null;

  const solids = candidates.filter(c => c.style === 'solid');
  const pool = solids.length > 0 ? solids : candidates;

  return pool.reduce((latest, cur) => (cur.date.getTime() > latest.date.getTime() ? cur : latest));
}

// Backwards-compatible date-only accessor for callers that just want the date.
function getLatestMarkerDate(ganttConfig, prefix) {
  const m = getBindingMarker(ganttConfig, prefix);
  return m ? m.date : null;
}

// ── 20-point status update parsing ──────────────────────────────────────────
// Strip JIRA wiki markup so we can match section headers reliably.
function normaliseStatusText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/\{[^}]+\}/g, ' ')      // {color}, {panel}, {code}, etc.
    .replace(/\*([^*]+)\*/g, '$1')   // *bold*
    .replace(/_([^_]+)_/g, '$1')     // _italic_
    .replace(/\r/g, '');
}

// Find which sections the team has marked N/A.
// Each section's value line is everything between the section label and the next
// section label or section number (e.g. "8e.", "17b.", or numeric "9.").
function parseNADeclarations(rawText) {
  const out = {};
  for (const sig of Object.keys(NA_SECTIONS)) out[sig] = false;
  if (!rawText) return out;

  const text = normaliseStatusText(rawText);

  for (const [signalKey, sectionLabels] of Object.entries(NA_SECTIONS)) {
    for (const label of sectionLabels) {
      // Match: optional number prefix "8e." or "16d.", then label, then ":", then value up to next line / section
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        `(?:^|\\n)\\s*(?:\\d{1,2}[a-z]?\\.\\s*)?${escaped}\\s*:\\s*([^\\n]*?)(?=\\n|$)`,
        'i'
      );
      const m = text.match(re);
      if (m && NA_VALUE_REGEX.test(m[1])) {
        out[signalKey] = true;
        break;
      }
    }
  }
  return out;
}

// Parse QI%, exec rate, open bug counts from the status update text.
// Mirrors patterns in routes/jira/index.js lines 5912-5985 but returns a small struct.
function parseQualitySignals(rawText) {
  const out = { manualQI: null, automationQI: null, systemTestQI: null, openBugs: null, execRate: null, riskReason: null };
  if (!rawText || typeof rawText !== 'string') return out;
  const text = normaliseStatusText(rawText);

  // Manual / overall QI
  const manualMatch = text.match(/(?:manual[^\n]{0,40}?)?QI\s*[:%\s]\s*(\d{1,3})\s*%/i);
  if (manualMatch) {
    const v = parseInt(manualMatch[1], 10);
    if (v >= 0 && v <= 100) out.manualQI = v;
  }

  // Automation QI (look in 8b. Automation block)
  const autoBlock = text.match(/Automation[\s\S]{0,200}?QI\s*[:%\s]\s*(\d{1,3})\s*%/i);
  if (autoBlock) {
    const v = parseInt(autoBlock[1], 10);
    if (v >= 0 && v <= 100) out.automationQI = v;
  }

  // System Test QI (8e. System Testing block)
  const sysBlock = text.match(/System\s+Testing[\s\S]{0,200}?QI\s*[:%\s]\s*(\d{1,3})\s*%/i);
  if (sysBlock) {
    const v = parseInt(sysBlock[1], 10);
    if (v >= 0 && v <= 100) out.systemTestQI = v;
  }

  // Open bugs
  const bugPatterns = [
    /(\d+)\s*open\s*bugs?/i,
    /(\d+)\s*active\s*bugs?/i,
    /(\d+)\s*outstanding\s*(?:bugs?|issues?)/i,
    /bugs?\s*[:=]\s*(\d+)/i,
  ];
  for (const re of bugPatterns) {
    const m = text.match(re);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v >= 0 && v < 1000) { out.openBugs = v; break; }
    }
  }

  // Execution rate
  const execPatterns = [/execution[:\s]*(\d{1,3})\s*%/i, /(\d{1,3})\s*%\s*execution/i, /run\s*%\s*[:=]\s*(\d{1,3})/i];
  for (const re of execPatterns) {
    const m = text.match(re);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v >= 0 && v <= 100) { out.execRate = v; break; }
    }
  }

  // Risk reason (free-form short explanation if team called one out)
  const riskMatch = text.match(/(?:reason\s+for\s+(?:red|yellow|risk)|risk\s+reason)[:\s]*([^\n]{10,200})/i);
  if (riskMatch) out.riskReason = riskMatch[1].trim();

  return out;
}

// ── Task breakdown summarisation ────────────────────────────────────────────
// breakdownData shape (from client taskBreakdownService):
//   { total, outstandingCount, overallStats, breakdown: [{ type, total, statusCategories }] }
function summariseBreakdown(breakdownData) {
  if (!breakdownData) {
    return { totalOutstanding: null, totalToBeVerified: null, trulyOpenCount: null, byType: [], totals: null };
  }
  const totalOutstanding = breakdownData.outstandingCount ?? null;
  const totals = breakdownData.overallStats ? { ...breakdownData.overallStats } : null;

  // "To Be Verified" already exists as a category in taskBreakdownService
  // (it maps JIRA status=Resolved). The previous version dropped it on the
  // floor, so the AI saw "8 outstanding" with no signal that 6 of those were
  // sitting on QA verification rather than open dev work. We surface it
  // explicitly per-type and also compute a top-level trulyOpenCount so the
  // prompt rule can demand "N truly open, M awaiting QA verification" phrasing.
  const byType = Array.isArray(breakdownData.breakdown)
    ? breakdownData.breakdown.map(entry => {
        const cats = entry.statusCategories || {};
        const sumCat = (cat) => Object.values(cats[cat] || {}).reduce((a, b) => a + (b || 0), 0);
        const inProgress = sumCat('In Progress');
        const toDo = sumCat('To Do');
        const blocked = sumCat('Blocked');
        const toBeVerified = sumCat('To Be Verified');
        return {
          type: entry.type,
          outstanding: entry.total,
          done: sumCat('Done'),
          toBeVerified,
          trulyOpen: inProgress + toDo + blocked,
          inProgress,
          toDo,
          blocked,
        };
      })
    : [];

  const totalToBeVerified = breakdownData.overallStats?.toBeVerified ?? null;
  const trulyOpenCount = totalOutstanding != null && totalToBeVerified != null
    ? Math.max(0, totalOutstanding - totalToBeVerified)
    : null;

  return { totalOutstanding, totalToBeVerified, trulyOpenCount, byType, totals };
}

// ── Latest passed release-level marker ──────────────────────────────────────
// Which release-level gate has most recently passed (relative to today)?
// Returns null when ganttConfig has no dated markers or none have passed yet.
//
// We look at the BINDING markers only (solid > dotted, latest per family) so
// we compare against the same dates the overshoot logic uses.  The result is
// used both to anchor the phase and to detect "missed gate" critical risks —
// i.e. the release calendar says the team should have cleared this gate by now,
// but their JIRA status hasn't been updated to reflect it.
function deriveLatestPassedMarker(today, { bindingCCMMarker, bindingCGMarker, bindingPGMarker, bindingGAMarker }) {
  const candidates = [
    { name: 'GA',          marker: bindingGAMarker,  expectedPhase: 'Shipped' },
    { name: 'Promotion Gate', marker: bindingPGMarker, expectedPhase: 'PG Met'  },
    { name: 'Commit Gate', marker: bindingCGMarker,  expectedPhase: 'CG Met'  },
    { name: 'Code Complete', marker: bindingCCMMarker, expectedPhase: 'CC Met' },
  ];

  for (const { name, marker, expectedPhase } of candidates) {
    if (!marker?.date) continue;
    const d = new Date(marker.date);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() <= today.getTime()) {
      return {
        name,
        label: marker.label || name,
        date: marker.date,
        daysAgo: daysBetween(d, today),
        expectedPhase,
      };
    }
  }
  return null;
}

// ── Phase detection ─────────────────────────────────────────────────────────
// Priority: release-level marker dates (objective calendar truth) come first.
// JIRA status is consulted only when marker dates are unavailable or when the
// feature has explicitly cleared a gate that no marker date can confirm.
//
// Why dates-first: JIRA statuses like "In Progress" or "Coding" are routinely
// stale — teams don't always update the status when CC or CG passes. The
// release calendar dates are objective and always up to date.
function detectPhase({ statusLabel, today, fsdsDoneDate, testPlanDate, codeCompleteDate,
                       latestCCMMarker, latestCGMarker, latestPGMarker, latestGAMarker }) {
  const s = (statusLabel || '').toLowerCase();

  // Shipped / closed is always authoritative — nothing overrides a closed ticket.
  if (s.includes('closed') || s === 'resolved' || s === 'done') {
    return { phase: 'Shipped', rationale: `JIRA status = "${statusLabel}"` };
  }

  // ── Date-first: walk release markers newest → oldest ──────────────────────
  // If a release-level gate marker has already passed AND the JIRA status
  // confirms that gate is met, use the higher gate phase.
  // If the marker passed but JIRA status does NOT confirm, the feature is
  // behind schedule — we still advance the phase (so PHASE_FOCUS is correct)
  // but we record the gap in the rationale so criticalRisks can use it.

  if (latestGAMarker && today && latestGAMarker.getTime() <= today.getTime()) {
    if (s.includes('promotion gate met') || s.includes('commit gate met') || s.includes('code complete met') || s.includes('in progress')) {
      return {
        phase: 'PG Met',
        rationale: `GA marker (${isoDate(latestGAMarker)}) has passed; JIRA status "${statusLabel}" — treating as PG Met pending confirmation`,
      };
    }
  }

  if (latestPGMarker && today && latestPGMarker.getTime() <= today.getTime()) {
    if (s.includes('promotion gate met')) {
      return { phase: 'PG Met', rationale: `JIRA status = "${statusLabel}" (PG marker passed ${isoDate(latestPGMarker)})` };
    }
    // PG date passed but status not updated — still use PG Met phase focus so
    // the AI evaluates readiness correctly; criticalRisks will flag the gap.
    return {
      phase: 'PG Met',
      rationale: `PG marker (${isoDate(latestPGMarker)}) has passed but JIRA status is still "${statusLabel}" — status likely stale`,
    };
  }

  if (latestCGMarker && today && latestCGMarker.getTime() <= today.getTime()) {
    if (s.includes('commit gate met') || s.includes('promotion gate met')) {
      return { phase: 'CG Met', rationale: `JIRA status = "${statusLabel}" (CG marker passed ${isoDate(latestCGMarker)})` };
    }
    return {
      phase: 'CG Met',
      rationale: `CG marker (${isoDate(latestCGMarker)}) has passed but JIRA status is still "${statusLabel}" — status likely stale`,
    };
  }

  if (latestCCMMarker && today && latestCCMMarker.getTime() <= today.getTime()) {
    if (s.includes('code complete met') || s.includes('commit gate met') || s.includes('promotion gate met')) {
      return { phase: 'CC Met', rationale: `JIRA status = "${statusLabel}" (CCM marker passed ${isoDate(latestCCMMarker)})` };
    }
    return {
      phase: 'CC Met',
      rationale: `CCM marker (${isoDate(latestCCMMarker)}) has passed but JIRA status is still "${statusLabel}" — status likely stale`,
    };
  }

  // ── No release markers available or none have passed yet ─────────────────
  // Fall back to JIRA status, then feature-level dates.

  if (s.includes('promotion gate met')) {
    return { phase: 'PG Met', rationale: `JIRA status = "${statusLabel}"` };
  }
  if (s.includes('commit gate met')) {
    return { phase: 'CG Met', rationale: `JIRA status = "${statusLabel}"` };
  }
  if (s.includes('code complete met')) {
    return { phase: 'CC Met', rationale: `JIRA status = "${statusLabel}"` };
  }

  // Past the feature's own CC date but not yet "met" → coding (late)
  if (codeCompleteDate && today && codeCompleteDate.getTime() < today.getTime()) {
    return { phase: 'Coding (late)', rationale: `Past Code Complete date (${isoDate(codeCompleteDate)}) but status is "${statusLabel}"` };
  }

  // Has FS/DS + Test Plan past today → coding
  const fsdsDone = fsdsDoneDate && today && fsdsDoneDate.getTime() <= today.getTime();
  const testPlanDone = testPlanDate && today && testPlanDate.getTime() <= today.getTime();
  if (fsdsDone && testPlanDone) {
    return { phase: 'Coding', rationale: 'FS/DS Done and Test Plan dates have passed' };
  }
  if (fsdsDoneDate || testPlanDate) {
    return { phase: 'Design', rationale: 'FS/DS or Test Plan dates set; design work in progress' };
  }
  return { phase: 'Inception', rationale: 'No FS/DS or Test Plan dates set yet' };
}

// ── Phase relevance filtering ───────────────────────────────────────────────
// Build the final PHASE_FOCUS list by removing entries the team marked N/A.
function buildPhaseFocus(phase, naDeclarations) {
  const relevance = PHASE_RELEVANCE[phase] || PHASE_RELEVANCE.Inception;
  const focus = [...(relevance.focus || [])];
  const ignore = [...(relevance.ignore || [])];

  // Map focus tokens → NA section keys; drop the focus entry if N/A.
  const focusToNAKey = {
    fsdsDone: 'techDesign',
    testPlan: 'testPlan',
    designDoc: null,
    requirementsLink: 'requirements',
    testPlanLink: null,
    codeComplete: null,
    codeCompleteOvershoot: null,
    extension: null,
    taskOutstanding: null,
    commitGate: null,
    securityFiled: 'securityReview',
    legalFiled: 'legal',
    securityClosed: 'securityReview',
    legalClosed: 'legal',
    manualQI: 'manualTesting',
    automationQI: 'automation',
    systemTestQI: 'systemTesting',
    longevityPerf: 'longevityPerf',
    openBugs: null,
    p0p1Open: null,
    residualP0P1: null,
    promotionGate: null,
    docsComplete: 'techPubs',
    docsFinal: 'techPubs',
    gaReadiness: null,
    confirmation: null,
    qi: null,
  };

  const filteredFocus = focus.filter(token => {
    const naKey = focusToNAKey[token];
    return !naKey || !naDeclarations[naKey];
  });

  const teamNA = Object.entries(naDeclarations)
    .filter(([, isNA]) => isNA)
    .map(([key]) => key);

  return { focus: filteredFocus, ignore, teamNA };
}

// ── Main: derive everything ─────────────────────────────────────────────────
/**
 * Derive structured signals for an executive summary.
 *
 * @param {object} params
 * @param {object} params.item           Raw JIRA item (with customfield_* fields)
 * @param {object} [params.ganttConfig]  Per-version gate marker dates (commitGate1/2, promotionGate1/2/3, ccm1Gate[])
 * @param {object} [params.breakdownData] Task breakdown for this item from taskBreakdownService
 * @param {object} [params.narrative]    Output of fetchTicketNarrative — used for compliance ticket lookup
 * @param {string} [params.release]      e.g. "NDB-2.11"
 * @param {Date}   [params.today]        Defaults to now (UTC midnight)
 * @returns {object} signals JSON for the prompt
 */
function deriveSignals({ item, ganttConfig = null, breakdownData = null, narrative = null, release = null, today = null, releaseContext = null }) {
  if (!item || !item.key) {
    throw new Error('deriveSignals: item.key is required');
  }
  const now = today ? new Date(today) : new Date();
  now.setHours(0, 0, 0, 0);

  // --- Raw fields
  const statusLabel = typeof item.status === 'string' ? item.status : (item.status?.name || '');
  const summary = item.summary || '';
  const riskRaw = item.customfield_23560;
  const jiraRiskIndicator = (riskRaw && typeof riskRaw === 'object') ? (riskRaw.value || riskRaw.name) : (riskRaw || null);

  // Risk Assessment (47780) + Path to Green (55664) — team narrative next to the RAG chip.
  // Mirrors evaluateTeamRiskContext in shared/src/services/riskIndicator.ts (keep in sync).
  const riskAssessmentText = extractNarrativeField(item.customfield_47780);
  const pathToGreenText = extractNarrativeField(item.customfield_55664);
  const teamRisk = evaluateTeamRiskNarrative(jiraRiskIndicator, riskAssessmentText, pathToGreenText);

  // --- Dates
  const fsdsDoneDate = parseDate(item.customfield_13861);
  const testPlanDate = parseDate(item.customfield_11068);
  const jiraCCDate = parseDate(item.customfield_11067);
  const extensionDate = detectExtensionLabel(item);
  const codeCompleteDate = extensionDate || jiraCCDate;
  const commitGateDate = parseDate(item.customfield_35863);
  const promotionGateDate = parseDate(item.customfield_35864);
  const statusUpdateDate = parseDate(item.customfield_45660);

  // --- Gate marker dates (from ganttConfig) — pick the BINDING (solid) gate
  // per family (e.g. CG2 over CG1, PG3 over PG1/PG2). The earlier dotted
  // checkpoints are deliberately ignored so the AI doesn't get confused
  // about which date the team actually has to hit.
  const bindingCCMMarker = getBindingMarker(ganttConfig, 'ccm');
  const bindingCGMarker = getBindingMarker(ganttConfig, 'commitGate');
  const bindingPGMarker = getBindingMarker(ganttConfig, 'promotionGate');
  const bindingGAMarker = getBindingMarker(ganttConfig, 'ga');
  const latestCCMMarker = bindingCCMMarker?.date || null;
  const latestCGMarker = bindingCGMarker?.date || null;
  const latestPGMarker = bindingPGMarker?.date || null;
  const latestGAMarker = bindingGAMarker?.date || null;

  // EC (Execute Commit) date is the start of the release runway. It lives
  // as a simple string at the top of the gantt config per release.
  const releaseECDate = parseDate(ganttConfig?.ecDate);

  // --- Gate gaps: the runway between consecutive release-level gates.
  // Reported in days AND weeks so the AI can comment on timeline pressure
  // (e.g. "only 3 weeks between CG and PG — compressed schedule").
  // Each gap is between the BINDING marker of one phase and the next; soft
  // dotted checkpoints are intentionally excluded.
  const computeGap = (from, to) => {
    if (!from || !to) return null;
    const days = daysBetween(from, to);
    if (days == null) return null;
    return { days, weeks: Math.round((days / 7) * 10) / 10 };
  };
  const gateGapsRaw = [
    { from: 'EC', to: 'CCM', fromDate: releaseECDate, toDate: latestCCMMarker },
    { from: 'CCM', to: 'CG', fromDate: latestCCMMarker, toDate: latestCGMarker },
    { from: 'CG', to: 'PG', fromDate: latestCGMarker, toDate: latestPGMarker },
    { from: 'PG', to: 'GA', fromDate: latestPGMarker, toDate: latestGAMarker },
  ];
  const gateGaps = gateGapsRaw
    .map(g => {
      const gap = computeGap(g.fromDate, g.toDate);
      if (!gap) return null;
      return {
        from: g.from,
        to: g.to,
        fromDate: isoDate(g.fromDate),
        toDate: isoDate(g.toDate),
        days: gap.days,
        weeks: gap.weeks,
      };
    })
    .filter(Boolean);

  const overshoot = (jiraDate, markerDate) => {
    if (!jiraDate || !markerDate) return null;
    const diff = daysBetween(markerDate, jiraDate);
    if (diff == null || diff === 0) return null;
    return diff > 0 ? `+${diff}d` : `${diff}d`;
  };

  // --- Documentation
  const requirementsLink = !!getStringValue(item.customfield_14463);
  const designDocLink = !!getStringValue(item.customfield_14464);
  const testPlanLink = !!getStringValue(item.customfield_14465);

  // --- Compliance (Security / Legal / Docs) — sourced from linked SDL/LEG/TECHPUBS
  // tickets (preferred, via narrative) with parent labels as a fallback hint.
  const compliance = detectCompliance(item, narrative?.compliance || null);
  const daysToLastCG = daysBetween(now, latestCGMarker || commitGateDate);
  // Required only when CG is still upcoming (daysToLastCG > 0) and within 21 days.
  // A negative value means CG has already passed — compliance window is closed.
  const complianceRequired = daysToLastCG != null && daysToLastCG >= 0 && daysToLastCG <= 21;

  // --- Latest passed release-level marker (objective calendar anchor)
  // This tells us which gate the release calendar says should already be cleared.
  // Computed before phase detection because detectPhase uses the marker dates.
  const latestPassedMarker = deriveLatestPassedMarker(now, {
    bindingCCMMarker, bindingCGMarker, bindingPGMarker, bindingGAMarker,
  });

  // --- Phase detection (date-first, JIRA status as fallback)
  const { phase, rationale: phaseRationale } = detectPhase({
    statusLabel, today: now, fsdsDoneDate, testPlanDate, codeCompleteDate,
    latestCCMMarker, latestCGMarker, latestPGMarker, latestGAMarker,
  });

  // --- Status update text parsing (NA + QI signals)
  const rawStatusText = getStringValue(item.customfield_23073);
  const naDeclarations = parseNADeclarations(rawStatusText);
  const quality = parseQualitySignals(rawStatusText);

  // --- Task breakdown
  const tasks = summariseBreakdown(breakdownData);

  // --- Status update age
  const statusUpdateAgeDays = statusUpdateDate ? daysBetween(statusUpdateDate, now) : null;

  // --- Next gate (closest future gate)
  const futureGates = [
    codeCompleteDate && codeCompleteDate >= now && { name: 'Code Complete', date: codeCompleteDate },
    commitGateDate && commitGateDate >= now && { name: 'Commit Gate', date: commitGateDate },
    promotionGateDate && promotionGateDate >= now && { name: 'Promotion Gate', date: promotionGateDate },
  ].filter(Boolean);
  futureGates.sort((a, b) => a.date - b.date);
  const nextGate = futureGates[0]
    ? { name: futureGates[0].name, date: isoDate(futureGates[0].date), daysUntil: daysBetween(now, futureGates[0].date) }
    : null;

  // --- People
  const extractName = (u) => {
    if (!u) return null;
    if (typeof u === 'string') return u;
    return u.displayName || u.name || u.emailAddress || null;
  };

  // --- Phase focus filtered by team N/A
  const { focus: phaseFocus, ignore: phaseIgnore, teamNA } = buildPhaseFocus(phase, naDeclarations);

  // --- Critical risks (deterministic — never let the AI miss these)
  // Each entry is a short imperative phrase the AI must lead with if present.
  const criticalRisks = [];

  // Gate overshoot of release marker is the most important release-level signal
  const ccOvershoot = parseOvershootDays(overshoot(jiraCCDate, latestCCMMarker));
  const cgOvershoot = parseOvershootDays(overshoot(commitGateDate, latestCGMarker));
  const pgOvershoot = parseOvershootDays(overshoot(promotionGateDate, latestPGMarker));

  // Helper to render "release-level <label> (<date>)" — falls back to a
  // generic label when the gantt config didn't include one.
  const markerRef = (binding, fallback) =>
    binding?.label
      ? `${binding.label} (${isoDate(binding.date)})`
      : `${fallback} marker (${isoDate(binding?.date)})`;

  // ── MISSED GATE: closest passed release marker vs. feature clearance ────────
  // If the release calendar says a gate has already passed, but the feature's
  // JIRA status has NOT been updated to confirm clearance, that is the highest-
  // priority signal for the verdict. The AI should treat this as RED unless
  // there is explicit evidence in the status update or narrative that the gate
  // was cleared informally.
  //
  // "Closest date that passed" rule: we use latestPassedMarker (the most
  // recently elapsed release-level gate) as the primary verdict anchor. If the
  // feature's phase does not reflect clearance of that gate, it failed that gate.
  if (latestPassedMarker) {
    const missedGate = (() => {
      const phaseOrder = { 'Inception': 0, 'Design': 1, 'Coding': 2, 'Coding (late)': 2,
                           'CC Met': 3, 'CG Met': 4, 'PG Met': 5, 'Shipped': 6 };
      const expectedOrder = { 'CC Met': 3, 'CG Met': 4, 'PG Met': 5, 'Shipped': 6 };
      const expected = expectedOrder[latestPassedMarker.expectedPhase] ?? -1;
      const actual = phaseOrder[phase] ?? -1;
      return actual < expected;
    })();
    if (missedGate) {
      const agePhrase = latestPassedMarker.daysAgo === 0 ? 'today'
                       : latestPassedMarker.daysAgo === 1 ? '1 day ago'
                       : `${latestPassedMarker.daysAgo} days ago`;
      criticalRisks.push(
        `MISSED GATE: The release-level ${latestPassedMarker.label} (${latestPassedMarker.date}) passed ${agePhrase}, but this feature's JIRA status is still "${statusLabel}" — it has not confirmed ${latestPassedMarker.expectedPhase}. Base the verdict primarily on this date gap. Treat as RED unless the status update text or narrative explicitly confirms the gate was cleared.`
      );
    }
  }

  // Gate slips are only forward release risks while the team has NOT yet cleared
  // the gate in question. Once jiraStatus reports the gate as Met, the team
  // accepted the late delivery and downstream phases moved on — keeping the
  // overshoot in criticalRisks here would force the system prompt's "lead with
  // most severe risk" rule to drag a PG-Met feature backwards into a stale CG
  // narrative. The historical overshoot numbers still live in
  // signals.dates.commitGate.overshootMarker / promotionGate.overshootMarker so
  // the prose layer can mention them as context where useful.
  const cgGateAlreadyMet = phase === 'CG Met' || phase === 'PG Met' || phase === 'Shipped';
  const pgGateAlreadyMet = phase === 'PG Met' || phase === 'Shipped';

  if (cgOvershoot != null && cgOvershoot > 0 && !cgGateAlreadyMet) {
    criticalRisks.push(
      `Commit Gate slipped: feature's CG estimate (${isoDate(commitGateDate)}) is ${cgOvershoot} days past the release-level ${markerRef(bindingCGMarker, 'CG')}. This is the binding Commit Gate (earlier CG checkpoints are not the cutoff).`
    );
  }
  if (pgOvershoot != null && pgOvershoot > 0 && !pgGateAlreadyMet) {
    criticalRisks.push(
      `Promotion Gate slipped: feature's PG estimate (${isoDate(promotionGateDate)}) is ${pgOvershoot} days past the release-level ${markerRef(bindingPGMarker, 'PG')}. This is the binding Promotion Gate (earlier PG checkpoints are not the cutoff).`
    );
  }
  if (ccOvershoot != null && ccOvershoot > 0 && phase !== 'CC Met' && phase !== 'CG Met' && phase !== 'PG Met' && phase !== 'Shipped') {
    criticalRisks.push(
      `Code Complete slipped: feature CC date (${isoDate(jiraCCDate)}) is ${ccOvershoot} days past the release-level ${markerRef(bindingCCMMarker, 'CCM')}. This is the binding Code Complete date (earlier CCM checkpoints are not the cutoff).`
    );
  }

  // Status update freshness — stale updates are a process risk
  if (statusUpdateAgeDays != null && statusUpdateAgeDays >= 14) {
    criticalRisks.push(`Status update is ${statusUpdateAgeDays} days old; signals may be out of date.`);
  }

  // Team risk narrative gaps (Yellow/Red without Assessment or Path to Green)
  for (const gap of teamRisk.gaps) {
    criticalRisks.push(gap);
  }

  // Compliance (security / legal / docs) within the 21-day CG window.
  //
  // Four-state model — only the first two are real release risks:
  //   1. No tickets and no label   → genuine gap, escalate.
  //   2. Tickets exist and any open near CG → in-flight, mention without RED-ing.
  //   3. Label only (no tickets)   → hygiene warning, not a release risk.
  //   4. Tickets all closed        → silent (no risk emitted).
  //
  // This replaces the previous label-only check that incorrectly fired
  // "Security review not filed" even when SDL-* / LEG-* tickets existed and
  // were already closed.
  if (complianceRequired && phase === 'CC Met') {
    const areas = [
      { key: 'security', label: 'Security review', project: 'SDL' },
      { key: 'legal', label: 'Legal review', project: 'LEG' },
      // TECHPUBS is tracked here for parity but isn't flagged at CC Met —
      // documentation closure is a CG Met / PG Met concern. See PHASE_RELEVANCE.
    ];
    for (const { key, label, project } of areas) {
      const state = compliance[key];
      if (!state.filed) {
        criticalRisks.push(
          `${label} not filed: no linked ${project}-* ticket found and Commit Gate is ${daysToLastCG} days away.`
        );
      } else if (state.labelOnly) {
        criticalRisks.push(
          `${label} tracked by label only — no linked ${project}-* ticket exists. Filing a real ticket is required before Commit Gate.`
        );
      }
      // state.filed && tickets exist && some open → handled as a softer
      // observation by the LLM via the compliance block in TICKET CONTEXT;
      // not lifted into criticalRisks so it doesn't force a RED.
    }
  }

  return {
    feature: {
      key: item.key,
      summary,
      release: release || null,
    },
    phase,
    phaseRationale,
    phaseFocus,
    phaseIgnore,
    teamNA,
    jiraStatus: statusLabel,
    jiraRiskIndicator,
    riskAssessment: teamRisk.assessment || null,
    pathToGreen: teamRisk.pathToGreen || null,
    teamRisk: {
      indicator: teamRisk.indicator,
      assessmentMissing: teamRisk.assessmentMissing,
      pathToGreenMissing: teamRisk.pathToGreenMissing,
      verdictFloor: teamRisk.verdictFloor,
      gaps: teamRisk.gaps,
    },
    people: {
      assignee: extractName(item.assignee),
      qaContact: extractName(item.customfield_10860),
      tpmOwner: extractName(item.customfield_27764),
    },
    statusUpdate: {
      lastUpdatedDate: isoDate(statusUpdateDate),
      ageDays: statusUpdateAgeDays,
      hasText: !!rawStatusText,
    },
    dates: {
      fsdsDone: {
        value: isoDate(fsdsDoneDate),
        daysAgo: fsdsDoneDate ? daysBetween(fsdsDoneDate, now) : null,
        done: fsdsDoneDate ? fsdsDoneDate.getTime() <= now.getTime() : false,
      },
      testPlan: {
        value: isoDate(testPlanDate),
        daysAgo: testPlanDate ? daysBetween(testPlanDate, now) : null,
        done: testPlanDate ? testPlanDate.getTime() <= now.getTime() : false,
      },
      codeComplete: {
        value: isoDate(jiraCCDate),
        effectiveValue: isoDate(codeCompleteDate),
        daysUntil: codeCompleteDate ? daysBetween(now, codeCompleteDate) : null,
        overshootMarker: overshoot(jiraCCDate, latestCCMMarker),
        extension: isoDate(extensionDate),
      },
      commitGate: {
        value: isoDate(commitGateDate),
        daysUntil: commitGateDate ? daysBetween(now, commitGateDate) : null,
        overshootMarker: overshoot(commitGateDate, latestCGMarker),
      },
      promotionGate: {
        value: isoDate(promotionGateDate),
        daysUntil: promotionGateDate ? daysBetween(now, promotionGateDate) : null,
        overshootMarker: overshoot(promotionGateDate, latestPGMarker),
      },
    },
    // markers reports the BINDING gate per family (e.g. CG2 / PG2 / CCM2 when
    // present). Earlier dotted checkpoints are intentionally not surfaced so
    // the AI compares the feature's date only against the cut-off that
    // actually matters. The `label` field carries the human-readable gate
    // name straight from the gantt config (e.g. "Commit Gate 2").
    markers: {
      ec: isoDate(releaseECDate),
      ccm: bindingCCMMarker ? { date: isoDate(latestCCMMarker), label: bindingCCMMarker.label, style: bindingCCMMarker.style } : null,
      commitGate: bindingCGMarker ? { date: isoDate(latestCGMarker), label: bindingCGMarker.label, style: bindingCGMarker.style } : null,
      promotionGate: bindingPGMarker ? { date: isoDate(latestPGMarker), label: bindingPGMarker.label, style: bindingPGMarker.style } : null,
      ga: bindingGAMarker ? { date: isoDate(latestGAMarker), label: bindingGAMarker.label, style: bindingGAMarker.style } : null,
      // Back-compat flat dates so any older consumer keeps working.
      latestCCM: isoDate(latestCCMMarker),
      latestCG: isoDate(latestCGMarker),
      latestPG: isoDate(latestPGMarker),
      latestGA: isoDate(latestGAMarker),
    },
    // Inter-gate runway, in days and weeks. Use these to comment on schedule
    // compression. Rule of thumb: ~6 weeks per phase is typical; less than
    // 3 weeks between consecutive gates implies a compressed runway.
    gateGaps,
    // The most recent release-level gate whose date has already passed.
    // This is the primary verdict anchor — "base verdict on closest date that passed."
    // null when no markers are configured or none have elapsed.
    latestPassedMarker,
    links: {
      requirements: requirementsLink,
      designDoc: designDocLink,
      testPlan: testPlanLink,
    },
    // Compliance is only surfaced when there's actual signal to act on. Once
    // the team has passed CG, empty compliance buckets are noise — leaving them
    // in the signals JSON tempts the model to fabricate "security/legal/docs
    // unfiled" claims at PG Met (observed on FEAT-18271). We keep compliance
    // visible whenever any bucket has open tickets (real in-flight work that
    // matters at any phase) and at pre-CG-Met phases (when filing is still a
    // forward concern). At CG Met / PG Met / Shipped with no open tickets,
    // we null it out entirely so the AI can't riff on absent fields.
    compliance: shouldSurfaceCompliance(phase, compliance) ? {
      required: complianceRequired,
      daysToLastCG,
      security: compliance.security,
      legal: compliance.legal,
      docs: compliance.docs,
    } : null,
    tasks,
    quality,
    notApplicable: naDeclarations,
    nextGate,
    criticalRisks,
    // Release-level aggregate context supplied by the client from
    // /api/jira/executive-summary-unified. Null when unavailable —
    // the prompt layer gracefully omits the RELEASE CONTEXT block.
    releaseContext: releaseContext ? {
      totalProjects: releaseContext.totalProjects || null,
      riskCounts: releaseContext.riskCounts || null,
      p0BugsCount: releaseContext.p0BugsCount != null ? releaseContext.p0BugsCount : null,
      daysFromPG: releaseContext.daysFromPG != null ? releaseContext.daysFromPG : null,
      currentPGDate: releaseContext.currentPGDate || null,
      currentCGDate: releaseContext.currentCGDate || null,
    } : null,
  };
}

module.exports = {
  deriveSignals,
  PHASE_RELEVANCE,
  // Exposed for unit tests
  _internals: {
    parseNADeclarations,
    parseQualitySignals,
    detectPhase,
    detectExtensionLabel,
    detectCompliance,
    shouldSurfaceCompliance,
    extractComplianceFromItemLinks,
    getBindingMarker,
    getLatestMarkerDate,
    buildPhaseFocus,
  },
};
