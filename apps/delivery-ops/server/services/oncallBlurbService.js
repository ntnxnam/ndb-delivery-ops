/**
 * OnCall blurbs for path / escalation drills.
 *
 * Split-context design (UI ≠ NAI):
 * - UI Comments column: top 3 newest (scannable proof)
 * - NAI About: inferred from fuller context (description + up to 12 comments +
 *   status/dwell + linked TH/eng). Never paraphrase top-3 alone — that
 *   misses earlier RCA / customer ask.
 * - About fallback: structured situation line (status · dwell · path), not a
 *   comment excerpt.
 */

const { resolveRuntimeConfig } = require('./oncallConfigResolve');
const {
  fetchTicketNarrativeBundle,
  buildDeterministicStackBlurb,
} = require('./ticketNarrativeService');
const { chatCompletion } = require('./naiService');
const { _internals: narrativeInternals } = require('../utils/jiraTicketNarrative');

const MAX_KEYS = 24;
const NAI_TIMEOUT_MS = 20000;
const NAI_BATCH_SIZE = 8;
/** Shown in the drill Comments column */
const UI_COMMENT_COUNT = 3;
/** Fed to NAI for About inference (must be ≥ UI count) */
const NAI_COMMENT_COUNT = 12;
const NAI_COMMENT_CHARS = 450;
const NAI_DESC_CHARS = 600;

const stripWikiMarkup = narrativeInternals.stripWikiMarkup;

function normalizeText(s) {
  return stripWikiMarkup(String(s || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseComment(body) {
  const t = normalizeText(body);
  if (!t || t.length < 20) return true;
  if (/^(hi|hello|thanks|thank you|fyi|ack|noted)\.?$/i.test(t)) return true;
  return false;
}

function slimComments(comments, max, bodyChars = 400) {
  return (comments || []).slice(0, max).map((c) => ({
    author: c.author || 'Unknown',
    ageDays: c.ageDays ?? null,
    created: c.created || null,
    body: normalizeText(c.body).slice(0, bodyChars),
  }));
}

/** Structured fallback — never a comment paraphrase. */
function structuredAboutFallback(bundle) {
  if (!bundle) return '';
  const bits = [];
  if (bundle.status) {
    const dwell = bundle.dwell?.currentDwellDays;
    bits.push(
      dwell != null ? `${dwell}d in "${bundle.status}"` : `status "${bundle.status}"`
    );
  }
  const th = (bundle.techHelp || []).map((t) => t.key).filter(Boolean);
  const eng = (bundle.engFixes || []).map((t) => t.key).filter(Boolean);
  if (eng.length) bits.push(`eng/docs: ${eng.slice(0, 2).join(', ')}`);
  else if (th.length) bits.push(`TechHelp only: ${th.slice(0, 2).join(', ')}`);
  else bits.push('no TechHelp/eng path yet');

  const signal = (bundle.comments || []).find((c) => !isNoiseComment(c.body));
  if (signal?.ageDays != null) bits.push(`last substantive comment ${signal.ageDays}d ago`);

  return bits.join(' · ').slice(0, 180);
}

function formatLinkedForPrompt(bundle) {
  const th = (bundle.techHelp || []).map((t) => `${t.key}(${t.status || '?'})`).join(', ') || 'none';
  const eng = (bundle.engFixes || []).map((t) => `${t.key}(${t.status || '?'})`).join(', ') || 'none';
  return `TECHHELP: ${th}\nENG/DOCS: ${eng}`;
}

function formatCommentsForNai(comments) {
  const list = slimComments(comments, NAI_COMMENT_COUNT, NAI_COMMENT_CHARS).filter(
    (c) => !isNoiseComment(c.body)
  );
  if (!list.length) return 'COMMENTS: (none substantive)';
  return `COMMENTS (newest first — synthesize across the whole thread, not just the first):\n${list
    .map(
      (c, i) =>
        `  ${i + 1}. [${c.author}${c.ageDays != null ? `, ${c.ageDays}d ago` : ''}]: ${c.body}`
    )
    .join('\n')}`;
}

function buildAboutPrompt(packets) {
  const validKeys = packets.map((p) => p.key);
  const validBlock = validKeys.map((k, i) => `  ${i + 1}. ${k}`).join('\n');
  const bodies = packets
    .map(
      (p) => `KEY: ${p.key}
STATUS: ${p.status || '?'}
PRIORITY: ${p.priority || '?'}
DWELL_DAYS_IN_STATUS: ${p.dwellDays ?? '?'}
SUMMARY: ${p.summary || ''}
DESCRIPTION: ${String(p.description || '').slice(0, NAI_DESC_CHARS)}
${p.linkedBlock || ''}
${formatCommentsForNai(p.naiComments)}`
    )
    .join('\n\n---\n\n');

  return `VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):
${validBlock}

For EACH key, INFER one plain-English sentence for a TPM:
- What the customer is hitting (product/symptom), and
- What we are waiting on now (customer / eng / TH / internal).

Rules:
- Synthesize DESCRIPTION + FULL comment thread + linked tickets. Do not lightly rephrase one comment.
- Do NOT copy the SUMMARY verbatim.
- Do NOT start with the ticket key.
- Under 160 characters. Return ONLY JSON: key → sentence.

TICKETS:
${bodies}

When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`;
}

const ABOUT_SYSTEM = `You write inferred OnCall situation lines for TPMs — not comment paraphrases.
Read description + the whole comment thread + links, then infer the customer problem and current wait.
⚠️ TICKET KEY INTEGRITY — ABSOLUTE RULE:
- Copy ticket keys character-for-character from VALID TICKET KEYS.
- NEVER generate, invent, approximate, or reconstruct ticket keys.
- Output JSON only: {"ONCALL-123":"sentence", ...}
- One sentence per key, under 160 characters.`;

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({}), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve({});
      });
  });
}

