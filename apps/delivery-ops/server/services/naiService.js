/**
 * Nutanix Enterprise AI (NAI) Service
 *
 * OpenAI-compatible API wrapper for the corp NAI endpoint.
 *
 * For executive summaries: we pass NAI a deterministic signals JSON (computed
 * by execSummarySignals.js) plus the raw status update text. The prompt is
 * structured as a system message (output contract + constraints) + user
 * message (signals + raw text). Phase-aware focus/ignore lists prevent the
 * model from rambling about earlier-phase fields that no longer matter.
 */

const axios = require('axios');
const https = require('https');

const NAI_BASE_URL = process.env.AI_API_BASE_URL || 'https://dpro-nai.corp.p10y.ntnxdpro.com/enterpriseai/v1';
const NAI_API_KEY = process.env.AI_API_KEY;
const NAI_MODEL = process.env.AI_DEFAULT_MODEL || 'eng-pool-05';
const NAI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '4096', 10);
const NAI_TIMEOUT = parseInt(process.env.AI_REQUEST_TIMEOUT || '30000', 10);

// Self-signed cert on corp endpoint — mirrors curl -k
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const MAX_STATUS_TEXT_CHARS = 1500;

// ── System message: enforced output contract ────────────────────────────────
const EXEC_SUMMARY_SYSTEM_PROMPT = `You are an executive technical program manager at Nutanix writing release status summaries for engineering features. You write like a senior TPM who has read the ticket — not like a script that lists fields.

OUTPUT FORMAT (strict):
1. RAG verdict: start with exactly "GREEN:", "YELLOW:", or "RED:"
2. Two sentences explaining current health using concrete numbers AND the cause behind those numbers
3. One sentence with a product-level path to GREEN (see PATH TO GREEN — phase-gated)
Note: Shipped phase is a single-sentence GREEN confirmation only (no sentence 2 or 3).

REASONING REQUIREMENTS (the most important section — read this twice):
- Do NOT recite SIGNALS verbatim. Signals are evidence, not the verdict.
- Every claim about a slip, gap, or risk MUST connect to a cause from TICKET CONTEXT (description, comments, linked blockers, subtasks, status transitions) when the narrative explains it.
- When you mention a blocker, name the linked JIRA key from the LINKED BLOCKERS section and describe its impact in plain language.
- If the narrative does NOT explain a gap, say so as a finding: "no comment activity for N days explaining the gate slip" — silence is itself a signal.
- Never produce a sentence of the form "X is not reported, Y is incomplete, Z is unavailable" as a list of gaps. If absence matters, state what the absence implies and the action that closes it; if it does not matter at this phase, omit it.
- Use causality language: "slipped because", "blocked by", "stalled since", "recovered after". Never report a number without a "why" when the narrative provides one.
- If a recent comment names a person, a date, or another ticket key relevant to the assessment, weave that detail in.

RULES:
- Only discuss signals listed in PHASE_FOCUS.
- Never mention signals listed in PHASE_IGNORE.
- If a signal appears in TEAM_NA, the team has declared it not applicable for this feature. Never flag it as missing or a gap.
- Use exact numbers from SIGNALS — never "some", "a few", or estimates.
- Do not repeat the JIRA key or feature name of the current ticket — the reader knows what they are looking at.
- No bullets, no markdown, no headings — flowing prose only.
- Under 80 words total.
- When RELEASE CONTEXT is present: use it to calibrate urgency language — do NOT repeat portfolio counts in the prose unless they directly justify the verdict. A sole RED feature in an otherwise green release gets "targeted escalation" language; a RED feature in a release where many others are RED signals systemic delivery pressure — phrase accordingly. Never fabricate portfolio numbers not present in RELEASE CONTEXT.

CITE-OR-DON'T-CLAIM (zero-tolerance rule):
- Every negative noun in your output — "slipped", "stalled", "blocked", "unfiled", "missing", "overdue", "incomplete", "pending", "drifting", "stalled" — MUST cite a specific source row visible to you in this prompt.
- Accepted sources: a SIGNAL field (name it: "tasks.trulyOpenCount = 2"), a CRITICAL_RISK entry (quote the leading phrase), a COMPLIANCE TICKETS row (cite the SDL/LEG/TECHPUBS key), a LINKED BLOCKERS row (cite the key), an OUTSTANDING SUBTASKS row (cite the key), or a RECENT COMMENTS line (quote ≤8 words).
- No source row in the prompt = no claim in the output. Do not infer gaps from absent fields or empty sections.

VERDICT FLOOR (phase-conditioned ceilings — hard rule):
- A feature in PHASE = "PG Met" cannot be RED unless TICKET CONTEXT contains explicit de-promotion evidence: a RECENT STATUS TRANSITIONS row leaving "PG Met", a newly-opened P0/P1 LINKED BLOCKER, or a RECENT COMMENT (<14 days) naming a GA blocker by ticket key. Default verdict at PG Met is GREEN; downgrade to YELLOW only with a cited reason; downgrade to RED only with cited de-promotion evidence.
- A feature in PHASE = "Shipped" is ALWAYS a one-sentence GREEN confirmation. No analysis, no recommendations, no risk language.
- A feature in PHASE = "CG Met" cannot be RED unless an open P0/P1 in LINKED BLOCKERS or OUTSTANDING SUBTASKS is named in your output.

CLOSEST-DATE-THAT-PASSED RULE (primary verdict anchor):
- SIGNALS.latestPassedMarker contains the most recent release-level gate whose date has already elapsed. This is your PRIMARY anchor for the verdict — more reliable than JIRA status, which is often stale.
- If latestPassedMarker is non-null, ask: has the feature confirmed clearance of that gate? Use this logic:
    CC Met expected: SIGNALS.jiraStatus must include "Code Complete Met", "Commit Gate Met", "Promotion Gate Met", or "Closed/Shipped" — otherwise treat gate as NOT cleared.
    CG Met expected: SIGNALS.jiraStatus must include "Commit Gate Met", "Promotion Gate Met", or "Closed/Shipped".
    PG Met expected: SIGNALS.jiraStatus must include "Promotion Gate Met" or "Closed/Shipped".
- If the gate has passed but jiraStatus does NOT confirm clearance → the feature FAILED that gate. The verdict is RED by default unless the status update text or a RECENT COMMENT (<14 days) contains explicit words like "gate cleared", "approved", "passed" for that specific gate.
- When CRITICAL_RISKS contains a "MISSED GATE" entry, treat it as your sentence-1 lead and set verdict to RED.
- The daysAgo field on latestPassedMarker quantifies urgency: ≤7 days = borderline (YELLOW if no other RED signals), 8–21 days = significant miss (RED), >21 days = severe miss (RED + escalation language).

STATUS AUTHORITATIVE (JIRA status for cleared gates only):
- When SIGNALS.jiraStatus reports a gate as Met AND the release calendar date for that gate has passed, the gate is cleared.
- When SIGNALS.jiraStatus reports a gate as Met BUT the latestPassedMarker.expectedPhase indicates a higher gate is now due and not cleared, do NOT treat the feature as green — the new gate takes priority.
- Historical overshootMarker values for already-cleared gates are bookkeeping, NOT a forward risk. Never use a cleared-gate overshoot to justify a downgraded verdict.
- You may mention historical slip as context once ("CG was met N days late") but it must not lead sentence 1 and must not be the verdict reason.

JIRA RISK INDICATOR ALIGNMENT:
- SIGNALS.jiraRiskIndicator (Green / Yellow / Red) is the team's own attestation. When non-null, your RAG verdict should match it.
- If you diverge, sentence 1 MUST cite the specific evidence justifying the divergence (a CRITICAL_RISK entry quoted, an open P0/P1 blocker named, or a comment within 14 days naming a regression).
- Never silently override the team's attestation. If you have no cited justification, align with jiraRiskIndicator.

COMMENT STALENESS FLOOR:
- Do NOT characterise work as "stalled", "drifting", or "lost engagement" unless the COMMENT FRESHNESS section appears in TICKET CONTEXT. That section is emitted by the server only when the last comment is ≥14 days old.
- Comments under 14 days old are healthy by definition. Never invent staleness by counting raw comment-age numbers yourself.

COMPLIANCE RULE (security / legal / documentation):
- The COMPLIANCE TICKETS section of TICKET CONTEXT is authoritative. It is derived from real linked SDL-*, LEG-*, and TECHPUBS-* tickets and their JIRA status.
- If a compliance area shows "all CLOSED", that area is DONE. Do NOT call it unfiled, incomplete, missing, or a gap. Do NOT recommend filing it.
- If a compliance area shows "some still open", describe it as in-flight with the specific JIRA keys — never as "unfiled".
- If a compliance area shows "no linked tickets found", and CRITICAL_RISKS contains a matching "not filed" entry, treat it as a real gap and lead accordingly.
- When CRITICAL_RISKS and COMPLIANCE TICKETS disagree (e.g. a risk says "Legal review not filed" but COMPLIANCE TICKETS shows LEG-123 Closed), trust COMPLIANCE TICKETS and omit the risk.
- If the entire COMPLIANCE TICKETS section is ABSENT from this prompt (signals.compliance was null), the server has determined compliance is not in play at this phase. Do NOT mention security, legal, or docs at all — there is no source row to cite.

TASKS RULE (open vs awaiting QA verification):
- When SIGNALS.tasks.totalToBeVerified > 0, those tickets are sitting on QA verification (JIRA status = Resolved). They are NOT open dev work and NOT stalled — they are queued for QA sign-off.
- Use the exact phrasing template: "N truly open, M awaiting QA verification" (where N = trulyOpenCount, M = totalToBeVerified). Never sum them as "X tasks open" or "X outstanding".
- Never describe TBV tickets as "stalled", "open dev work", "blocking", or "in progress".

CRITICAL RISKS (highest priority — read CRITICAL_RISKS in the user message):
- If CRITICAL_RISKS is non-empty, sentence 1 MUST lead with the most severe item (gate overshoot beats security/legal beats stale update).
- Gate overshoot (when it appears in CRITICAL_RISKS) is the most important release-level signal. When the deterministic risks layer includes a gate-slip entry, the team has missed a release checkpoint they have NOT yet cleared — always state both the feature date and the marker overshoot.
- A feature with a CG/PG slip IN CRITICAL_RISKS cannot be GREEN. At minimum YELLOW; usually RED.
- IMPORTANT: CRITICAL_RISKS already accounts for phase. If a gate has been Met (CG Met / PG Met / Shipped), the server intentionally omits its slip from CRITICAL_RISKS. You must not re-derive a "CG slipped" claim from raw overshoot numbers in SIGNALS.dates when the corresponding gate is Met.

GATE COMPARISON:
- "daysUntil" describes the feature's own estimated date relative to today.
- "overshootMarker" describes the same date relative to the release-level BINDING gate (e.g. CG2 — the final commit gate, not CG1). Earlier dotted checkpoints (CG1, PG1, CCM1) are deliberately excluded from the comparison and must not be mentioned.
- A positive overshoot means the binding release-level gate has already passed.
- Never report one without the other when overshoot is positive AND the corresponding gate is not yet Met.
- When naming a gate, use the label from "markers.commitGate.label" / "markers.promotionGate.label" / "markers.ccm.label" (e.g. "Commit Gate 2") when present, not a bare date.

PATH TO GREEN (sentence 3 — PHASE-GATED ALLOW-LIST):
The recovery move you recommend must be appropriate for the feature's current phase. Use this allow-list:

- Inception / Design / Coding / Coding (late) / CC Met:
    allowed → deferral to next release, scope cut, extension request, escalation of named LINKED BLOCKER, RM approval for date push
- CG Met:
    allowed → escalation of a NAMED open P0/P1 from LINKED BLOCKERS or OUTSTANDING SUBTASKS, scope cut of specific bugs to next release
    forbidden → "defer the feature", "request an extension", "escalate the schedule" (the gate is cleared; these are non-actionable)
- PG Met:
    allowed → close residual P0/P1 bugs (name them by key), finalise documentation tickets (name TECHPUBS-* by key), confirm GA readiness against the GA checklist
    forbidden → defer, extend, escalate the schedule, file security/legal (gate is cleared; the feature is heading to GA, not back to dev)
- Shipped:
    no recovery sentence at all — output is one sentence only.

Filing missing tickets (security, legal, etc.) is hygiene — only acceptable as the next step at Inception → CC Met when CRITICAL_RISKS explicitly lists a "not filed" entry. Never recommend "file SDL/LEG/TECHPUBS" at CG Met or later.

CONFLICT HANDLING:
- Never override SIGNALS data with a contradictory free-text claim — SIGNALS always wins for dates and counts.
- If SIGNALS and the raw text disagree on a date or count, surface the discrepancy as a risk: "...status update mentions X but JIRA shows Y — owner should reconfirm."
- If TICKET CONTEXT is empty or absent, fall back to SIGNALS-only reasoning but explicitly note "no comment activity to explain the slip" rather than fabricating context.

PHASE-SPECIFIC GUIDANCE:
- Inception / Design: judge readiness on FS/DS Done Date, Test Plan Date, Design Doc link, Requirements link. Code Complete proximity matters as time pressure.
- Coding: judge by Code Complete date proximity, outstanding task count, and any extension labels.
- CC Met: judge by Commit Gate proximity AND its overshoot against the release marker, Security/Legal filing, manual & system test QI%, open bug count.
- CG Met: judge by Promotion Gate proximity AND its overshoot, P0/P1 bug closure, automation QI, longevity/perf signals, doc completeness. CG itself is cleared — do not relitigate it.
- PG Met: judge ONLY by residual P0/P1 issues, doc finalisation, and GA readiness. Do not relitigate CG, security filing, or general task counts. Default verdict GREEN unless cited residual risk.
- Shipped: confirm completion in one sentence; no further analysis.

OUTPUT QUALITY — examples to internalise:

BAD #1 (CC Met — reads as a translation of SIGNALS):
"RED: Commit Gate slipped 24 days past marker. Security and legal filings incomplete (0 of 2). Automation QI, system test QI, longevity not reported. Escalate schedule and defer non-critical bugs."

Why it's bad: lists gaps with no causes, no narrative grounding, generic next step, recites SIGNALS verbatim.

GOOD #1 (CC Met — narrative-grounded RED):
"RED: CG is already 24 days past the release-level marker because the AOS storage driver fix (AOS-44521) has not landed; comments show the team has been waiting since 14 Apr with no movement. Security and legal are unfiled and the most recent comment is 11 days old, suggesting the work itself has stalled. Either escalate AOS-44521 to the AOS leads this week or formally defer this feature to NDB-2.12 — recovery inside the current release window is not realistic."

Why it's good: leads with the structural risk, connects the slip to a specific blocker (AOS-44521 with a date), interprets comment-silence as a finding (cited COMMENT FRESHNESS), names the specific action with a real target.

BAD #2 (PG Met — verdict contradicts status, fabricates gaps, non-actionable recovery — this is what we are explicitly stopping):
"RED: Commit Gate is 16 days past the release-level CG marker (2026-04-13) because the CG estimate of 2026-04-29 was missed, leaving the checkpoint overdue. Promotion gate passed on 2026-05-11 (9 days ago) but security, legal and docs reviews remain unfiled and eight tasks (5 bugs, 2 improvements, 1 feature) are still open, with the last comment 6 days ago, showing work stalled. Deferring the feature to the next NDB-2.12 release is the realistic path to restore schedule compliance."

Why it's bad: (a) verdict RED contradicts jiraStatus = PG Met and jiraRiskIndicator = Yellow with no cited de-promotion evidence; (b) leads with a CG slip that the server intentionally suppressed from CRITICAL_RISKS because the gate is cleared; (c) fabricates "security, legal, docs unfiled" when the COMPLIANCE TICKETS section is absent from the prompt; (d) sums TBV tickets into "8 tasks still open" instead of using "N truly open, M awaiting QA verification"; (e) calls a 6-day-old comment "stalled" without a COMMENT FRESHNESS section in the prompt; (f) recommends deferral, which is forbidden at PG Met per PATH TO GREEN.

GOOD #2 (PG Met — aligned with status, splits TBV correctly, phase-appropriate recovery):
"GREEN: PG met on 11 May with 2 truly open P2 bugs and 6 awaiting QA verification, none flagged as P0/P1 or GA-blocking. CG was met 16 days late but the gate is cleared and TECHPUBS-1234 / TECHPUBS-1235 closed last week. On track for the 25 May GA target — close the residual P2s and confirm the GA-readiness checklist."

Why it's good: verdict aligns with PG Met status; uses exact "N truly open, M awaiting QA verification" phrasing; mentions CG slip ONCE as historical context (not as the reason); names specific TECHPUBS keys; recovery sentence is phase-appropriate (no defer, no extend).

GOOD #3 (Shipped — single sentence):
"GREEN: Feature shipped with NDB-2.10."

Why it's good: one sentence, no analysis, no risk language. Shipped means done.`;

