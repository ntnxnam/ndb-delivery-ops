/**
 * jiraDiggingAskService — Slice 3: grounded Ask over cached digging dataset.
 *
 * Loads ticket cache from shared/.cache/jira-digging/{productId}/{jqlHash}/
 * (written by POST /api/jira-digging/prepare), compacts to max 50 tickets,
 * builds citation-first prompt, calls aiConnector.completeChat (muse-spark/beam
 * via env defaults), returns reply with provenance.
 *
 * D1: productId scoping (no hardcoded product). D10: citation-first [KEY-...].
 * D26: read-only (no mutate tools). No localhost.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { completeChat } from '../connectors/aiConnector.js';
import type { AiChatMessage } from '../connectors/aiConnector.js';

const MAX_TICKETS = 50;
const MAX_SUMMARY_CHARS = 120;
const MAX_COMMENT_CHARS = 220;
const MAX_CHANGELOG_ENTRIES = 3;
const MAX_COMMENTS_PER_TICKET = 2;

function sanitizeProductId(productId: string): string {
  const s = String(productId || 'ndb').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(s)) throw new Error('invalid productId');
  return s;
}

function sanitizeJqlHash(jqlHash: string): string {
  const s = String(jqlHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{6,32}$/.test(s)) throw new Error('invalid jqlHash');
  return s;
}

function cacheDirFor(productId: string, jqlHash: string): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // shared/src/services -> shared/.cache/jira-digging/{productId}/{jqlHash}
  // compiled dist/services keeps same relative depth (dist/services -> ../../.cache)
  const candidates = [
    path.join(__dirname, '..', '..', '.cache', 'jira-digging', productId, jqlHash),
    path.join(__dirname, '..', '..', '..', 'shared', '.cache', 'jira-digging', productId, jqlHash),
    path.join(process.cwd(), 'shared', '.cache', 'jira-digging', productId, jqlHash),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'manifest.json')) || fs.existsSync(c)) return c;
    } catch {}
  }
  return candidates[0];
}

export interface DiggingManifest {
  datasetId: string;
  jql: string;
  productId: string;
  jqlHash: string;
  ticketCount: number;
  fetchedAt: string;
  mode?: string;
  includeHistory?: boolean;
  includeComments?: boolean;
  sampleKeys?: string[];
}

export interface LoadDiggingResult {
  manifest: DiggingManifest;
  tickets: unknown[];
}

export async function loadDiggingCache(productId: string, jqlHash: string): Promise<LoadDiggingResult> {
  const pid = sanitizeProductId(productId);
  const hash = sanitizeJqlHash(jqlHash);
  const dir = cacheDirFor(pid, hash);
  const manifestPath = path.join(dir, 'manifest.json');
  const ticketsPath = path.join(dir, 'tickets.json.gz');
  if (!fs.existsSync(manifestPath)) throw new Error(`dataset not found: ${pid}/${hash} (no manifest.json)`);
  if (!fs.existsSync(ticketsPath)) throw new Error(`dataset not found: ${pid}/${hash} (no tickets.json.gz)`);
  const manifestRaw = await fs.promises.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as DiggingManifest;
  const gz = await fs.promises.readFile(ticketsPath);
  const json = zlib.gunzipSync(gz).toString('utf8');
  const tickets = JSON.parse(json);
  if (!Array.isArray(tickets)) throw new Error('corrupt cache: tickets not array');
  return { manifest, tickets: tickets as unknown[] };
}

// Compact one raw JIRA issue (as stored by JiraConnector.searchAll + enrich)
function compactOne(raw: Record<string, unknown>): Record<string, unknown> {
  const fields = (raw.fields as Record<string, unknown>) || {};
  const get = (k: string) => fields[k] ?? raw[k];
  const asStr = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const assignee = fields.assignee as { displayName?: string; name?: string } | null | undefined;
  const reporter = fields.reporter as { displayName?: string; name?: string } | null | undefined;
  const fixVersions = Array.isArray(fields.fixVersions) ? (fields.fixVersions as Array<{ name?: string }>) : [];
  const labels = Array.isArray(fields.labels) ? fields.labels : [];
  const components = Array.isArray(fields.components) ? (fields.components as Array<{ name?: string }>) : [];
  const issuetype = (fields.issuetype as { name?: string })?.name || asStr(get('issuetype'));
  const status = (fields.status as { name?: string })?.name || asStr(get('status'));
  const priority = (fields.priority as { name?: string })?.name || asStr(get('priority'));
  const summary = asStr(fields.summary || raw.summary || '').slice(0, MAX_SUMMARY_CHARS);
  const key = asStr(raw.key);

  const out: Record<string, unknown> = {
    key,
    summary,
    issuetype,
    status,
    priority,
    assignee: assignee?.displayName || assignee?.name || asStr(assignee),
    reporter: reporter?.displayName || reporter?.name || asStr(reporter),
    fixVersions: fixVersions.map((f) => f.name).filter(Boolean),
    created: asStr(fields.created),
    updated: asStr(fields.updated),
    duedate: asStr(fields.duedate),
    labels,
    components: components.map((c) => c.name).filter(Boolean),
  };
  // Optional changelog (last N status transitions)
  const changelog = (raw as { changelog?: { histories?: Array<{ created?: string; author?: { displayName?: string }; items?: Array<{ field?: string; fromString?: string; toString?: string }> }> } }).changelog;
  if (changelog?.histories?.length) {
    const transitions: Array<Record<string, string>> = [];
    for (const h of changelog.histories.slice(-10)) {
      for (const it of h.items || []) {
        if (String(it.field).toLowerCase() === 'status') {
          transitions.push({ at: String(h.created || ''), from: String(it.fromString || ''), to: String(it.toString || ''), by: String((h.author as { displayName?: string })?.displayName || '') });
        }
      }
    }
    if (transitions.length) out.changelog = transitions.slice(-MAX_CHANGELOG_ENTRIES);
  }
  // Optional comments (last M)
  const comments = (raw as { comments?: Array<{ body?: string; author?: string; created?: string }> }).comments;
  if (Array.isArray(comments) && comments.length) {
    out.comments = comments.slice(-MAX_COMMENTS_PER_TICKET).map((c) => ({
      author: String(c.author || ''),
      created: String(c.created || ''),
      body: String(c.body || '').slice(0, MAX_COMMENT_CHARS),
    }));
  }
  // Status update field if present (customfield_23073)
  const statusUpdate = fields.customfield_23073 as string | { value?: string } | undefined;
  if (statusUpdate) {
    const txt = typeof statusUpdate === 'string' ? statusUpdate : statusUpdate.value || '';
    if (txt) out.statusUpdate = String(txt).slice(0, 300);
  }
  return out;
}

export function compactTickets(tickets: unknown[], max = MAX_TICKETS): Record<string, unknown>[] {
  return (tickets as Record<string, unknown>[]).slice(0, max).map(compactOne);
}

export function buildDiggingSystemPrompt(audience: string, productId: string, manifest: DiggingManifest, validKeys: string[]): string {
  const keysList = validKeys.slice(0, 400).join(', ') || '(none)';
  return `You are the Ops Assistant for portfolio-delivery-ops (product=${productId}, audience=${audience || 'tpm'}).
Answer ONLY from the provided JIRA dataset — do not invent tickets, counts, or dates.

DATASET
- JQL: ${manifest.jql}
- Fetched: ${manifest.fetchedAt} — ${manifest.ticketCount} tickets (showing up to ${MAX_TICKETS})
- Provenance: ${manifest.datasetId} hash=${manifest.jqlHash}

VALID TICKET KEYS (cite exactly as [KEY-...], e.g. [ERA-123]):
${keysList}

RULES (D10 citation-first, constitution):
- Every factual claim about a ticket MUST cite one or more keys as [KEY-...] from VALID KEYS.
- Never invent a key — if unsure, omit citation rather than hallucinate.
- Be concise, persona-aware (${audience || 'tpm'}), grounded in dataset.
- D26 HITL: you are read-only; do not claim you wrote to JIRA.
- If dataset is empty, say so and suggest narrowing JQL.
- No localhost URLs; use https://jira.nutanix.com/browse/<KEY> when linking (client linkifies [KEY-...]).`;
}

export function buildDiggingUserPrompt(manifest: DiggingManifest, compacted: Record<string, unknown>[], question: string, history: Array<{ role: string; content: string }>): string {
  const historyBlock = history?.length ? `HISTORY (last ${history.length}):\n${history.map((m) => `${m.role}: ${m.content.slice(0, 800)}`).join('\n')}\n\n` : '';
  const ticketsJson = JSON.stringify(compacted, null, 2);
  return `${historyBlock}USER QUESTION: ${question}\n\nTICKETS (JSON, max ${MAX_TICKETS} compact):\n${ticketsJson}\n\nAnswer the question grounded in tickets above. Cite keys as [KEY-...] for every claim. Keep under 300 words.`;
}

export interface AnswerDiggingAskOptions {
  productId: string;
  jqlHash: string;
  datasetId?: string;
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  audience?: string;
  userId?: string;
  sessionId?: string;
}

export interface AnswerDiggingAskResult {
  reply: string;
  manifest: DiggingManifest;
  compacted: Record<string, unknown>[];
  validKeys: string[];
  providerMeta?: unknown;
}

function sanitizeHistory(history: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String((m as { content?: string }).content || '').slice(0, 2000) }))
    .slice(-6);
}

export async function answerDiggingAsk(opts: AnswerDiggingAskOptions): Promise<AnswerDiggingAskResult> {
  const { productId, jqlHash, question, audience = 'tpm' } = opts;
  if (!question || !String(question).trim()) throw new Error('question is required');
  const { manifest, tickets } = await loadDiggingCache(productId, jqlHash);
  if (opts.datasetId && opts.datasetId !== manifest.datasetId) {
    // datasetId mismatch is non-fatal — log but trust jqlHash (hash is content-addressed)
  }
  const compacted = compactTickets(tickets, MAX_TICKETS);
  const validKeys = (tickets as Array<{ key?: string }>).map((t) => String(t.key || '').toUpperCase()).filter(Boolean);
  const history = sanitizeHistory(opts.history);
  const system = buildDiggingSystemPrompt(audience, sanitizeProductId(productId), manifest, validKeys);
  const user = buildDiggingUserPrompt(manifest, compacted, String(question).trim(), history as Array<{ role: string; content: string }>);
  const messages: AiChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const turn = await completeChat(messages, { temperature: 0.2, maxTokens: 1200 });
  let reply = String(turn.content || '').trim();
  if (!reply) throw new Error('LLM returned empty reply');
  // Citation post-validate: strip hallucinated [KEY-...] not in validKeys
  const cited = [...reply.matchAll(/\[([A-Z][A-Z0-9]+-\d+)\]/g)].map(m => m[1].toUpperCase());
  const invalid = cited.filter(k => !validKeys.includes(k));
  if (invalid.length) {
    // Remove invalid citations to avoid hallucination; keep text
    for (const bad of invalid) reply = reply.split(`[${bad}]`).join(`[${bad} ?]`);
    reply += `\n\n_Note: ${invalid.length} cited key(s) outside dataset were flagged: ${invalid.join(', ')}_`;
  }
  // Truncation disclosure
  if (tickets.length > MAX_TICKETS) {
    reply = `Showing ${MAX_TICKETS} of ${tickets.length} — narrow JQL for full coverage.\n\n${reply}`;
  }
  return { reply, manifest, compacted, validKeys, providerMeta: turn.usage };
}
