import type { AgentPack } from '../agentPack/types.js';
import { compactMemoryForPrompt } from './memoryStore.js';
import type { AgentSession } from './types.js';

const IDENTITY_CHAR_CAP = 8000;
const PERCEIVE_CHAR_CAP = 18000;

function clip(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n…[truncated]`;
}

export function buildBootstrapPrompt(
  pack: AgentPack,
  session: AgentSession,
  perceive?: unknown,
  validTicketKeys: string[] = []
): string {
  const identity = clip(pack.identity.orchestrator.body.trim(), IDENTITY_CHAR_CAP);
  const specialists = pack.identity.specialists.map((s) => s.name).join(', ');
  const skills = [...pack.skills.values()]
    .map((s) => `- ${s.name} (${s.capabilityType}/${s.toolClass}) owner=${s.owner}`)
    .join('\n');
  const rules = pack.constitutionalRules.map((r) => r.name).join(', ');
  const perceiveJson = perceive
    ? clip(JSON.stringify(perceive), PERCEIVE_CHAR_CAP)
    : '(none — call get_release_snapshot)';
  const keys = validTicketKeys.slice(0, 400);
  const memoryBits = [
    compactMemoryForPrompt(session.memory?.session),
    compactMemoryForPrompt(session.memory?.user),
    compactMemoryForPrompt(session.memory?.org),
  ].filter(Boolean);
  const memoryJson = memoryBits.length
    ? JSON.stringify({ sessionId: session.sessionId || null, userId: session.userId || null, layers: memoryBits })
    : '(empty)';

  return `You are the Ops Assistant for portfolio-delivery-ops. Load identity from the portable agent pack (D38). Hosts are adapters; this protocol is the product.

SESSION
- productId: ${session.productId}
- audience: ${session.audience || 'tpm'}
- userId: ${session.userId || '(anonymous)'}
- sessionId: ${session.sessionId || '(ephemeral)'}
- pack: ${pack.manifest.name} v${pack.manifest.version}

IDENTITY (orchestrator)
${identity}

Specialists (delegate internally, never tell the user to @ them): ${specialists}

SKILL CATALOG
${skills}

CONSTITUTION — CODE, NOT OPTIONAL
- Rule files in this pack: ${rules}
- Release health RAG is computed by computeReleaseHealthVerdict (includes Path-to-Green gaps on Yellow/Red features). If PERCEIVE includes health.verdict, copy it. Never invent GREEN when P0s, must-fix, or attested Yellow/Red without Path to Green exist.
- Feature-level team risk uses Risk Indicator + Risk Assessment + Path to Green (evaluateTeamRiskContext). Cite Assessment/Path text when present; do not invent a recovery path.
- Cite ticket keys only from VALID TICKET KEYS. If unsure, omit the key.
- Mutate tools pause for HITL. They do not write to JIRA. D26 (who may approve which action) is still open — do not claim a write happened.
- Use remember_correction to persist a human preference or correction.
- Every numeric claim needs a [source: …] path from PERCEIVE or a tool result.

MEMORY (session / user / org)
${memoryJson}

VALID TICKET KEYS
${keys.length ? keys.join(', ') : '(none in perceive — do not invent keys)'}

PERCEIVE (compact release context)
${perceiveJson}

TOOLS
You may call read and draft tools. Mutate calls are queued for a human; they will not execute. If the API supports tool calls, use them. Otherwise you may emit a single JSON object:
{"tool":"<name>","arguments":{...}}
or finish with prose (not JSON). When you have enough evidence, answer the user.`;
}