// ── Ticket context builder ──────────────────────────────────────────────────
// Formats the narrative object (from jiraTicketNarrative.js) into a
// human-readable block the AI can scan top-to-bottom. Returns a string with
// only the populated sections — empty narrative pieces are omitted so the
// model doesn't see noise like "RECENT COMMENTS: (empty)".
function buildTicketContext(narrative) {
  if (!narrative) {
    return 'TICKET CONTEXT: not available (narrative fetch failed or empty — rely on SIGNALS and RAW STATUS UPDATE only).';
  }

  const sections = [];

  if (narrative.description) {
    sections.push(`DESCRIPTION:\n${narrative.description}`);
  }

  if (Array.isArray(narrative.comments) && narrative.comments.length > 0) {
    const lines = narrative.comments.map(c => {
      const age = c.ageDays != null ? `${c.ageDays}d ago` : 'recent';
      return `  [${age}, ${c.author}] ${c.body}`;
    });
    sections.push(`RECENT COMMENTS (most recent first, last ${narrative.comments.length}):\n${lines.join('\n')}`);
  } else {
    // Comment silence is itself a signal — surface it explicitly.
    sections.push('RECENT COMMENTS: none in the last 90 days. Long comment silence may itself indicate the work has stalled or moved off-ticket.');
  }

  if (Array.isArray(narrative.blockers) && narrative.blockers.length > 0) {
    const lines = narrative.blockers.map(b =>
      `  - ${b.key} (${b.relationship}, ${b.status}): ${b.summary}`
    );
    sections.push(`LINKED BLOCKERS:\n${lines.join('\n')}`);
  }

  // Compliance tickets (SDL/LEG/TECHPUBS) — authoritative source for
  // "is security/legal/docs filed and closed?". When these tickets exist
  // and are Closed, the AI must NOT report security/legal as "unfiled" —
  // the deterministic CRITICAL_RISKS list is built to honour that, and
  // this block gives the model the evidence to reason from.
  if (narrative.compliance && typeof narrative.compliance === 'object') {
    const areas = [
      { key: 'security', label: 'Security (SDL)' },
      { key: 'legal', label: 'Legal (LEG)' },
      { key: 'docs', label: 'Documentation (TECHPUBS)' },
    ];
    const complianceLines = [];
    for (const { key, label } of areas) {
      const tickets = Array.isArray(narrative.compliance[key]) ? narrative.compliance[key] : [];
      if (tickets.length === 0) {
        complianceLines.push(`  - ${label}: no linked tickets found.`);
        continue;
      }
      const allClosed = tickets.every(t => t.closed);
      const verdict = allClosed
        ? 'all CLOSED — treat as complete, do not flag as unfiled'
        : 'some still open — mention as in-flight, do not flag as unfiled';
      const ticketStr = tickets.map(t => `${t.key} (${t.status})`).join(', ');
      complianceLines.push(`  - ${label}: ${ticketStr} — ${verdict}.`);
    }
    sections.push(`COMPLIANCE TICKETS (authoritative — overrides any label-based "unfiled" hint):\n${complianceLines.join('\n')}`);
  }

  if (Array.isArray(narrative.outstandingSubtasks) && narrative.outstandingSubtasks.length > 0) {
    const lines = narrative.outstandingSubtasks.map(s =>
      `  - ${s.key} (${s.status}): ${s.summary}`
    );
    sections.push(`OUTSTANDING SUBTASKS (top ${narrative.outstandingSubtasks.length}):\n${lines.join('\n')}`);
  }

  if (Array.isArray(narrative.recentStatusTransitions) && narrative.recentStatusTransitions.length > 0) {
    const lines = narrative.recentStatusTransitions.map(t => {
      const age = t.ageDays != null ? `${t.ageDays} days ago` : 'recent';
      return `  - ${age}: ${t.from} -> ${t.to} (by ${t.by})`;
    });
    sections.push(`RECENT STATUS TRANSITIONS:\n${lines.join('\n')}`);
  }

  if (narrative.lastCommentAgeDays != null && narrative.lastCommentAgeDays >= 14) {
    sections.push(`COMMENT FRESHNESS: last comment was ${narrative.lastCommentAgeDays} days ago — consider whether the team has lost engagement on this ticket.`);
  }

  return `TICKET CONTEXT (read this first — this is what is actually happening, the WHY behind the numbers):\n\n${sections.join('\n\n')}`;
}

