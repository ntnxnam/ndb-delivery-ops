---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
source: doc-release-notes @ 2026-05-19
---

# Release Notes

> Rolling notes. Per-release files live under `docs/release-notes/<version>.md`. Maintained by `doc-specialist` via `doc-release-notes`.

## NDB 2.11 — _TBD_

See [release-notes/NDB-2.11.md](./release-notes/NDB-2.11.md) when cut.

### NDB 2.12 — JIRA Digging + Chatbot beam Ask (Slice 1.5a · 2b · 3)

- **Custom JQL Digging — Fetch & Index → Ask** in `/chatbot` (Slice 2b+3): `POST /api/jira-digging/prepare` validates JQL, `searchCount` (cap 10 000) → `searchAll` (500/page, `DIGGING_FIELDS`) → optional `changelog`/`comments` enrichment (concurrency 5) → `shared/.cache/jira-digging/{productId}/{jqlHash}/` (`manifest.json` + `tickets.json.gz`). Then **Ask** in digging mode posts `datasetId`+`jqlHash` to `POST /api/ai/chat` → `shared.answerDiggingAsk` (load + compact + beam `muse-spark` grounded only in that staged set, cites `[KEY-...]`). See [api/jira-digging](./api/jira-digging.md) and [ChatbotPage — Data Layer](./pages/ChatbotPage-data-layer.md).
- **JQL autocomplete** in the digging drawer (Slice 1.5a): ghost + dropdown from local scrub of `jiraFieldsConfig.json` (30 fields + 43 `customfield_*`) + ScriptRunner templates (`portfolioChildrenOf`, etc.) via `jqlAutocompleteLogic.js`; `Tab`/`Enter`/`↑↓`/`Esc`; see [ChatbotPage — Requirements](./pages/ChatbotPage-requirements.md) CH-11.
- Feature flags `REACT_APP_ENABLE_JIRA_DIGGING` / `REACT_APP_ENABLE_JQL_AUTOCOMPLETE` (both default `true` — see [ADMIN_GUIDE](./ADMIN_GUIDE.md#feature-flags)); ports fixed to **8899** (React) / **8001** (Express), `8888` removed.
- Beam Ask is read-only (D26): every digging answer carries `trace: loadDiggingCache` + `provenanceId`; no JIRA writes.

### Recent changes (TCMS Quality table)

- TCMS Quality table now renders **Functional** and **System** rows (2×2:
  Functional/System × Manual/Automation) instead of the legacy
  Overall/Functional/Automation layout. `Overall` is no longer a row/title.
- Window label aligned to data source: **Last 4 weeks** (key
  `releaseLast4Weeks`/`masterLast4Weeks`), with deprecated alias
  `releaseLast3Weeks`/`masterLast3Weeks` retained for back-compat.
- Legacy `overall` data falls back to the **System** row for back-compat.
- Caveat: Functional and System rows currently share the same source metrics
  (clone) until TCMS exposes a `test_category` filter — see
  `KNOWN_ISSUES.md` and `docs/tcms-rows-followup.md`.
- TCMS time-filtered metrics corrected: "Last 4 weeks" now queries
  `/api/v1/all_test_cases/aggregate/metrics` with `time_filter=four_weeks`
  and `target={milestone}-qcow2`, returning genuinely filtered data instead
  of erroring or echoing Overall. See `docs/tcms-rows-followup.md` (Endpoint
  migration).

## Template for next release

Copy into `release-notes/<version>.md`:

- Highlights (3-5 exec-readable bullets)
- What's New / Enhancements / Bug Fixes
- Breaking Changes (⚠️ + migration step)
- Upgrade Notes
- Known Issues → [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)
