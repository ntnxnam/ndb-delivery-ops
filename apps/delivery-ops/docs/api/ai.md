# AI Endpoints — `/api/ai`

Route file: `apps/delivery-ops/server/routes/ai.js`

---

### POST /api/ai/chat

**Purpose**: Conversational release Q&A. Perceive (cached snapshot) then run the portable agent runtime (pack bootstrap + tool loop + memory + provenance). Same LLM transport as exec/release summaries (`aiConnector.completeChat`).

> Additive in 2026-08-26 (D42): `sessionId`, `provenanceId`, `pendingApprovals`, `memoryMeta`. Optional body field `sessionId`. Mutate tools are HITL-queued and never executed while D26 is open.

**Auth**: Required (JIRA token in `Authorization: Bearer <token>` header)

**Request**
- Method: POST
- Body (JSON):
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `message` | string | yes | User chat prompt |
  | `history` | array | no | Prior turns as `{ role, content }`; only `user` and `assistant` roles are accepted |
  | `release` | string | no | Default focus release if prompt does not explicitly name one |
  | `productId` | string | no | Product namespace for dataset cache; default `ndb` |
  | `audience` | string | no | Presenter lens for the orchestrator session; default `tpm` |
  | `sessionId` | string | no | Client chat session key; server sanitizes and persists memory against it |
  | `availableReleases` | string[] | no | Client-supplied release list to improve intent extraction |
  | `knownTeams` | string[] | no | Client-supplied team/component names to improve intent extraction |

**Server flow**
`POST /api/ai/chat`
→ `chatIntentRouter.extractScope`
→ `chatSnapshotBuilder.buildSnapshot` (live per-release fetch or empty snapshot + gate config + optional release intelligence)
→ load session/user/org memory
→ `loadAgentPack()` + `runAgentTurn` (`shared/agentRuntime`)
→ pack tools (`list_skills`, `read_skill`, `read_specialist`) and host tools (`get_release_snapshot`, `get_release_health`, `remember_correction`, `propose_jira_write`)
→ `read`/`draft` execute; `mutate` HITL-queued (D26 open — no JIRA write)
→ append provenance JSONL
→ `aiConnector.completeChat`
→ response

**Response shape**
```json
{
  "reply": "- NDB-2.12 has 3 open P0/P1 items [source: releaseContext.NDB-2.12.summary.topP0P1Open]",
  "scope": {
    "releases": ["NDB-2.12"],
    "teams": [],
    "ticketKeys": [],
    "sprints": [],
    "intent": "single_release",
    "assumedFocus": false
  },
  "snapshotMeta": {
    "generatedAt": "2026-06-29T15:03:00.000Z",
    "releaseCount": 1,
    "validTicketKeyCount": 1024
  },
  "trace": [
    { "tool": "get_release_health", "toolClass": "read", "ok": true, "detail": "ok" }
  ],
  "runtime": "agent",
  "sessionId": "s_1724_ab12",
  "provenanceId": "3f2c9e0a-…",
  "pendingApprovals": [],
  "memoryMeta": { "sessionEntities": 1, "userCorrections": 0 }
}
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | `message` missing/empty | Fix request payload |
| 502 | NAI call failed or snapshot pipeline failed | Show retry affordance and preserve unsent prompt |

**Caching**
- Session/user/org memory and provenance JSONL under `AGENT_RUNTIME_DIR` (default `.cache/agent-runtime`).
- Snapshot is rebuilt per turn from on-disk release cache (`shared/.cache/release-dataset`) and gate config.

---

### GET /api/ai/approvals

**Purpose**: List HITL mutate proposals for the current user (Wave 4 inbox).

**Auth**: required

**Request**
- Method + path: `GET /api/ai/approvals`
- Query params:
  - `sessionId` (string, optional) — filter to one chat session
  - `status` (string, optional) — `pending` | `rejected` | `blocked_d26`
- Body: none
- Required headers: `Authorization: Bearer <jira-pat>`

**Server flow**
`routes/ai.js` → `chatService.listApprovals` → `FileHitlInbox.list`

**Response shape**
```json
{ "approvals": [{ "id": "…", "status": "pending", "tool": "propose_jira_write", "args": {}, "requestedBy": "alice" }] }
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 500 | Store read failed | Retry |

**Caching**
No — reads the HITL JSON file.

---

### POST /api/ai/approvals/:id

