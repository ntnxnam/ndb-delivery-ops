---
report_type: LLD
module: AI Layer (Chat, Exec Summary, Release Briefing)
version: "2.0"
generated: 2026-08-04
status: current
---

# Low-Level Design: AI Layer

---

## 1. Overview

The AI layer has three surfaces:
1. **Chat panel** — conversational Q&A on release/ticket data
2. **Per-feature Exec Summary** — AI-generated 20-point status update, reviewed by RM, written to JIRA
3. **Release Briefing** — deterministic RAG verdict + LLM narrative + blockers + 7-day action list

All three use NAI (Nutanix internal LLM API), enforce ticket-key integrity, and produce citation-first output (D10).

---

## 2. Files

| File | Purpose |
|---|---|
| `server/services/naiService.js` | One-shot LLM for exec summary + release briefing (not chat SOPs) |
| `server/services/chatService.js` | Host adapter: perceive snapshot, then `runAgentTurn` |
| `shared/src/agentRuntime/` | Pack bootstrap + read-only tool loop (D39) |
| `server/utils/chatIntentRouter.js` | Classify user message into intent |
| `server/utils/chatSnapshotBuilder.js` | Build compact dataset context for LLM |
| `server/services/aiReportService.js` | AI report orchestration |
| `server/services/releaseAiSummaryService.js` | Release summary **fetch** (JQL + JIRA). Aggregation is `shared` `assembleReleaseIntelligence` (D41) |
| `shared/src/domain/execSummarySignals.cjs` | Deterministic RAG signal computation (`deriveSignals`). App shim: `server/utils/execSummarySignals.js` |
| `server/routes/ai.js` | `/api/ai/*` routes |
| `client/src/release/ChatbotPage.js` | Chat UI |
| `client/src/components/ReleaseSummaryPanel.js` | Release briefing UI |

---

## 3. Chat Panel

### 3.1 API Contract

```
POST /api/ai/chat
{
  "message": "What are the open blockers for NDB-2.12?",
  "history": [{ "role": "user"|"assistant", "content": "..." }],
  "release": "NDB-2.12",
  "productId": "ndb"
}

Response:
{ "reply": "...", "scope": {...}, "snapshotMeta": {...}, "trace": [...], "runtime": "agent" }
```

### 3.2 Server Pipeline

```
chatService.answerChat(message, history, release, productId):

1. chatIntentRouter.extractScope(message)
   → releases / teams / ticket keys / intent

2. chatSnapshotBuilder.buildSnapshot(scope, productId)
   → disk release cache + gate dates + optional release intelligence (incl. computed health)

3. loadAgentPack() + runAgentTurn({ perceive, validTicketKeys, tools })
   → read-only pack tools + get_release_snapshot / get_release_health
   → aiConnector.completeChat (native tool_calls or JSON protocol)

4. Return { reply, scope, snapshotMeta, trace, runtime: "agent" }
```

### 3.3 CHAT_SYSTEM_PROMPT Key Rules

- "You are a release operations assistant for {productDisplayName}."
- Contains full TICKET KEY INTEGRITY block (see §6).
- Instructs to cite `[ERA-NNNNN]` on every concrete claim.
- Instructs to state confidence level on predictions: "High (direct JIRA count)", "Medium (derived)", "Low (extrapolated)".
- Instructs to say "I don't know" if data is absent rather than hallucinating.

---

## 4. Per-Feature Exec Summary

### 4.1 Generation

```
POST /api/ai/exec-summary
{ "issueKey": "FEAT-16821", "release": "NDB-2.12" }

1. execSummaryService.buildContext(issueKey, release):
   → Fetch feature + its epics + issue breakdown from JIRA
   → Compute gate signals (on-time / slipped / at-risk per date field)
   → Build VALID TICKET KEYS list (all keys in scope)

2. naiService.generateExecSummary({ context, validKeys }):
   → EXEC_SUMMARY_SYSTEM_PROMPT (with TICKET KEY INTEGRITY block)
   → User prompt: feature data + numbered VALID TICKET KEYS list
   → LLM generates 20-point status update
   → Closes prompt: "When citing ticket keys, use ONLY the keys listed above."

3. Return { summary: string, ticketsUsed: string[] }
```

### 4.2 Write to JIRA

```
PUT /api/ai/exec-summary/:key
{ "summary": "generated text" }
Authorization: Bearer {jiraToken}

→ jiraConnector.updateField(key, customFieldId_execStatusUpdate, summary)
→ Returns { success: true, message }
```

### 4.3 20-Point Status Update Structure

The LLM must produce all 20 sections. Sections may say "N/A" but must not be silently omitted.

```
1.  Requirements: <status / notes>
2.  UX: <status / notes>
3.  Tech Design: <status / notes>
4.  Milestones / Project Plan: <status / notes>
5.  Test Plan: <status / notes>
6.  Reach out to DBE: <status / notes>
7.  Coding
    7a. Dev Testing: <status / notes>
8.  Testing
    8a. Manual Testing — QI% | Run% | # rounds: <values>
    8b. Automation — QI% | Run% | # rounds: <values>
    8c. Framework Changes: <status / notes>
    8d. Integration Testing: <status / notes>
    8e. System Testing — QI% | Run% | # rounds: <values>
    8f. Longevity & Performance: <status / notes>
9.  Telemetry: <status / notes>
10. FMEA: <status / notes>
11. Threat Modelling: <status / notes>
12. RBAC: <status / notes>
13. Backward Compatibility: <status / notes>
14. CPBR: <status / notes>
15. APIs Auditing: <status / notes>
16. Compliance
    16a. ACP: <status / notes>
    16b. Legal: <status / notes>
    16c. a11y: <status / notes>
    16d. TechPubs: <status / notes>
    16e. Serviceability: <status / notes>
17. Security
    17a. Security Review: <status / notes>
    17b. Pen Testing: <status / notes>
18. Bug Fixing: <status / notes>
19. Commit Gate Readiness: <status / notes>
20. Promotion Gate Readiness: <status / notes>
```

