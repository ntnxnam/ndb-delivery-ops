# AI Endpoints — `/api/ai`

Route file: `apps/delivery-ops/server/routes/ai.js`

---

### POST /api/ai/chat

**Purpose**: Run conversational release Q&A using the same NAI connection as exec/release summaries, enriched with cached release datasets, gate config, and release intelligence.

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
  | `availableReleases` | string[] | no | Client-supplied release list to improve intent extraction |
  | `knownTeams` | string[] | no | Client-supplied team/component names to improve intent extraction |

**Server flow**
`POST /api/ai/chat`
→ `chatIntentRouter.extractScope`
→ `chatSnapshotBuilder.buildSnapshot` (release cache + release gate config + optional release intelligence)
→ `naiService.chatCompletion`
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
  }
}
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 400 | `message` missing/empty | Fix request payload |
| 502 | NAI call failed or snapshot pipeline failed | Show retry affordance and preserve unsent prompt |

**Caching**
- No server-side chat persistence.
- Snapshot is rebuilt per turn from on-disk release cache (`shared/.cache/release-dataset`) and gate config.

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
`POST /api/ai/exec-summary` → `fetchTicketNarrative` (JIRA) → `deriveSignals` → `generateExecSummary` (NAI) → response

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
→ `generateReleaseSummary(intelligence)` (NAI)
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