// Build a one-line summary of the release-level runway between consecutive
// binding gates. Surfaces schedule compression to the model without it having
// to dig into the raw JSON. Returns null when no gaps could be computed.
function buildGateGapsLine(gateGaps) {
  if (!Array.isArray(gateGaps) || gateGaps.length === 0) return null;
  const parts = gateGaps.map(g => `${g.from}→${g.to}: ${g.weeks}w`);
  return `RELEASE RUNWAY (binding gates only): ${parts.join(' | ')}. Comment on compression if any gap is under 3 weeks; ~6 weeks is typical.`;
}

// ── User message builder ────────────────────────────────────────────────────
function buildReleaseContextBlock(releaseContext) {
  if (!releaseContext) return null;
  const { totalProjects, riskCounts, p0BugsCount, daysFromPG, currentPGDate, currentCGDate } = releaseContext;
  const rc = riskCounts || {};
  const lines = [
    `Total commit projects: ${totalProjects ?? 'unknown'}`,
    rc.red != null || rc.yellow != null || rc.green != null
      ? `Portfolio risk distribution: ${rc.red ?? 0} RED / ${rc.yellow ?? 0} YELLOW / ${rc.green ?? 0} GREEN${rc.notSet != null ? ` / ${rc.notSet} not set` : ''}`
      : null,
    p0BugsCount != null ? `Release-wide P0 blockers: ${p0BugsCount}` : null,
    daysFromPG != null
      ? `Days to Promotion Gate: ${daysFromPG}${currentPGDate ? ` (${currentPGDate})` : ''}`
      : currentPGDate
        ? `Promotion Gate: ${currentPGDate}`
        : null,
    currentCGDate ? `Commit Gate: ${currentCGDate}` : null,
  ].filter(Boolean);

  if (lines.length === 0) return null;

  return [
    'RELEASE CONTEXT (portfolio health for this release — use to calibrate urgency, do NOT recite counts verbatim in prose):',
    ...lines.map(l => `  - ${l}`),
    '  Calibration rule: a RED feature in a mostly-green release (≤2 RED of 25+) signals isolated risk requiring targeted escalation; a RED feature in a release where 8+ projects are RED signals systemic delivery pressure — phrase urgency accordingly.',
  ].join('\n');
}

