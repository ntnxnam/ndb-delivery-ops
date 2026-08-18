---
report_type: PRD
product: multi-product
version: "2.0"
generated: 2026-08-04
status: current
audience: tpm, rm, director
---

# Product Requirements Document
## Portfolio Delivery Ops — `delivery-ops`

**Version:** 2.0
**Date:** 2026-08-04
**Status:** Current (supersedes REQUIREMENTS.md and all v1 PRD fragments)
**Owner:** Namratha Singh (Portfolio Manager, Nutanix)

---

## 1. Executive Summary

Portfolio Delivery Ops is an internal Nutanix delivery-operations platform that consolidates release management, sprint analytics, AI-assisted executive briefings, and status communication into a single web application. It replaces a fragmented ecosystem of 17 legacy tools. The platform is product-agnostic by design (D1): NDB is the primary tenant today; DataLens, NCM, and future products are equal peers.

**Primary user:** Portfolio Manager (Namratha Singh)
**Adjacent users:** Team Executive, TPM, RM, Feature Manager, Team Lead, IC, QA Lead
**Primary pain point eliminated:** Portfolio Manager spends 60–80% of the week reactively answering status questions that the system can answer directly.

---

## 2. Background & Problem Statement

### 2.1 Before This Platform

| Problem | Impact |
|---|---|
| 17 separate tools, each requiring separate auth and maintenance | 3–4 hours/week of tool-switching overhead |
| Status emails composed manually from JIRA + Confluence | 2 hours per email cycle |
| No single source of truth for gate dates and risk indicators | Executives get inconsistent information |
| JIRA changelog pagination silently dropped historical date data | Incorrect Gantt charts, wrong delay calculations |
| Team Executives query the Portfolio Manager for every status question | PM becomes a synchronous bottleneck |

### 2.2 Vision

*Make every stakeholder self-sufficient.* The Portfolio Manager should only touch the platform to act, not to answer. All other personas — Team Executive, TPM, RM, IC — get answers directly from the platform or its AI agent.

---

## 3. Users & Personas

| Persona | Who | Primary Need |
|---|---|---|
| **Portfolio Manager** | Namratha Singh | Reduce reactive load; own gate compliance; send status comms |
| **Team Executive** | Engineering VP/SVP | Plain-language release health; 3–5 charts; no JQL |
| **TPM** | Technical Program Managers | Cross-team dependency visibility; 3-tier weekly status |
| **RM (Release Manager)** | Release-tracking owners | Gate dates; cascade renames; gate readiness |
| **Feature Manager** | Feature/Initiative owner | Scoped view: their feature, its epics, their gate dates |
| **Team Lead / EM** | Engineering Manager | Team-scoped sprint velocity; sprint health; bug burndown |
| **IC** | Individual Contributor | Their tickets; terse, action-oriented |
| **Admin** | Namratha + designated admins | User/team management; system config |

---

## 4. Product Scope

### 4.1 In Scope (Current Platform — v1.3+)

| Feature Domain | Description |
|---|---|
| **Status Email Sender** | Extract Confluence content → compose → send via SMTP |
| **Release Version Status** | Full JIRA payload table with gate dates, history, risk indicators, Gantt |
| **Feature Dashboard** | Feature-level gate progress; reconciliation view |
| **Release Config** | Edit milestone/gate dates inline |
| **Release Setup** | Create/rename/cascade-rename JIRA release versions |
| **Sprint Report** | Three-velocity-stream sprint analytics (Dev / QA-Verification / QA-Test) |
| **Component Report** | Component health; deferral trends; actionable metrics |
| **Release Retrospective** | Gate compliance "naughty list"; per-project violation detail |
| **Generic Emailer** | Run JQL → select columns → send email |
| **KPI Dashboard** | Team-scoped KPI metrics with JIRA click-throughs |
| **Sync Hub** | Release dataset sync control; per-release bucket status |
| **AI Chat** | Embedded conversational AI; release Q&A backed by dataset |
| **AI Exec Summary** | Per-feature AI summary written to JIRA custom field |
| **AI Release Briefing** | Release-level RAG verdict + blockers + 7-day action list |
| **Admin Panel** | User management; team config; system settings |
| **Email History** | Audit trail of sent emails |
| **MCP Tools** | 8 Cursor-accessible tools (bin-packing, story points, Gantt, status, etc.) |

