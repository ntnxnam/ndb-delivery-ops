# AI Chatbot — Requirements

**Route**: `/chatbot`  
**Component**: `ChatbotPage`  
**Permission**: `AI_INSIGHTS_VIEW`  
**Audience**: `tpm` (default presenter; optional `audience` on the API)

---

## Purpose

Conversational Q&A over cached release datasets, gate dates, and computed release health. The page is the D7 chat surface: an Ops Assistant turn, not a mailbox LLM.

## Audiences

Primary: `tpm`  
Secondary: `rm`, `portfolio_mgr`, `team-exec` (same data; denser or shorter prose via audience, Wave 1 defaults to `tpm`)

## User Stories

| ID | Story |
|----|-------|
| CH-01 | As a TPM, I can ask about a selected release and get an answer grounded in the on-disk snapshot. |
| CH-02 | As a user, I can see which tools the agent called (tool trace) under each assistant reply. |
| CH-03 | As a user, I can change the focus release without leaving the page. |
| CH-04 | As a user, I can clear the thread and start over. |
| CH-05 | As a user, ticket keys in replies link to JIRA. |
| CH-06 | As a user, clearing the thread mints a new `sessionId` so session memory does not leak. |
| CH-07 | As a user, I see a provenance id on each assistant reply (audit, not a RAG colour). |
| CH-08 | As a user, a queued mutate shows Approve / Reject; Approve does not write to JIRA (D26 open → `blocked_d26`). |
| CH-09 | As a user, prefixing `remember:` persists a correction for later turns in that session. |

## UI Behaviour

- Header: title, short description, release select (team-scoped fixVersions from `SelectedReleaseContext`), Clear.
- Scope chip after the first successful turn (`intent`, releases, keys).
- Message list: user vs assistant; assistant may show a compact tool trace and a provenance chip.
- HITL cards when `pendingApprovals` is non-empty (Approve / Reject).
- Loading line while a turn is in flight; send disabled.
- Error banner on 4xx/5xx; a fallback assistant line is still appended.

## Permissions

`AI_INSIGHTS_VIEW`. JIRA bearer token required for `/api/ai/chat` and `/api/ai/approvals`.

## Edge Cases

- Empty prompt: submit is a no-op.
- Snapshot missing a named release: agent must say data is unavailable, not invent counts.
- Mutate tools never call `execute()`; Approve records `blocked_d26` (D26 still open).
- Approving another user's inbox item returns 403.

## Acceptance Criteria

- [ ] `POST /api/ai/chat` returns `reply`, `scope`, `snapshotMeta`, `trace`, `runtime: "agent"`, `sessionId`, `provenanceId`.
- [ ] Trace chips render when `trace` is non-empty.
- [ ] Approve on a pending mutate does not call JIRA; response `executed: false`.
- [ ] No `localhost` in client fetch URLs (relative `/api/ai/chat`).
