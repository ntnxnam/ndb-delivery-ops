# AI Chatbot — Data Layer

**Route**: `/chatbot`  
**Component**: `ChatbotPage` (`client/src/release/ChatbotPage.js`)  
**Hooks**: `useChat`  
**Audience**: `tpm` (implementation default)

---

## API endpoints called (client → server)

### 1. `POST /api/ai/chat`

**Purpose**: One agent turn (perceive + read-only tool loop).

**When called**: On Send.

**Body**: `message`, `history` (prior user/assistant turns only), `release`, `productId`, `availableReleases`, `knownTeams`. Optional `audience`.

**Auth**: JIRA token via `authenticatedPost`.

**Server flow**:  
`routes/ai.js` → `chatService.answerChat` → `chatIntentRouter.extractScope` → `chatSnapshotBuilder.buildSnapshot` (disk cache + gate config + optional `buildReleaseIntelligence`) → `loadAgentPack` + `runAgentTurn` (`shared/agentRuntime`) → `aiConnector.completeChat`.

Host tools (read-only): `get_release_snapshot`, `get_release_health`.  
Pack tools (read-only): `list_skills`, `read_skill`, `read_specialist`.

**Response shape**: `{ reply, scope, snapshotMeta, trace, runtime }`.

**Error handling**: 400 missing message; 502 LLM or snapshot failure. Client shows `error` and a retry-friendly assistant line.

**Caching**: No chat transcript persistence. Snapshot rebuilt each turn from `shared/.cache/release-dataset` and release gate config. Health verdict is `computeReleaseHealthVerdict` (code), not the LLM.

---

## Other data

Release list and selected product come from `SelectedReleaseContext` (same as other release pages — versions are the selected team's fixVersions). Team names from `TeamContext` for intent extraction only.