### 4.2 Out of Scope (Explicitly Excluded)

- Real-time collaboration features (WebSockets / multi-user cursors)
- Mobile application
- Offline mode
- Multi-language / i18n
- SaaS-grade multi-tenancy (separate auth domains, separate DBs per product)
- Direct JIRA mutation beyond gate-date moves (D30) and exec-summary writes
- Slack integration (planned Phase B, not shipped)
- GitHub connector in the web app (MCP-only today)

---

## 5. Functional Requirements

### 5.1 Authentication & Authorization

| ID | Requirement |
|---|---|
| REQ-AUTH-001 | Users authenticate with JIRA PAT (email + token) |
| REQ-AUTH-002 | Token validated against `GET /rest/api/2/myself` on each login |
| REQ-AUTH-003 | Credentials stored in browser `localStorage`; cleared on logout |
| REQ-AUTH-004 | Username normalized: `namratha.singh` or `namratha.singh@nutanix.com` both accepted |
| REQ-AUTH-005 | Three RBAC tiers: Super Admin > Admin > Authenticated User |
| REQ-AUTH-006 | Permissions are fine-grained (20+ permission keys); mapped from legacy allow-lists in `allowedUsers.json` |
| REQ-AUTH-007 | `ProtectedRoute` wrapper enforces permissions client-side; server enforces independently |
| REQ-AUTH-008 | All admin tabs gated by `admin_panel_access` permission only (D6: other tabs are UX defaults, not security gates) |
| REQ-AUTH-009 | Rate limiting: 5 req/15 min on auth endpoint |

### 5.2 Status Email Sender

| ID | Requirement |
|---|---|
| REQ-EMAIL-001 | Accept Confluence page URL in full or relative form (5 URL patterns supported) |
| REQ-EMAIL-002 | Extract page content via Confluence REST API; display in read-only textarea |
| REQ-EMAIL-003 | Compose email with: Executive Summary (required), Additional Details (rich text, ReactQuill), JIRA key (optional) |
| REQ-EMAIL-004 | Fetch JIRA ticket data by key; display hierarchy (Features → Epics → work items) |
| REQ-EMAIL-005 | Send email to semicolon-separated recipients via SMTP (`mailrelay.dyn.nutanix.com:25`) |
| REQ-EMAIL-006 | `namratha.singh@nutanix.com` auto-added to CC on every outbound email |
| REQ-EMAIL-007 | Form clears 2 seconds after successful send |
| REQ-EMAIL-008 | Audit entry written to email history on every send |

### 5.3 Release Version Status (Project Status Page)

| ID | Requirement |
|---|---|
| REQ-RVS-001 | Display release picker populated from active/inactive JIRA `fixVersion` values |
| REQ-RVS-002 | Auto-load default release on page mount (from config); 10-min TTL cache |
| REQ-RVS-003 | Two table sections: Section 1 (Commit), Section 2 (Long-term-funded) |
| REQ-RVS-004 | Column config driven from `releaseVersionsColumnsConfig.json`; UI and email flags independent |
| REQ-RVS-005 | Gate date columns: FS/DS Done, Test Plan, Code Complete, Commit Gate, Promotion Gate |
| REQ-RVS-006 | Dates display with history: `CurrentDate→Prev→Older` with strikethrough; color-coded (green=on-time, red=delayed) |
| REQ-RVS-007 | Delay shown as "N days late" (≤3 days) or "N.5 weeks late" (>3 days) |
| REQ-RVS-008 | Code Complete extension labels (pattern: `{release}-{ddmmyyyy}-code-complete-extention-recieved`) highlighted in colored background |
| REQ-RVS-009 | Risk indicator (Green/Yellow/Red) from `customfield_23560` displayed per item |
| REQ-RVS-010 | Gantt chart: EC→GA timeline, Code Complete bar (purple `#9370DB`), historical date markers |
| REQ-RVS-011 | All JIRA keys in table and Gantt are clickable links opening in new tab |
| REQ-RVS-012 | Email generation: frontend builds table HTML, backend wraps with header + notes + legend + Gantt SVG |
| REQ-RVS-013 | Changelog pagination: when `changelog.total > changelog.histories.length`, fetch all pages using 3-strategy fallback |

