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
| CH-02 | As a user, I can see which tools the agent called (read-only trace) under each assistant reply. |
| CH-03 | As a user, I can change the focus release without leaving the page. |
| CH-04 | As a user, I can clear the thread and start over. |
| CH-05 | As a user, ticket keys in replies link to JIRA. |

## UI Behaviour

- Header: title, short description, release select (team-scoped fixVersions from `SelectedReleaseContext`), Clear.
- Scope chip after the first successful turn (`intent`, releases, keys).
- Message list: user vs assistant; assistant may show a compact tool trace.
- Loading line while a turn is in flight; send disabled.
- Error banner on 4xx/5xx; a fallback assistant line is still appended.

## Permissions

`AI_INSIGHTS_VIEW`. JIRA bearer token required for `/api/ai/chat`.

## Edge Cases

- Empty prompt: submit is a no-op.
- Snapshot missing a named release: agent must say data is unavailable, not invent counts.
- Wave 1 cannot write to JIRA from chat (mutate tools refused).

## Acceptance Criteria

- [ ] `POST /api/ai/chat` returns `reply`, `scope`, `snapshotMeta`, `trace`, `runtime: "agent"`.
- [ ] Trace chips render when `trace` is non-empty.
- [ ] No `localhost` in client fetch URLs (relative `/api/ai/chat`).
