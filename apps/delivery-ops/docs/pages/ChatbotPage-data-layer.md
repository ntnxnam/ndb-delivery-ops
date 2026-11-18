# AI Chatbot — Data Layer

**Route**: `/chatbot`  
**Component**: `ChatbotPage` (`client/src/release/ChatbotPage.js`)  
**Hooks**: `useChat`  
**Audience**: `tpm` (implementation default)

---

## API endpoints called (client → server)

### 1. `POST /api/ai/chat`

**Purpose**: One agent turn (perceive + tool loop + memory + provenance).

**When called**: On Send.

**Body**: `message`, `history` (prior user/assistant turns only), `release`, `productId`, `availableReleases`, `knownTeams`. Optional `audience`, `sessionId`.

**Auth**: JIRA token via `authenticatedPost`.

**Server flow**:  
`routes/ai.js` → `chatService.answerChat` → `chatIntentRouter.extractScope` → `chatSnapshotBuilder.buildSnapshot` (live `fetchLivePerRelease` per release, or honest empty snapshot if JIRA fails; gate config + optional `buildReleaseIntelligence`) → load session/user/org memory → `loadAgentPack` + `runAgentTurn` (`shared/agentRuntime`) → `aiConnector.completeChat` → append provenance JSONL.

Host tools: `get_release_snapshot`, `get_release_health` (`read`); `remember_correction` (`draft`); `propose_jira_write` (`mutate`, queue only).  
Pack tools (`read`): `list_skills`, `read_skill`, `read_specialist`.

**Response shape**: `{ reply, scope, snapshotMeta, trace, runtime, sessionId, provenanceId, pendingApprovals, memoryMeta }`.

**Error handling**: 400 missing message; 502 LLM or snapshot failure. Client shows `error` and a retry-friendly assistant line.

**Caching**: Session/user/org JSON + provenance JSONL under `AGENT_RUNTIME_DIR`. Snapshot rebuilt each turn from live JIRA (empty snapshot if JIRA fails) and release gate config.

### 2. `GET /api/ai/approvals`

**Purpose**: List HITL mutate proposals for the current user.

**When called**: Optional refresh; primary path is `pendingApprovals` on the chat response.

**Query**: optional `sessionId`, `status`.

**Auth**: JIRA token.

**Server flow**: `routes/ai.js` → `chatService.listApprovals` → `FileHitlInbox.list`.

### 3. `POST /api/ai/approvals/:id`

**Purpose**: Approve or reject a queued mutate. Approve does **not** write to JIRA (D26).

**When called**: User clicks Approve or Reject on a HITL card.

**Body**: `{ decision: "approve" | "reject" }`.

**Auth**: JIRA token; caller must match `requestedBy`.

**Server flow**: `routes/ai.js` → `chatService.decideApproval` → `FileHitlInbox.decide` (no DateMover / JIRA).

**Response shape**: `{ approval, executed: false }`.

---

### 4. `POST /api/jira-digging/prepare` (Slice 2 — digging)

**Purpose**: Live JIRA count + sample for Custom JQL Digging drawer. No cache in Slice 2; full dataset + history/comments in Slice 2b.

**When called**: User clicks Fetch & Index in digging mode.

**Body**: `{ jql, productId? }` (jql max 4000, productId defaults `ndb`).

**Auth**: JIRA token via `authenticatedPost`; forwarded per-request to `JiraConnector`.

**Server flow**: `routes/jiraDigging.js` → `JiraConnector(searchCount)` → cap 10000 → `searchAll(DIGGING_FIELDS, pageSize 100)` → `datasetId/ticketCount/sampleKeys/fetchedAt`.

**Response shape**: `{ datasetId, jql, productId, ticketCount, sampleKeys[10], fetchedAt, fields, truncated, mode: "live-sample" }` (see `docs/api/jira-digging.md`).

**Error handling**: 400 missing/over-cap, 401 no PAT, 500 JIRA failure; client shows `diggingError` banner and does not create dataset.

---

## Other data

Release list and selected product come from `SelectedReleaseContext` (same as other release pages — versions are the selected team's fixVersions). Team names from `TeamContext` for intent extraction only. Client keeps `sessionId` in `sessionStorage` (`agentChatSessionId`). Digging drawer keeps local `jql/dataset` in `ChatbotPage.js` state; future `AGENT_RUNTIME_DIR` cache mirrors `releaseDatasetCache.ts:297`.