### 5.4 Release Dataset & Sync Hub

| ID | Requirement |
|---|---|
| REQ-DS-001 | Full 6-bucket JIRA payload fetched and cached to disk (`shared/.cache/`) per release |
| REQ-DS-002 | Three groups: Group 1 (committed), Group 2 (moved-out), Group 3 (long-term-funded) |
| REQ-DS-003 | Sync Hub page shows per-release, per-bucket cache freshness table |
| REQ-DS-004 | Manual sync triggered from UI; progress streamed via SSE |
| REQ-DS-005 | Cell-level sync: re-fetch one bucket for one release without full sync |
| REQ-DS-006 | Cache TTL: `bundle.meta.json` records last-synced timestamp; UI shows staleness age |
| REQ-DS-007 | Release dataset served from cache at all times; "Refresh" button for live data (D11) |

### 5.5 Sprint Report

| ID | Requirement |
|---|---|
| REQ-SPRINT-001 | Sprint velocity split into three streams: Dev / QA-Verification (adjusted ×0.33) / QA-Test Tasks |
| REQ-SPRINT-002 | Sprints are 3-week Wednesday-anchored from S1=2024-10-09 |
| REQ-SPRINT-003 | Sprint charts sorted numerically (S1, S2, … S25) not alphabetically |
| REQ-SPRINT-004 | Every metric has clickable JIRA link showing the underlying query |
| REQ-SPRINT-005 | Portfolio hierarchy items (Feature, Initiative, Epic, X-FEAT, Capability) excluded from velocity |
| REQ-SPRINT-006 | Milestone events (EC, CG, PG, GA) shown as markers on sprint chart |

### 5.6 Release Retrospective

| ID | Requirement |
|---|---|
| REQ-RETRO-001 | For each project in the release, compute gate compliance: did CC / CG / PG / GA land on time? |
| REQ-RETRO-002 | "Naughty list" table: projects that violated gate contracts, sorted by severity |
| REQ-RETRO-003 | Per-project detail page: full timeline of date changes with reasons |
| REQ-RETRO-004 | Bootstrap mode: fast gate-check summary from bundle (no live JIRA call) |

### 5.7 AI Features

| ID | Requirement |
|---|---|
| REQ-AI-001 | Chat panel (D7): embedded conversational AI using NAI; answers release/ticket Q&A |
| REQ-AI-002 | AI uses release dataset bundle as context (not raw JIRA per-query) |
| REQ-AI-003 | Per-feature Exec Summary: AI generates 20-point status update; RM reviews; written to JIRA |
| REQ-AI-004 | Release Briefing: RAG verdict (Green/Amber/Red) + top blockers + 7-day action list |
| REQ-AI-005 | RAG rules (deterministic, not LLM-generated): P0 open → RED; mustfix open ≤14 days to PG → RED; etc. |
| REQ-AI-006 | Ticket key integrity: LLM must copy keys verbatim from `VALID TICKET KEYS` list; never hallucinate |
| REQ-AI-007 | Panel border and header always neutral; RAG badge appears once in summary body only |

### 5.8 Release Setup & Config