**Purpose**: Approve or reject a queued mutate. Approve records `blocked_d26` and **does not write to JIRA** while D26 is open.

**Auth**: required (same user as `requestedBy`)

**Request**
- Method + path: `POST /api/ai/approvals/:id`
- Query params: none
- Body params: `decision` (`approve` | `reject`)
- Required headers: `Authorization: Bearer <jira-pat>`

**Server flow**
`routes/ai.js` → `chatService.decideApproval` → `FileHitlInbox.decide` (no DateMover / JIRA call)

**Response shape**
```json
{ "approval": { "id": "…", "status": "blocked_d26" }, "executed": false }
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | Missing/invalid `decision` | Fix body |
| 403 | Caller is not the requester, or auth username is missing | Stop |
| 404 | Unknown id | Refresh inbox |

**Caching**
No.

---

### POST /api/ai/exec-summary

**Purpose**: Generate a phase-aware AI executive summary for a single JIRA feature/initiative using NAI.

**Auth**: Required (JIRA token in `Authorization: Bearer <token>` header)

**Request**
- Method: POST
- Body (JSON):
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `item` | object | yes | Full raw JIRA item including `customfield_*` fields |
  | `ganttConfig` | object | no | Per-version gate marker dates from `/api/config/release-versions` |
  | `breakdownData` | object | no | Task breakdown from `taskBreakdownService` |
  | `release` | string | no | e.g. `"NDB-2.11"` |
  | `releaseContext` | object | no | Aggregate release health data from `/api/jira/executive-summary-unified` |

**Server flow**
`POST /api/ai/exec-summary` → `fetchTicketNarrative` (JIRA) → `deriveSignals` (`shared/src/domain/execSummarySignals.cjs`) → `generateExecSummary` (NAI) → response

**Response shape**
```json
{
  "summary": "[2026-06-16] GREEN: Commit Gate confirmed on schedule...",
  "phase": "CG Met",
  "signals": { "...": "..." }
}
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | `item.key` missing | Fix the request body |
| 502 | NAI returned empty or failed | Show retry button; log `naiDebug` |

**Caching**: No — summaries are generated on demand and written to JIRA via the PUT endpoint.

---

### PUT /api/ai/exec-summary/:key

**Purpose**: Write a generated executive summary back to the JIRA custom field `customfield_38460`.

**Auth**: Required (JIRA token)

**Request**
- Method: PUT
- Path param: `key` — JIRA issue key (e.g. `FEAT-12345`)
- Body:
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `summary` | string | yes | Full stamped summary string, e.g. `"[2026-06-16] GREEN: ..."` |

**Server flow**
`PUT /api/ai/exec-summary/:key` → `PUT JIRA_API_V2.ISSUE(key)` with `customfield_38460`

**Response shape**
```json
{ "success": true, "key": "FEAT-12345", "field": "customfield_38460" }
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | Missing key or summary | Fix request |
| 401 | No JIRA token | Re-authenticate |
| 502 | JIRA write rejected | Show error; log JIRA status |

**Caching**: No.

---

### POST /api/ai/release-summary

**Purpose**: Generate a full release-level AI briefing — overall health verdict, top blockers with owners, and a 7-day action list — by running `deriveSignals` across every committed feature and calling NAI.

Unlike the VP report (which counts self-reported JIRA risk indicators), this endpoint uses the objective release calendar: it computes which features have **not confirmed clearance** of the most recently elapsed release-level gate (`latestPassedMarker`), groups them into structured buckets (gate-lagging, blocked, compliance, dark, watching, clear), and provides those buckets directly to the LLM.

**Auth**: Required (JIRA token — used for JIRA search calls inside the service)

**Request**
- Method: POST
- Body (JSON):
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `version` | string | yes | Release version, e.g. `"NDB-2.12"` |

**Server flow**
`POST /api/ai/release-summary`
→ `buildReleaseIntelligence(version, jiraToken)`
  → `buildCommitItemsJQL` → JIRA search (all committed features)
  → P0 bugs count query (JIRA)
  → `deriveSignals` (per feature, CPU-only)
  → bucket aggregation
  → `computeReleaseHealthVerdict` (shared)
→ `generateReleaseSummary(intelligence)` (NAI via `aiConnector`)
→ response

**Response shape**
```json
{
  "summary": "## Release Health: RED\n...\n## Top Blockers\n...\n## 7-Day Action List\n...",
  "intelligence": {
    "version": "NDB-2.12",
    "totalFeatures": 28,
    "p0BugsCount": 3,
    "phaseDist": { "CG Met": 12, "CC Met": 8, "Coding (late)": 5, "PG Met": 3 },
    "selfReportedRisk": { "red": 4, "yellow": 9, "green": 12, "notSet": 3 },
    "health": { "verdict": "RED", "rule": 1, "reason": "3 open P0 blocker(s)" },
    "dateMetrics": { "currentCGDate": "2026-06-03", "currentPGDate": "2026-07-15", "daysFromCutoff": 29 },
    "bucketCounts": {
      "gate-lagging": 6,
      "blocked": 2,
      "compliance": 3,
      "dark": 4,
      "watching": 11,
      "clear": 3
    },
    "generatedAt": "2026-06-16T16:30:00.000Z"
  },
  "generatedAt": "2026-06-16T16:30:05.000Z"
}
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | `version` missing | Fix request |
| 400 | `AI_API_KEY` not configured | Admin must set env var |
| 502 | JIRA search failed or NAI returned empty | Show retry button |