function buildUserPrompt(signals, narrative, rawStatusText) {
  const today = new Date().toISOString().slice(0, 10);
  const phaseFocusList = (signals.phaseFocus || []).join(', ') || 'none';
  const phaseIgnoreList = (signals.phaseIgnore || []).join(', ') || 'none';
  const teamNAList = (signals.teamNA || []).join(', ') || 'none';
  const gateGapsLine = buildGateGapsLine(signals.gateGaps);
  const releaseContextBlock = buildReleaseContextBlock(signals.releaseContext);

  const lpm = signals.latestPassedMarker;
  const latestPassedMarkerLine = lpm
    ? `LATEST_PASSED_GATE: ${lpm.label} (${lpm.date}) — passed ${lpm.daysAgo === 0 ? 'today' : lpm.daysAgo === 1 ? '1 day ago' : `${lpm.daysAgo} days ago`}. Expected feature phase: ${lpm.expectedPhase}. Actual phase: ${signals.phase}. ${signals.phase === lpm.expectedPhase || (lpm.expectedPhase === 'CC Met' && ['CC Met','CG Met','PG Met','Shipped'].includes(signals.phase)) || (lpm.expectedPhase === 'CG Met' && ['CG Met','PG Met','Shipped'].includes(signals.phase)) || (lpm.expectedPhase === 'PG Met' && ['PG Met','Shipped'].includes(signals.phase)) ? 'Gate CLEARED ✓' : 'Gate NOT confirmed — see CRITICAL_RISKS.'}`
    : null;

  const trimmedText = rawStatusText
    ? rawStatusText.length > MAX_STATUS_TEXT_CHARS
      ? rawStatusText.slice(0, MAX_STATUS_TEXT_CHARS) + '\n[... truncated ...]'
      : rawStatusText
    : null;

  const ageInfo = signals.statusUpdate?.ageDays != null
    ? `last edited ${signals.statusUpdate.ageDays} day${signals.statusUpdate.ageDays === 1 ? '' : 's'} ago`
    : 'edit date unknown';

  const rawBlock = trimmedText
    ? `RAW STATUS UPDATE (${ageInfo}) — the team's 20-point self-attestation. Treat it as one input among many; comments and links often have fresher truth:\n${trimmedText}`
    : `RAW STATUS UPDATE: Not provided or empty.`;

  // Critical risks float to the top — these must be addressed in sentence 1
  // when present (per the system prompt's CRITICAL RISKS rule).
  const risks = signals.criticalRisks || [];
  const criticalBlock = risks.length > 0
    ? `CRITICAL_RISKS (deterministic; sentence 1 must lead with the most severe):\n${risks.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`
    : `CRITICAL_RISKS: none`;

  const ticketContextBlock = buildTicketContext(narrative);

  return `TODAY: ${today}
PHASE: ${signals.phase}
PHASE_RATIONALE: ${signals.phaseRationale}
PHASE_FOCUS: ${phaseFocusList}
PHASE_IGNORE: ${phaseIgnoreList}
TEAM_NA: ${teamNAList}
${latestPassedMarkerLine ? latestPassedMarkerLine + '\n' : ''}${gateGapsLine ? gateGapsLine + '\n' : ''}${releaseContextBlock ? releaseContextBlock + '\n\n' : ''}
${criticalBlock}

${ticketContextBlock}

SIGNALS (supporting evidence — DO NOT recite verbatim; use to back claims with exact numbers):
${JSON.stringify(signals, null, 2)}

${rawBlock}

Write the executive summary now.

REMEMBER:
- Sentence 1 must lead with the most severe CRITICAL_RISK (if any) AND connect it to a cause from TICKET CONTEXT when the comments / blockers / subtasks explain it.
- Sentence 2 must add concrete narrative evidence — a named blocker key, a stale-comment count, a status-transition fact, or a quote from a recent comment — not another list of missing fields.
- Sentence 3 must describe a product-level path back to GREEN with a specific named target (escalate <key> to <person/team>, request <N>-week extension, defer to <next release>) — never generic hygiene.
- Under 80 words. Flowing prose. No bullets. No markdown.`;
}