| ID | Requirement |
|---|---|
| REQ-SETUP-001 | Create new JIRA `fixVersion` in ERA project from UI |
| REQ-SETUP-002 | Rename a release version with cascade: renames related JIRA filters too |
| REQ-SETUP-003 | Cleanup stale/duplicate JIRA filters by prefix |
| REQ-SETUP-004 | Edit milestone/gate dates for a release from Release Config page |
| REQ-SETUP-005 | Gate date move (D30): requires reason; Confluence audit trail written before JIRA mutation; rolled back if Confluence write fails |

### 5.9 KPI Dashboard

| ID | Requirement |
|---|---|
| REQ-KPI-001 | Team-scoped KPI metrics (configurable per team via `teamBoardConfig.json`) |
| REQ-KPI-002 | Every KPI count links to its JIRA query (authenticity, D10) |
| REQ-KPI-003 | Batch KPI results: multiple KPIs fetched in parallel to reduce JIRA round-trips |

### 5.10 Component Report

| ID | Requirement |
|---|---|
| REQ-COMP-001 | Component-level health metrics: open vs closed, deferral rate, risk distribution |
| REQ-COMP-002 | Actionable metrics: items with no assignee, items past due, items missing test plan |
| REQ-COMP-003 | JIRA click-throughs on every metric |

### 5.11 Admin Panel

| ID | Requirement |
|---|---|
| REQ-ADMIN-001 | Add/remove users; assign to RBAC tier |
| REQ-ADMIN-002 | Add/edit teams; configure team's board ID, base filter, KPI set |
| REQ-ADMIN-003 | "Test Connection & Refresh Permissions" button forces auth re-validation |

---

## 6. Non-Functional Requirements

### 6.1 Performance

| ID | Requirement |
|---|---|
| NFR-PERF-001 | Page first-paint < 3 seconds on LAN |
| NFR-PERF-002 | Table render with 150+ items < 2 seconds |
| NFR-PERF-003 | API endpoints respond in < 5 seconds (excluding JIRA batch calls) |
| NFR-PERF-004 | Release dataset cache serves page in < 500ms (disk reads only) |
| NFR-PERF-005 | Sync of one release bucket < 60 seconds |

### 6.2 Security

| ID | Requirement |
|---|---|
| NFR-SEC-001 | JIRA PAT never logged or echoed; stored only in browser `localStorage` |
| NFR-SEC-002 | All outbound JIRA/Confluence calls use HTTPS |
| NFR-SEC-003 | CORS restricted to `ALLOWED_ORIGINS` env var; no wildcard in production |
| NFR-SEC-004 | Helmet.js security headers on all responses |
| NFR-SEC-005 | Rate limiting: tiered by endpoint class (auth, email, API, checkpoint history) |
| NFR-SEC-006 | HTML input sanitized before inclusion in email content |
| NFR-SEC-007 | No hardcoded `localhost` or `127.0.0.1` in production code |

### 6.3 Reliability

| ID | Requirement |
|---|---|
| NFR-REL-001 | JIRA API retried with exponential backoff (3 retries; 429 and 5xx) |
| NFR-REL-002 | SMTP failures surface a user-visible error; do not silently drop emails |
| NFR-REL-003 | Changelog pagination failure returns partial data with warnings; does not block page |
| NFR-REL-004 | Cache read failure falls back to empty/loading state; does not crash |

### 6.4 Maintainability

| ID | Requirement |
|---|---|
| NFR-MAINT-001 | Components render; hooks fetch; services transform (minimal-architecture rule) |
| NFR-MAINT-002 | Route handlers ≤ 150 lines; services ≤ 500 lines; components ≤ 600 lines |
| NFR-MAINT-003 | Custom field IDs in one place only: `server/config/jiraFieldsConfig.json` |
| NFR-MAINT-004 | No hardcoded product strings (NDB, ERA, FEAT) in non-config code |
| NFR-MAINT-005 | Every new API endpoint has a doc entry in `docs/api/{resource}.md` before merge |

### 6.5 Browser Compatibility

Chrome ≥ 120, Firefox ≥ 120, Safari ≥ 17, Edge ≥ 120.