---

## 5. Release Briefing

### 5.1 RAG Verdict — Deterministic (Not LLM-Generated)

```javascript
// shared/src/services/riskIndicator.ts — computeReleaseHealthVerdict
// (deriveSignals lives in shared/src/domain/execSummarySignals.cjs)
function computeRAGVerdict({
  openP0Blockers,
  openMustFixTickets,
  daysToNextGate,
  gateLaggingCount,
  darkFeaturePercent,
  complianceAtRiskCount
}) {
  // Rules applied in order; first match wins:
  if (openP0Blockers > 0)                                              return 'RED';
  if (openMustFixTickets > 0 && daysToNextGate <= 14)                  return 'RED';
  if (gateLaggingCount > 2)                                            return 'RED';
  if (openMustFixTickets > 0)                                          return 'YELLOW';
  if (gateLaggingCount >= 1 || darkFeaturePercent > 20
      || complianceAtRiskCount > 0)                                    return 'YELLOW';
  return 'GREEN';  // only when ALL above conditions are zero
}
```

**GREEN is only valid when ALL conditions are clean. An open must-fix count > 0 is never GREEN.**

### 5.2 Intelligence Package Assembly

```
releaseAiSummaryService.buildReleaseIntelligence(release, jiraToken):

1. Fetch committed features (existing JQL; excludes long-term-funded)
2. Fetch P0 blockers (with keys + summaries — LLM needs keys to name them)
3. Fetch mustfix tickets (label = "{release}-mustfix")
4. deriveSignals per feature (shared execSummarySignals)
5. assembleReleaseIntelligence (shared) — buckets + computeReleaseHealthVerdict

Return: { health, p0Bugs, mustFixTickets, buckets, phaseDist, valid feature keys }
```

### 5.3 LLM Call

```
naiService.generateReleaseSummary(package):

System prompt: RELEASE_SUMMARY_SYSTEM_PROMPT
  - Includes TICKET KEY INTEGRITY block
  - "The RAG verdict is provided by the system. Do not override it."
  - "Cite keys from VALID TICKET KEYS list only."
  - "Produce a 7-day action list with owners and JIRA keys."

User prompt (structure):
  VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):
    1. ERA-66381
    2. ERA-66374
    ...

  VERDICT: RED
  P0 BLOCKERS: 2 — ERA-66381: "Write throughput regression"; ERA-66374: "Auth failure on cluster join"
  MUSTFIX TICKETS: 3
  GATE: Commit Gate on 2026-09-01 (28 days)
  COMMITTED FEATURES: 18 (excluding long-term-funded)

  Generate:
  1. 2-sentence release health summary
  2. Top 3 risks with owner (cite ticket keys)
  3. 7-day action list (assignee + key + due)

  When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.

Return: { summary: string, risks: [...], actionList: [...] }
```

### 5.4 Panel Rendering Rules

```
ReleaseSummaryPanel.js — INVARIANTS:

- Panel border:   always #dee2e6 (neutral) — NEVER RAG-coloured
- Panel header background: always #f8f9fa (neutral) — NEVER RAG-coloured
- RAG badge: appears EXACTLY ONCE, inside summary body at "## Release Health: {VERDICT}"
- Critical counts (P0s, must-fix): coloured bold inline text inside body
- No triple RAG colouring (border + header + badge = 3 separate indicators = misleads reader)
```

---

## 6. Ticket Key Integrity — System-Wide Invariant

This rule applies to every AI endpoint that produces ticket keys in output. Violations are P0 defects.

### 6.1 Required Elements in Every AI Prompt

**In system prompt:**
```
⚠️ TICKET KEY INTEGRITY — ABSOLUTE RULE:
- Copy ticket keys character-for-character from the data provided.
- NEVER generate, invent, approximate, or reconstruct ticket keys.
  You are transcribing keys given to you — not recalling from memory.
- If unsure of a key, omit that entry entirely.
- Before writing any ticket key in your response, confirm it appears
  verbatim in VALID TICKET KEYS above.
```

**In user prompt (before any detail blocks):**
```
VALID TICKET KEYS (copy these exactly — do not alter, combine, or generate new ones):
  1. ERA-66381
  2. ERA-66374
  ...
```

**At the end of every user prompt:**
```
When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.
```

### 6.2 Applicable Endpoints

| Endpoint | Prompt |
|---|---|
| `POST /api/ai/chat` | Chat system prompt |
| `POST /api/ai/exec-summary` | `EXEC_SUMMARY_SYSTEM_PROMPT` |
| `POST /api/ai/release-summary` | `RELEASE_SUMMARY_SYSTEM_PROMPT` |
| Any future AI summary endpoint | Must include all three elements |

---

## 7. NAI API Call Pattern

```javascript
async function callNAI({ systemPrompt, userPrompt, maxTokens = 2048 }) {
  const response = await axios.post(NAI_API_URL, {
    model: NAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,   // low temperature for factual/operational output
  }, {
    headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` },
    timeout: 30000,
  });
  return response.data.choices[0].message.content;
}
```

On timeout or error: return 503 with a user-visible message. Never hang or return partial JSON.