// ── Low-level NAI call ──────────────────────────────────────────────────────
async function chatCompletion(messages, options = {}) {
  if (!NAI_API_KEY) {
    throw new Error('NAI API key not configured. Set AI_API_KEY in server/.env');
  }
  const response = await axios.post(
    `${NAI_BASE_URL}/chat/completions`,
    {
      model: NAI_MODEL,
      messages,
      max_tokens: options.maxTokens || NAI_MAX_TOKENS,
      stream: false,
      temperature: options.temperature ?? 0.3, // low temp for deterministic exec prose
    },
    {
      headers: {
        Authorization: `Bearer ${NAI_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      httpsAgent,
      timeout: NAI_TIMEOUT,
    }
  );

  const choice = response.data?.choices?.[0];
  if (!choice) {
    const err = new Error('NAI returned no choices in response');
    err.naiDebug = { rawBody: response.data };
    throw err;
  }
  const content = choice.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    // Surface the diagnostic info so the route can log and the client can react.
    const err = new Error(
      `NAI returned empty content (finish_reason=${choice.finish_reason || 'unknown'}). ` +
      `Try regenerating; if persistent, the prompt may be exceeding the model's effective budget.`
    );
    err.naiDebug = {
      finishReason: choice.finish_reason,
      usage: response.data?.usage,
      role: choice.message?.role,
      contentLength: content == null ? 'null' : content.length,
    };
    throw err;
  }
  return content;
}

// ── Public API ──────────────────────────────────────────────────────────────
/**
 * Generate an executive summary for a single JIRA item using phase-aware
 * signals plus ticket narrative.
 *
 * @param {object} signals - Output of execSummarySignals.deriveSignals(...)
 * @param {object|null} [narrative] - Output of jiraTicketNarrative.fetchTicketNarrative(...).
 *   Pass null if narrative fetch failed — the prompt falls back to signals-only
 *   reasoning and the model is instructed to note the absence rather than fabricate.
 * @param {string} [rawStatusText] - Raw status update text (customfield_23073)
 * @returns {Promise<string>} Hybrid-format exec summary (non-empty, trimmed)
 */
async function generateExecSummary(signals, narrative = null, rawStatusText = null) {
  const messages = [
    { role: 'system', content: EXEC_SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(signals, narrative, rawStatusText) },
  ];
  // Don't cap max_tokens below NAI_MAX_TOKENS (env default = 4096). eng-pool-05
  // is a reasoning model that consumes large amounts of tokens on hidden internal
  // reasoning before emitting any visible content. A 600-token cap was burned
  // entirely by reasoning, leaving empty visible content (finish_reason=length).
  // The actual prose output is ≤80 words (~120 tokens); the rest is reasoning room.
  const text = await chatCompletion(messages, { temperature: 0.3 });
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('NAI returned an empty executive summary after trim');
  }
  return trimmed;
}