---

## 7. User Stories

### Portfolio Manager

- **US-PM-001** As a PM, I extract a Confluence page and send a formatted status email in under 5 minutes.
- **US-PM-002** As a PM, I view all committed features for NDB-2.12 with their current gate dates and any slippage highlighted, without opening JIRA.
- **US-PM-003** As a PM, I trigger a dataset sync and watch per-bucket progress stream live so I know when data is fresh.
- **US-PM-004** As a PM, I move a gate date with a reason and an automatic Confluence audit trail, so I have a defensible record.
- **US-PM-005** As a PM, I generate an AI release briefing and review it before forwarding to the Team Executive.

### Team Executive

- **US-TE-001** As a Team Executive, I ask "how's NDB-2.12?" in the chat panel and get a RAG verdict, top 3 blockers, and a 7-day action list.
- **US-TE-002** As a Team Executive, I view the release briefing panel and see one RAG badge (not three) with cited JIRA keys.

### TPM / RM

- **US-TPM-001** As a TPM, I view sprint velocity for the NDB team broken into Dev, QA-Verification, and QA-Test streams, with JIRA links on every number.
- **US-RM-001** As an RM, I view the retrospective naughty list for NDB-2.11 and drill into each project's gate violation timeline.
- **US-RM-002** As an RM, I create a new JIRA release version and its associated filters from the Release Setup page.

### Feature Manager

- **US-FM-001** As a Feature Manager, I view my feature's epics, their gate dates, and open blocker count without asking the PM.

---

## 8. Acceptance Criteria

| ID | Criterion | Pass condition |
|---|---|---|
| AC-001 | Email send | Email delivered within 30 seconds; CC contains `namratha.singh@nutanix.com`; audit entry written |
| AC-002 | Release table | All committed items for selected release shown; dates color-coded correctly; extension labels highlighted |
| AC-003 | Gantt accuracy | Code Complete bar ends at current CC date; historical markers match JIRA changelog (including paginated) |
| AC-004 | Dataset sync | All 6 buckets complete; `bundle.json` and `bundle.meta.json` updated; Sync Hub shows fresh timestamp |
| AC-005 | Sprint velocity | Three velocity streams shown as separate bars; sprint order is S1, S2, … numeric; every bar links to JIRA |
| AC-006 | AI RAG verdict | Verdict follows deterministic rules (P0 open → RED, no exceptions); panel border is neutral; badge appears once |
| AC-007 | Ticket key integrity | No AI-generated output contains a JIRA key that was not in the source data |
| AC-008 | Gate date move | JIRA field updated only after Confluence audit page created; rollback on Confluence failure |

---

## 9. Constraints

1. JIRA PAT is user-supplied; the platform cannot pre-provision access.
2. SMTP relay (`mailrelay.dyn.nutanix.com:25`) has no auth; available only on Nutanix internal network.
3. NAI (AI API) requires `AI_API_KEY` env var; responses are non-deterministic and must be reviewed before forwarding.
4. JIRA API rate limits enforced at ~300 req/min per token; batch operations must respect backoff.
5. Confluence API (port 8443) accessible only from the server host; not proxied to the client.
6. Production server is Rocky Linux 9; deploy is via SCP + PM2 (no CI/CD pipeline today).

---

## 10. Future Roadmap (Planned, Not Committed)

| Phase | Feature |
|---|---|
| B | Persona-aware Sidebar + role lens (D6) + product picker (D1) |
| C | Embedded chat panel fully integrated in delivery-ops React (D7) |
| D | Connector consolidation into `shared/connectors/` (5 connectors per D3) |
| E | Streamlit → React rewrite of release-analytics |
| F | Streamlit → React rewrite of tpm-confluence-tools + Release Gates Checklist (D20) |
| G | Capacity Planner, Bin-Packing React port, Story Points, Date Mover UI, Say-vs-Do page |
| H | Sprint Planner, Status Page Auto-Publisher, Slack integration |
