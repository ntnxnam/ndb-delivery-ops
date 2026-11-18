---
product: NDB Delivery Ops
release: "2.12"
date: 2026-05-19
gate: GA TBD
source: doc-specialist @ 2026-05-19
---

# Release Notes — NDB 2.12

## Highlights

- **Chatbot Custom JQL Digging — Fetch & Index → Ask** (Slices 2b+3): pick any JQL, fetch the live set once (cap 10 000), then ask grounded questions whose answers cite tickets from that set only. See [api/jira-digging](../api/jira-digging.md).
- **Beam Ask grounded in staged set:** `POST /api/ai/chat` digging branch → `shared.answerDiggingAsk` → `muse-spark` with compacted tickets; read-only (D26), emits `trace` + `provenanceId`.
- **JQL autocomplete** (Slice 1.5a) in the digging drawer: fields/operators/values from `jiraFieldsConfig.json` + ScriptRunner templates; `Tab`/`Enter`/`↑↓`/`Esc`.
- **Feature flags** `REACT_APP_ENABLE_JIRA_DIGGING` / `REACT_APP_ENABLE_JQL_AUTOCOMPLETE` (both default `true`) + fixed ports **8899**/**8001** (see [ADMIN_GUIDE](../ADMIN_GUIDE.md#feature-flags)).

## What's New

- `POST /api/jira-digging/prepare` (Slice 2b): `{ jql, productId?, includeHistory?, includeComments? }` → validate → `searchCount` → `searchAll` (500/page, `DIGGING_FIELDS`) → optional `getIssue({expand:changelog})` + `getComments` (concurrency 5) → `shared/.cache/jira-digging/{productId}/{jqlHash}/` (`manifest.json` + `tickets.json.gz`). See [api/jira-digging](../api/jira-digging.md).
- `POST /api/ai/chat` digging branch (Slice 3): when `datasetId`/`jqlHash` present, loads cached tickets, compacts, and answers via beam; response `runtime: "digging"`, `scope.intent: "digging"`, `snapshotMeta.mode: "digging"`. See [ChatbotPage — Data Layer](../pages/ChatbotPage-data-layer.md).
- `/chatbot` UI: **Active Releases | Custom JQL Digging** toggle, digging drawer with presets + History/Comments toggles, dataset card with dual-click (count → Ask, **Open in JIRA (N)** → exact JQL), sample keys as browse links, scope chip + Clear dataset. See [ChatbotPage — Requirements](../pages/ChatbotPage-requirements.md).
- Ports hardened: `8899` (React) / `8001` (Express) — `8888` references removed (commit `863dac3`).

## Breaking Changes

- None for existing release/sprint flows. `8888` bookmarks must move to `8899` (React) / `8001` (API).

## Upgrade Notes

- No env change required unless kill-switching: set `REACT_APP_ENABLE_JIRA_DIGGING=false` or `REACT_APP_ENABLE_JQL_AUTOCOMPLETE=false` and rebuild the client.
- JIRA Digging cache lives under `shared/.cache/jira-digging/` (gitignored) — no migration.

## Known Issues

- Complex `membersOf()` nesting is not yet supported in JQL — use OR-chain workaround. See [KNOWN_ISSUES.md](../KNOWN_ISSUES.md).
- TCMS Quality rows still cloned — see [KNOWN_ISSUES.md](../KNOWN_ISSUES.md).