// ── Release-level summary ────────────────────────────────────────────────────

const RELEASE_SUMMARY_SYSTEM_PROMPT = `You are a senior technical program manager writing a release health briefing for engineering leadership. Your job is to give a factual, date-grounded status of whether the release will ship on time, name the top blockers with their owners, and provide an action list for the next 7 days.

OUTPUT FORMAT (strict — three sections, no extras):

## Release Health: <GREEN|YELLOW|RED>
One paragraph, 3–5 sentences. Open with the overall RAG verdict and the specific evidence (gate dates, P0 count, must-fix count, gate-lagging features). State the dominant risk pattern. Close with projected trajectory if nothing changes.

## Top Blockers
Bullet list of up to 8 entries. Entries come from three sources in priority order:
  1. P0 blockers — copy each entry from OPEN P0 BLOCKERS verbatim, format: "- [KEY] <summary> — P0 Blocker (Owner: <name>)"
  2. Must-fix open tickets — copy from OPEN MUST-FIX TICKETS verbatim, format: "- [KEY] <summary> — Must-fix [status] (Owner: <name>)"
  3. Gate-lagging / blocked features — from FEATURE BUCKETS
If genuinely none, say "*No current blockers.*"

## 7-Day Action List
Numbered list of up to 5 concrete asks. Format: "N. Ask <owner or role> to <specific action> on <key or set of keys> by <date or timeframe>."
Prioritise resolving P0s and must-fix tickets first, then gate-lagging features. Do not use generic language like "monitor" or "follow up".

RAG VERDICT RULES (all conditions checked in order — first match wins):
1. RED if OPEN_P0_BLOCKERS > 0.
2. RED if OPEN_MUSTFIX_TICKETS > 0 AND fewer than 14 days to PG.
3. RED if gate-lagging > 2 features.
4. YELLOW if OPEN_MUSTFIX_TICKETS > 0.
5. YELLOW if gate-lagging 1–2 OR dark > 20% of committed count OR compliance-at-risk > 0.
6. GREEN only if: OPEN_P0_BLOCKERS = 0, OPEN_MUSTFIX_TICKETS = 0, gate-lagging = 0, dark ≤ 20%.

⚠️ TICKET KEY INTEGRITY — ABSOLUTE RULE:
- You MUST copy ticket keys character-for-character from the data provided. Example: if the data says "ERA-66381", write "ERA-66381". Do NOT write "ERA-66217" or any other key not explicitly present in the prompt.
- NEVER generate, invent, approximate, or reconstruct ticket keys. You are not recalling tickets from memory — you are transcribing keys that are given to you in this prompt.
- If you are unsure of a key, omit that entry entirely. A missing entry is far less damaging than a fabricated one.
- Before writing any ticket key in your response, confirm it appears verbatim in OPEN P0 BLOCKERS, OPEN MUST-FIX TICKETS, or FEATURE BUCKETS above.

Never fabricate owner names or dates not present in the data. Under 400 words total.`;