async function enrichAboutWithNai(packets) {
  if (!packets.length) return {};
  const out = {};
  for (let i = 0; i < packets.length; i += NAI_BATCH_SIZE) {
    const batch = packets.slice(i, i + NAI_BATCH_SIZE);
    const partial = await withTimeout(
      (async () => {
        // Do not cap below default NAI_MAX_TOKENS — reasoning models burn small
        // caps to empty output (finish_reason=length).
        const text = await chatCompletion(
          [
            { role: 'system', content: ABOUT_SYSTEM },
            { role: 'user', content: buildAboutPrompt(batch) },
          ],
          { temperature: 0.25 }
        );
        const raw = String(text || '').trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return {};
        const parsed = JSON.parse(jsonMatch[0]);
        const allowed = new Set(batch.map((p) => p.key));
        const summaries = new Map(batch.map((p) => [p.key, normalizeText(p.summary)]));
        const batchOut = {};
        for (const [k, v] of Object.entries(parsed || {})) {
          if (!allowed.has(k)) continue;
          let s = normalizeText(v);
          if (!s) continue;
          const sum = summaries.get(k) || '';
          if (sum && (s === sum || s.startsWith(sum.slice(0, 48)))) continue;
          if (s.length > 200) s = `${s.slice(0, 197)}…`;
          batchOut[k] = s;
        }
        return batchOut;
      })(),
      NAI_TIMEOUT_MS
    );
    Object.assign(out, partial);
  }
  return out;
}

/**
 * @param {{ token: string, teamId?: string, keys: string[] }} opts
 */
async function buildOncallBlurbs({ token, teamId, keys } = {}) {
  const cfg = resolveRuntimeConfig(teamId);
  const uniq = [...new Set((keys || []).map((k) => String(k || '').trim()).filter(Boolean))].slice(
    0,
    MAX_KEYS
  );

  const fetched = await Promise.all(
    uniq.map(async (key) => {
      try {
        const bundle = await fetchTicketNarrativeBundle(key, token, cfg);
        return { key, bundle };
      } catch {
        return { key, bundle: null };
      }
    })
  );

  const packets = [];
  const blurbs = {};

  for (const { key, bundle } of fetched) {
    if (!bundle) {
      blurbs[key] = {
        key,
        status: null,
        about: null,
        comments: [],
        stack: `[${key}] narrative unavailable`,
        source: 'missing',
      };
      continue;
    }

    // Split: fat context for NAI, thin slice for UI
    const naiComments = slimComments(bundle.comments, NAI_COMMENT_COUNT, NAI_COMMENT_CHARS);
    const uiComments = slimComments(bundle.comments, UI_COMMENT_COUNT, 400);

    packets.push({
      key: bundle.key,
      status: bundle.status,
      priority: bundle.priority,
      summary: bundle.summary,
      description: bundle.description,
      dwellDays: bundle.dwell?.currentDwellDays ?? null,
      naiComments,
      uiComments,
      linkedBlock: formatLinkedForPrompt(bundle),
      aboutFallback: structuredAboutFallback(bundle),
      stack: buildDeterministicStackBlurb(bundle),
    });
  }

  const naiAbout = await enrichAboutWithNai(packets);
  const source = Object.keys(naiAbout).length ? 'narrative+nai' : 'narrative';

  for (const p of packets) {
    const inferred = naiAbout[p.key] || null;
    blurbs[p.key] = {
      key: p.key,
      status: p.status,
      // About = NAI only. Structured path hint is separate (NAI-limited display).
      about: inferred,
      pathHint: inferred ? null : p.aboutFallback || null,
      comments: p.uiComments || [],
      stack: p.stack,
      dwellDays: p.dwellDays,
      source: inferred ? 'nai' : 'structured',
    };
  }

  return { blurbs, source, asOf: new Date().toISOString() };
}

module.exports = {
  buildOncallBlurbs,
  structuredAboutFallback,
  UI_COMMENT_COUNT,
  NAI_COMMENT_COUNT,
  MAX_KEYS,
};