**Caching**: No — generated on demand. Typical latency: 15–30 s (JIRA fetch + per-feature signals + NAI call).

**Bucket definitions**:
| Bucket | Meaning |
|---|---|
| `gate-lagging` | Feature has not confirmed clearance of the most recently elapsed release-level gate |
| `blocked` | Feature has a P0/P1 open blocker or other cited blocker in `criticalRisks` |
| `compliance` | Feature has an unfiled security or legal review ticket near or past CG |
| `dark` | Status update is ≥14 days stale |
| `watching` | On track, no critical signals |
| `clear` | At PG Met or Shipped |

---

### POST /api/ai/sos-tier-summary

**Purpose**: Team-exec SoS work-tier briefing (FEAT / Standalone / Direct) from a tiny client-assembled packet — RAG, outstanding-by-type, gates, ≤8 CRITICAL_ITEMS, and CALL_OUTS (Risk not set, stale status updates ≥14d, date moves in last 7d with exact keys). No JIRA on the server.

**Auth**: required (`validateJiraTokenMiddleware`) — token for auth only

**Request**
- Method + path: `POST /api/ai/sos-tier-summary`
- Body:
  - `release` (string, required)
  - `tier` (`feat` | `standalone` | `direct`, required)
  - `ragCounts` `{ Red, Yellow, Green, NotSet }`
  - `itemCount` number
  - `outstandingByType` map of open counts by issue-type group
  - `gateDates` `{ cgDate, pgDate, daysToCommitGate, daysToPromotionGate }`
  - `criticalItems` `[{ key, rag, tldr, summary }]` — max ~8
  - `callouts` optional hygiene packet:
    - `riskNotSet` `{ count, keys[] }`
    - `staleStatusUpdates` `{ count, keys[], thresholdDays }`
    - `dateMovesLast7d` `[{ field, label, keys[] }]` e.g. FS/DS Done Date moved
    - `pastGateLagging` `{ count, keys[], gate: { kind, label, iso, expectedStatus, daysAgo } }` — this release's most recently elapsed gate; status not cleared
    - `datesPastNextGate` `{ count, keys[], gate: { kind, label, iso, daysUntil } }` — item CC/CG/PG dates after upcoming gate ("Keep an eye")
    - `gateContext` `{ pastGate, nextGate }` snapshot of the release calendar
  - `p0Count`, `mustFixCount` numbers
  - `p0Keys`, `mustFixKeys` optional string arrays for VALID TICKET KEYS

**Server flow**
Route → `generateSosTierSummary(payload)` → empty-tier short-circuit OR NAI (`SOS_TIER_SYSTEM_PROMPT`) → response

**Response shape**
```json
{
  "summary": "## FEAT Work — NDB-3.0\n🟡 TLDR: …\n⚠️ Call-outs:\n• Risk Indicator not set (2): ERA-1, ERA-2\n📋 Key Risks:\n• …\n✅ Next Owner Actions:\n• FEAT Manager — …",
  "release": "NDB-3.0",
  "tier": "feat",
  "generatedAt": "2026-09-25T17:00:00.000Z"
}
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | `release` / `tier` missing or invalid | Fix request |
| 400 | `AI_API_KEY` not configured | Admin must set env |
| 502 | NAI empty / upstream failure | Retry that tier |

**Caching**: No — on demand. One call per tier; client runs tiers sequentially per release.
