---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
coversVersion: "2.11"
source: doc-user-guide @ 2026-05-19
---

# User Guide

> For IC / TPM / FEAT / QA personas. Maintained by `doc-specialist` via `doc-user-guide`.

## Table of Contents
- [Getting Started](#getting-started)
- [Sprint Report](#sprint-report)
- [Release Brief](#release-brief)
- [Quality Column (TCMS)](#quality-column-tcms)
- [Tips & FAQ](#tips--faq)

## Getting Started

1. Log in at `/login` (RBAC via `allowedUsers.json` — see [ADMIN_GUIDE.md](./ADMIN_GUIDE.md#rbac)).
2. Pick product + release in the header.
3. Use sidebar tabs per your permission.

## Sprint Report

**Who:** TPM, FEAT owners
**Steps:** Open Sprint Report → select sprint → review burndown/burnup.
**Tips:** Use `?` filter help for JQL-backed counts.

## Release Brief

**Who:** Team Exec / Director
**Steps:** Open Release Brief → check RAG + blockers → drill into FEAT.

## Quality Column (TCMS)

**Who:** TPM, FEAT owners, QA

The Quality column on the Project Status table shows TCMS test results per
feature.

- **Four tables per feature**: `Release — Overall`, `Release — Last 4
  weeks`, `Master — Overall`, `Master — Last 4 weeks`.
- **Each table is a 2×2 grid**:
  - Rows: **Functional**, **System**
  - Columns: **Manual**, **Automation**
  - Cells: QI / Run / Passed / Failed / Rate
- **Last 4 weeks** window reflects runs in the most recent 4-week window;
  shows "Not Set" when there are no runs in that window (it does not fall
  back to Overall). Time-filtered runs now come from the corrected TCMS
  metrics endpoint (`/api/v1/all_test_cases/aggregate/metrics` with
  `time_filter=four_weeks`).
- **Caveat:** Functional and System rows currently share the same source
  metrics until TCMS exposes a `test_category` filter. Do not read
  distinctness into the two rows yet. See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

## AI Chatbot — Custom JQL Digging (Fetch & Index → Ask)

**Who:** Manager / TPM / Eng Lead — anyone who needs ad-hoc JIRA answers without writing JQL twice.
**Route:** `/chatbot` → toggle **Custom JQL Digging** (see [ChatbotPage — Requirements](./pages/ChatbotPage-requirements.md) and [Data Layer](./pages/ChatbotPage-data-layer.md); API [jira-digging](./api/jira-digging.md)).

**Flow:**

1. Switch to **Custom JQL Digging** in the header. If the toggle is greyed out the feature flag is off — see [ADMIN_GUIDE.md](./ADMIN_GUIDE.md#feature-flags).
2. Enter **Base JQL** in the digging drawer (presets help; autocomplete suggests fields/operators/values — `Tab` to accept ghost text, `↑/↓` + `Enter` in the dropdown).
3. Optionally tick **History** / **Comments** to enrich each ticket with changelog + comments (slower beyond ~500 tickets; see `docs/api/jira-digging.md` `enrichHistoryComments`).
4. Click **Fetch & Index** — server validates JQL, paginated `searchAll` (cap 10 000), caches to `shared/.cache/jira-digging/{productId}/{jqlHash}/` and returns the dataset card (`Cached dataset · N tickets · History: on/off · Comments: on/off`, sample keys, `Open in JIRA (N)`).
5. **Ask** in the bottom input — e.g. "summarize blockers in this dataset", "top P0/P1 by status", "which tickets lack fixVersion?" — Send/Ask routes to `POST /api/ai/chat` with `datasetId`+`jqlHash` (Slice 3 beam) and answers ground **only** in that staged set.

**What you get:**

- Answers cite tickets inline as `[KEY-123]`; each citation is a linkable key (paste-safe). Every turn also leaves a **trace** (`loadDiggingCache`) and a **provenance** chip — see Chatbot data-layer for the full `POST /api/ai/chat` shape when `isDigging`.
- **Dual-click on every metric:** the dataset card's **ticket count** focuses the Ask input; **Open in JIRA (N)** opens the exact same JQL in JIRA; **Sample keys** each link to `https://jira.nutanix.com/browse/<KEY>`.

**Permissions:** `AI_INSIGHTS_VIEW` + a valid JIRA PAT (Bearer). No PAT → 401 from `validateJiraTokenMiddleware`.

## Tips & FAQ

- Missing tab? Check permissions in [ADMIN_GUIDE.md](./ADMIN_GUIDE.md).
- Chatbot docs: [ChatbotPage — Requirements](./pages/ChatbotPage-requirements.md) · [ChatbotPage — Data Layer](./pages/ChatbotPage-data-layer.md) · [JIRA Digging API](./api/jira-digging.md).
- Caveats? See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).