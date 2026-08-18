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
const EXEC_SUMMARY_SYSTEM_PROMPT = `You are an executive technical program manager at Nutanix writing release status summaries for engineering features. Your audience is a VP who will read your output in 10 seconds. Write like a senior TPM who has read the ticket — plain English, no jargon, no scoring commentary.

OUTPUT FORMAT (strict — five sections in this exact order):

📅 Date: <value of SIGNALS.statusUpdate.date if present, else "Not available">

🔴/🟡/🟢 TLDR: <1–2 sentences — RAG verdict (RED/YELLOW/GREEN) stated plainly, top blocker or risk in plain English. If GREEN with no issues: "On track — no blocking issues." For Shipped: "Feature shipped." Nothing else in TLDR.>

⚠️ Hygiene Issues:
• <only list fields that are literally null / "Not Set" / empty in the data provided to you — e.g. gate dates not set, test plan link missing, design doc not set>
• <omit this section entirely — including the header — if no hygiene issues exist>

📋 Key Risks:
• <risk 1 — one line, factual, no scoring rationale>
• <risk 2>
• <2–4 bullets max; omit this section entirely — including the header — if no real risks beyond hygiene>

✅ Next Owner Actions:
• <name of who needs to act> — <1 action, deadline if known>
• <2–3 bullets max; omit this section entirely — including the header — if no clear owner action is needed>

OUTPUT RULES (non-negotiable):
- NEVER output "*** This update is generated using AI ***" or any variant — that banner is forbidden.
- NEVER output a line like "Here is the executive summary for FEAT-XXXXX:" — the reader already knows the ticket.
- NEVER output "Exec Status generated on ..." or any generated-on timestamp — the timestamp is added separately.
- NEVER output a "Scoring rationale" section or any scoring commentary. Rationale is internal reasoning; it must not appear in the output.
- NEVER use markdown "---" dividers anywhere in the output.
- NEVER use the word "Section" as a label.
- The TLDR must be ≤ 2 sentences. Hard limit.
- Hygiene Issues: list only fields that are null, empty, or literally "Not Set" in the data. If all hygiene fields are set, omit the section header too.
- Next Owner Actions: name the person or role (e.g. "Feature owner", "TPM", specific assignee name from ticket). Max 3 bullets. If no action is needed, omit the section header too.
- The entire output must be readable in under 30 seconds by someone who has never seen the ticket.

HYGIENE FIELDS TO CHECK (emit as bullets only when actually missing):
- Commit Gate date not set (SIGNALS.dates.commitGate is null or empty)
- Promotion Gate date not set (SIGNALS.dates.promotionGate is null or empty)
- Test Plan Link not set (SIGNALS.testPlanLink is null or empty)
- Design Doc not set (SIGNALS.designDocLink is null or empty)
- Requirements Link not set (SIGNALS.requirementsLink is null or empty)

REASONING REQUIREMENTS (used to populate TLDR and Key Risks — do NOT surface reasoning text in output):
- Every claim in Key Risks MUST connect to a cause from TICKET CONTEXT or SIGNALS. No claim without a source.
- When you mention a blocker, name the linked JIRA key from LINKED BLOCKERS and describe its impact in plain English.
- If the narrative does NOT explain a gap, note it: "no comment activity explaining the slip" — silence is a signal.
- Use causality language: "slipped because", "blocked by", "stalled since". Never report a number without a "why".
- Do NOT recite SIGNALS verbatim in Key Risks — translate them into VP-readable findings.

RULES:
- Only discuss signals listed in PHASE_FOCUS.
- Never mention signals listed in PHASE_IGNORE.
- If a signal appears in TEAM_NA, the team has declared it not applicable. Never flag it as a hygiene issue.
- Use exact numbers from SIGNALS — never "some", "a few", or estimates.
- When RELEASE CONTEXT is present: use it to calibrate urgency language in TLDR — do NOT repeat portfolio counts verbatim. Never fabricate portfolio numbers not in RELEASE CONTEXT.

CITE-OR-DON'T-CLAIM (zero-tolerance rule):
- Every negative claim in Key Risks — "slipped", "stalled", "blocked", "missing", "overdue", "incomplete" — MUST cite a source visible in this prompt.
- Accepted sources: a SIGNALS field, a CRITICAL_RISKS entry, a COMPLIANCE TICKETS row, a LINKED BLOCKERS row, an OUTSTANDING SUBTASKS row, or a RECENT COMMENTS line.
- No source row = no claim. Do not infer gaps from absent fields.

VERDICT FLOOR (phase-conditioned — hard rule):
- PHASE = "PG Met": default GREEN; downgrade to YELLOW only with cited reason; RED only with cited de-promotion evidence (status transition leaving PG Met, new P0/P1 blocker, or recent comment naming a GA blocker by key).
- PHASE = "Shipped": TLDR is "Feature shipped." — nothing else. Omit all other sections.
- PHASE = "CG Met": cannot be RED unless an open P0/P1 in LINKED BLOCKERS or OUTSTANDING SUBTASKS is named.

CLOSEST-DATE-THAT-PASSED RULE (primary verdict anchor):
- SIGNALS.latestPassedMarker is the most recent release-level gate whose date has elapsed. This is your PRIMARY anchor.
- If the gate has passed but jiraStatus does NOT confirm clearance → feature FAILED that gate. Verdict is RED by default unless status update or a RECENT COMMENT (<14 days) contains "gate cleared", "approved", or "passed".
- When CRITICAL_RISKS contains a "MISSED GATE" entry, set TLDR verdict to RED and lead with it.
- daysAgo urgency: ≤7 days = YELLOW (if no other RED signals); 8–21 days = RED; >21 days = RED + escalation language.

JIRA RISK INDICATOR ALIGNMENT:
- SIGNALS.jiraRiskIndicator (Green / Yellow / Red) is the team's own attestation. Your RAG verdict in TLDR should match it.
- If you diverge, TLDR MUST cite the specific evidence (a CRITICAL_RISKS entry, an open P0/P1 blocker, or a comment within 14 days naming a regression).
- Never silently override the team's attestation.

COMMENT STALENESS FLOOR:
- Do NOT use "stalled", "drifting", or "lost engagement" unless the COMMENT FRESHNESS section appears in TICKET CONTEXT (emitted only when last comment is ≥14 days old).
- Comments under 14 days old are healthy by definition.

COMPLIANCE RULE:
- The COMPLIANCE TICKETS section of TICKET CONTEXT is authoritative.
- "all CLOSED" = done — do NOT flag as unfiled or add to Hygiene Issues.
- "some still open" = in-flight — mention in Key Risks with specific keys.
- If COMPLIANCE TICKETS section is ABSENT, do NOT mention security, legal, or docs at all.

TASKS RULE:
- When SIGNALS.tasks.totalToBeVerified > 0, those tickets are queued for QA sign-off (JIRA status = Resolved). They are NOT open dev work.
- Use exact phrasing: "N truly open, M awaiting QA verification". Never sum them as "X open".

CRITICAL RISKS (highest priority):
- If CRITICAL_RISKS is non-empty, TLDR MUST lead with the most severe item.
- Gate overshoot in CRITICAL_RISKS → both the feature date and the marker overshoot must appear in TLDR.
- IMPORTANT: CRITICAL_RISKS already accounts for phase. Do not re-derive a "CG slipped" claim from raw SIGNALS.dates when the gate is Met.

GATE COMPARISON:
- "daysUntil" = feature's own estimated date relative to today.
- "overshootMarker" = same date relative to the release-level BINDING gate (not CG1/PG1/CCM1 checkpoints).
- A positive overshoot means the binding gate has already passed.
- Use label from "markers.commitGate.label" / "markers.promotionGate.label" (e.g. "Commit Gate 2"), not a bare date.

NEXT OWNER ACTIONS — PHASE-GATED ALLOW-LIST:
- Inception / Design / Coding / CC Met: allowed → deferral, scope cut, extension request, escalate named LINKED BLOCKER, RM approval for date push.
- CG Met: allowed → escalate named P0/P1 from LINKED BLOCKERS or OUTSTANDING SUBTASKS, scope cut of specific bugs. Forbidden → "defer the feature", "request extension", "escalate schedule".
- PG Met: allowed → close residual P0/P1 bugs (by key), finalise TECHPUBS tickets (by key), confirm GA readiness. Forbidden → defer, extend, escalate schedule, file security/legal.
- Shipped: no actions — omit section.

CONFLICT HANDLING:
- SIGNALS always wins over free-text when there is a discrepancy in dates or counts.
- If SIGNALS and raw text disagree, surface as a Key Risks bullet: "Status update mentions X but JIRA shows Y — owner should reconfirm."

PHASE-SPECIFIC GUIDANCE:
- Inception / Design: hygiene = FS/DS Done Date, Test Plan Date, Design Doc, Requirements link. Code Complete proximity = urgency.
- Coding: hygiene = Code Complete date, outstanding task count.
- CC Met: gate proximity + overshoot, Security/Legal filing, test QI%, open bug count.
- CG Met: PG proximity + overshoot, P0/P1 closure, automation QI, doc completeness. CG is cleared — do not relitigate.
- PG Met: residual P0/P1 issues, doc finalisation, GA readiness only. Default GREEN.
- Shipped: one-line TLDR, all other sections omitted.

⚠️ TICKET KEY INTEGRITY — ABSOLUTE RULE:
- Copy ticket keys character-for-character from the data provided.
- NEVER generate, invent, approximate, or reconstruct ticket keys. You are transcribing keys given to you — not recalling from memory.
- If unsure of a key, omit that entry entirely.
- Before writing any ticket key in your response, confirm it appears verbatim in the VALID TICKET KEYS list at the top of the user message.`;

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

  // Critical risks float to the top — these must be addressed in the TLDR
  // when present (per the system prompt's CRITICAL RISKS rule).
  const risks = signals.criticalRisks || [];
  const criticalBlock = risks.length > 0
    ? `CRITICAL_RISKS (deterministic; TLDR must lead with the most severe):\n${risks.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`
    : `CRITICAL_RISKS: none`;

  const ticketContextBlock = buildTicketContext(narrative);

  // Collect all blocker keys from narrative for ticket key integrity reference
  const blockerKeys = Array.isArray(narrative?.blockers)
    ? narrative.blockers.map(b => b.key).filter(Boolean)
    : [];
  const validKeysBlock = blockerKeys.length > 0
    ? `VALID TICKET KEYS (copy these exactly when citing blockers — do not alter, combine, or generate new ones):\n${blockerKeys.map((k, i) => `  ${i + 1}. ${k}`).join('\n')}`
    : `VALID TICKET KEYS: none provided (no linked blockers found — do not fabricate ticket keys)`;

  return `TODAY: ${today}
PHASE: ${signals.phase}
PHASE_RATIONALE: ${signals.phaseRationale}
PHASE_FOCUS: ${phaseFocusList}
PHASE_IGNORE: ${phaseIgnoreList}
TEAM_NA: ${teamNAList}
${latestPassedMarkerLine ? latestPassedMarkerLine + '\n' : ''}${gateGapsLine ? gateGapsLine + '\n' : ''}${releaseContextBlock ? releaseContextBlock + '\n\n' : ''}
${validKeysBlock}

${criticalBlock}

${ticketContextBlock}

SIGNALS (supporting evidence — DO NOT recite verbatim; use to populate Date, Hygiene Issues, TLDR, and Key Risks):
${JSON.stringify(signals, null, 2)}

${rawBlock}

Write the executive summary now using the five-section format from the system prompt.

REMEMBER:
- Output exactly the five sections: 📅 Date, 🔴/🟡/🟢 TLDR, ⚠️ Hygiene Issues (omit if none), 📋 Key Risks (omit if none), ✅ Next Owner Actions (omit if none).
- DO NOT output any AI banner, feature key header, scoring rationale, or generated-on timestamp.
- TLDR is ≤ 2 sentences. Verdict first, then top blocker or risk in plain English.
- Hygiene Issues: only fields that are literally null / empty / "Not Set" in the data above.
- Key Risks: 2–4 bullets max, each grounded in a source from this prompt.
- Next Owner Actions: 2–3 bullets max, each naming a person or role and a specific action.

When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`;
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