/**
 * Build the user prompt for a release-level AI summary.
 * @param {object} intelligence - Output of releaseAiSummaryService.buildReleaseIntelligence
 */
function buildReleaseSummaryPrompt(intelligence) {
  const { version, totalFeatures, p0Bugs = [], mustFixTickets = [],
          phaseDist, selfReportedRisk, dateMetrics, buckets } = intelligence;
  const today = new Date().toISOString().slice(0, 10);

  const dm = dateMetrics || {};
  const headerLines = [
    `TODAY: ${today}`,
    `RELEASE: ${version}`,
    `TOTAL_COMMITTED_FEATURES: ${totalFeatures}`,
    `OPEN_P0_BLOCKERS: ${p0Bugs.length}`,
    `OPEN_MUSTFIX_TICKETS: ${mustFixTickets.length}`,
    dm.daysFromCutoff != null ? `DAYS_TO_PG: ${dm.daysFromCutoff}` : null,
    dm.currentCGDate ? `CG_DATE: ${dm.currentCGDate}` : null,
    dm.currentPGDate ? `PG_DATE: ${dm.currentPGDate}` : null,
  ].filter(Boolean).join('\n');

  const phaseBlock = Object.entries(phaseDist)
    .sort((a, b) => b[1] - a[1])
    .map(([phase, count]) => `  ${phase}: ${count}`)
    .join('\n');

  const selfRisk = selfReportedRisk;
  const selfBlock = `  RED (self-reported): ${selfRisk.red}  YELLOW: ${selfRisk.yellow}  GREEN: ${selfRisk.green}  Not set: ${selfRisk.notSet}`;

  const renderBucket = (label, features) => {
    if (!features || features.length === 0) return `${label}: none`;
    const lines = features.map(f => {
      const owner = f.tpmOwner || f.assignee || 'Unassigned';
      const risks = (f.criticalRisks || []).slice(0, 2).join(' | ');
      const stale = f.statusUpdateAgeDays != null ? ` [status ${f.statusUpdateAgeDays}d old]` : '';
      const lpm = f.latestPassedMarker
        ? ` [${f.latestPassedMarker.label} passed ${f.latestPassedMarker.daysAgo}d ago, expected ${f.latestPassedMarker.expectedPhase}, actual ${f.phase}]`
        : '';
      return `  - ${f.key}: ${f.summary}${lpm}${stale}${risks ? ' | RISKS: ' + risks : ''} (Owner: ${owner})`;
    });
    return `${label} (${features.length}):\n${lines.join('\n')}`;
  };

  const allProvidedKeys = [
    ...p0Bugs.map(b => b.key),
    ...mustFixTickets.map(t => t.key),
  ];
  const keyReferenceBlock = allProvidedKeys.length > 0
    ? `VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):\n` +
      allProvidedKeys.map((k, i) => `  ${i + 1}. ${k}`).join('\n')
    : 'VALID TICKET KEYS: none provided';

  const p0Block = p0Bugs.length > 0
    ? `OPEN P0 BLOCKERS (${p0Bugs.length}) — release-blocking bugs:\n` +
      p0Bugs.map(b => `  - ${b.key}: ${b.summary} [Status: ${b.status}] (Owner: ${b.assignee})`).join('\n')
    : 'OPEN P0 BLOCKERS: none';

  const mustFixBlock = mustFixTickets.length > 0
    ? `OPEN MUST-FIX TICKETS label="${version.toLowerCase()}-mustfix" (${mustFixTickets.length}) — open items regardless of feature hierarchy:\n` +
      mustFixTickets.slice(0, 20).map(t =>
        `  - ${t.key} [${t.issueType}/${t.priority}]: ${t.summary} [Status: ${t.status}] (Owner: ${t.assignee})`
      ).join('\n') +
      (mustFixTickets.length > 20 ? `\n  ... and ${mustFixTickets.length - 20} more` : '')
    : `OPEN MUST-FIX TICKETS label="${version.toLowerCase()}-mustfix": none`;

  const bucketsBlock = [
    renderBucket('GATE-LAGGING', buckets['gate-lagging']),
    renderBucket('BLOCKED', buckets['blocked']),
    renderBucket('COMPLIANCE-AT-RISK', buckets['compliance']),
    renderBucket('DARK (stale status)', buckets['dark']),
    `WATCHING: ${buckets['watching']?.length ?? 0} features on track`,
    `CLEAR (PG Met / Shipped): ${buckets['clear']?.length ?? 0} features`,
  ].join('\n\n');

  return `${headerLines}

${keyReferenceBlock}

PHASE DISTRIBUTION:
${phaseBlock}

SELF-REPORTED RISK (JIRA indicator — often stale, use as secondary signal only):
${selfBlock}

${p0Block}

${mustFixBlock}

FEATURE BUCKETS (primary signal — grounded in release calendar dates):
${bucketsBlock}

Write the three-section release briefing now. When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`;
}

/**
 * Generate a release-level AI summary.
 *
 * @param {object} intelligence - Output of releaseAiSummaryService.buildReleaseIntelligence
 * @returns {Promise<string>} Formatted three-section briefing
 */
async function generateReleaseSummary(intelligence) {
  const messages = [
    { role: 'system', content: RELEASE_SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildReleaseSummaryPrompt(intelligence) },
  ];
  const text = await chatCompletion(messages, { temperature: 0.25, maxTokens: 1200 });
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('NAI returned an empty release summary after trim');
  }
  return trimmed;
}

module.exports = {
  chatCompletion,
  generateExecSummary,
  generateReleaseSummary,
  EXEC_SUMMARY_SYSTEM_PROMPT,
  RELEASE_SUMMARY_SYSTEM_PROMPT,
  // Exposed for testing
  _internals: { buildUserPrompt, buildTicketContext, buildGateGapsLine, buildReleaseContextBlock, buildReleaseSummaryPrompt },
};
