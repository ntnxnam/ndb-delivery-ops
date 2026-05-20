# Architecture — NDB-Delivery-Ops

This document describes **how the platform is structured** to support the
features defined in `FEATURE_CATALOG.md`. The architecture is layered so that
each external system (JIRA, Confluence, GitHub, AI) has exactly one connector,
and every feature surface — web page, MCP tool, agent skill — sits on top of
shared services.

## Guiding principles

1. **One feature, one place.** Each capability has a single canonical
   implementation. Anything that needs it imports it.
2. **Product-agnostic by design** (D1). The platform supports any product —
   NDB is one tenant, DataLens / NCM / future products are equally valid.
   No NDB-specific strings in code; everything is config-driven.
3. **Connectors are sacred.** All access to JIRA / Confluence / GitHub /
   Slack / Email goes through one module per system. No ad-hoc
   `axios.get(JIRA_URL/…)` inside route handlers or React components.
4. **Services own business logic.** Routes are thin. Pages are thin.
   The heavy lifting lives in a service that's reusable from the web app,
   the MCP server, or a CLI.
5. **One runtime for users.** Users interact with **one React app** on
   `:8888`. Streamlit gets retired (see Phase D/E in the rollout).
6. **Personas drive *presentation*, not access** (D6). The role lens
   re-renders the same data using audience-appropriate style. It does **not**
   hide pages.
7. **AI is a surface, not a separate product.** The MCP server, skills,
   agents, and rules are the AI surface of the same features the web app
   exposes — not a parallel implementation.
8. **Workflows for recurring artefacts, agents for ad-hoc questions** (D9 vs D8).
   Strict adherence to Anthropic's pattern selection.

Decision IDs (D1, D6, D8, D9, etc.) reference `DECISIONS.md`.

---

## The five layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 5: UI & AI surfaces                                            │
│  ┌────────────────────────────┐    ┌─────────────────────────────┐   │
│  │ delivery-ops React app     │    │ Cursor agents & workflows   │   │
│  │ (single :8888 runtime,     │    │ (TPM, RM, Team Executive, FEAT Mgr,     │   │
│  │  persona-aware sidebar)    │    │  Team Mgr, IC assistants)   │   │
│  └────────────────────────────┘    └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
                       ▲                              ▲
                       │ HTTP                         │ MCP / stdio
                       │                              │
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 4: API + MCP tools                                             │
│  ┌────────────────────────────┐    ┌─────────────────────────────┐   │
│  │ delivery-ops server/       │    │ mcp-server/src/tools/       │   │
│  │ (Express routes, thin)     │    │ (one tool per feature)      │   │
│  └────────────────────────────┘    └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
                       ▲                              ▲
                       │                              │
                       └──────────────┬───────────────┘
                                      │
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 3: Services (business logic, shared across surfaces)           │
│   releaseService    statusService    capacityService                 │
│   timelineService   predictabilityService  kpiService                │
│   confluencePublishService   triageService   sprintService           │
└──────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2: Domain models + shared types                                │
│   Release, Sprint, Ticket, Persona, RAG, RiskScore, …                │
│   (one TS definition, imported by services and surfaces)             │
└──────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 1: Connectors (one per external system)                        │
│   jiraConnector    confluenceConnector                               │
│   githubConnector  aiConnector (LLM)                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Connectors

Lives in `shared/connectors/` (new). One TypeScript module per external system.
Each connector:
- Owns auth (PAT, OAuth, API key)
- Owns retries, timeouts, error wrapping
- Returns typed responses (from Layer 2 domain models)
- Has no business logic — it's a pure adapter

| Connector | Purpose | Replaces |
|---|---|---|
| `jiraConnector` | All JIRA REST + Agile API calls | `mcp-server/src/connectors/jiraConnector.ts` + scattered `axios.get(JIRA_URL/…)` in `server/routes/jira/index.js` + auth in `server/middleware/auth/jira.js` |
| `confluenceConnector` | All Confluence REST calls | `apps/tpm-confluence-tools/src/confluence_client.py` + `apps/delivery-ops/client/src/services/confluenceService.js` |
| `githubConnector` | GitHub commits / PRs / repos / CI signals | code currently embedded in `mcp-server/src/tools/leadershipCommitReport.ts` |
| `slackConnector` *(new)* | Read channels, post messages, DM agent (D3) | net-new |
| `emailConnector` *(new)* | Send digests; potentially read inbox for status pings (D3) | partial `nodemailer` usage in `server/routes/email.js` — extract + extend |
| `aiConnector` | LLM calls for predictions, summaries, chat | `crystalball-i/` internals |

### Layer 2 — Domain models

Lives in `shared/types/`. Pure TypeScript types + small helpers (no IO).

```ts
// shared/types/release.ts
export interface Release { name: string; ec: Date; cc: Date; pg: Date; status: RAG; … }
export type RAG = 'green' | 'amber' | 'red';
export interface Ticket { key: string; summary: string; issueType: IssueType; … }
```

Both server-side services and React components import from here.

### Layer 3 — Services

Lives in `server/services/` (in `apps/delivery-ops/`). Each service owns
one domain's business logic. A service:
- Calls connectors (Layer 1)
- Uses domain models (Layer 2)
- Is stateless — every call is self-contained
- Is reusable from Express routes (Layer 4) and MCP tools (Layer 4)

Status legend: ● shipped (TS lives in `shared/services/`), ◐ partially
shipped, ○ planned. Service names that ended up different from the original
plan are noted in parens. See `CONSOLIDATION.md` for the per-capability port
status.

| Service | Status | Owns | Used by |
|---|---|---|---|
| `productService` (D1, D34) | ● | Resolve `productId` → `projectKey`, `labelPrefix`, `releasePrefix`, `sprintCalendar`, audience overrides, Confluence space. Reads `teamBoardConfig.json`. The **only** source for these D1 inputs. | every service that touches external systems |
| `payloadJqlService` (#1a, D36) | ● | Build the 5-bucket release JQL union. Exposes both `buildEngineeringPayloadJql` (project-scoped, legacy) and `buildReleasePayloadJql` (cross-project, new) — see "Payload concepts" below. Wishlist + deferred sidecars. | release dataset, future engineering/release dashboards |
| `ticketFetchService` (#17) | ● | 8-clause cross-project FEAT-walk JQL. Optional `projectKey` scoping. Builds both JQL and JIRA URLs. | `/api/jira/issue-breakdown` (live), TaskBreakdownCell, future skills |
| `releaseDatasetService` (#1b Phases 1+2) | ◐ | "Trunk": fetch raw issues from 5 buckets + sidecars in parallel, dedup within release (`fetchReleaseData`); add 11 derived columns and assemble cross-release dataset (`processMaster`). Currently Engineering Payload only (D36). Phase 3 (cache + sync + changelog) pending. | future analytics consumers; today exercised only by tests + synthetic pipeline |
| `releaseClassificationService` | ● | Parse/classify/sort release names (`NDB-2.11`, `DataLens-X-EA`). Major/Minor / Maintenance / Patch / Pre-release / Unknown. D1 via `productPrefix`. | dataset assembly, release-readiness comparators |
| `issueGroupsService` | ● | 6-group + work-type mapping (Story/Task/Bug/etc → logical group). | dataset assembly, group filter JQL |
| `resolutionCategoriesService` | ● | 4-bucket resolution mapping (Done/Dupe/Won't-do/Other). | dataset assembly, completion logic |
| `sprintsService` | ● | Sprint enumeration over a fixed-cadence calendar. D1 via `SprintCalendar` config (NDB = 2024-10-23 + 21-day). | dataset assembly, future sprint dashboards |
| `releaseInsightsService` (#3, first slice) | ◐ | `computePayloadMetrics` (planned_total / completion_pct / group shares / pre-BC signals / tail-share-at-GA) + `computeLabelAnchoredMetrics` (deferred + carry-over). Operates on processed `ProcessedTicketWithDerived[]` from `releaseDatasetService`. Currently Engineering Payload (D36). Remaining slices: flow / triage debt / cohort / cycle-time / pace / `computeReleaseMatrix` / `computeTeamMatrix`. | future release dashboards, team-exec reports |
| `dateMoverService` (#10, D30) | ● | Move JIRA gate date with **mandatory reason** + Confluence audit row + JIRA-side rollback on audit failure. | `/api/date-mover/move-gate-date`, `move-gate-date` skill |
| `confluenceConnector.appendStructuredRow` (used as a service primitive) | ● | Insert `<tr>` after a named anchor in a Confluence page; version-conflict retries. | `dateMoverService`, future #12 template engine |
| `statusService`, `predictabilityService`, `chartService`, `dependencyService` | ○ | Original scaffolds — retired pending real ports (see CONSOLIDATION.md "Speculative stubs"). Throw on use. | none today |
| Future ports (CONSOLIDATION.md #2, #4–#9, #11–#16, #18) | ○ | Velocity, landing forecast, chart catalog, NAI chatbot, team-exec report service, predictive analytics, capacity, outstanding-work, Confluence template engine, release timeline, bin packing (algo extraction), say-vs-do, story points, sprint Gantt. | various |
| `nlpQueryService` *(new, D4)* | ○ | Natural language → tool-call plan. Routes team-exec/RM questions to the right MCP tools + connectors. | Ops Assistant agent (primary), any chat surface |

### Layer 4 — API + MCP tools

Two parallel surfaces over the services:

**Express routes** (`server/routes/`) — for the web app
- Thin: validate input, call service, return JSON
- One file per domain (`routes/status.js`, `routes/capacity.js`, etc.)
- Max 150 lines per file (per existing `minimal-architecture` rule)

**MCP tools** (`mcp-server/src/tools/`) — for the AI agent
- One tool per feature
- Each tool calls the same service the route does
- Returns structured output for LLM consumption

### Layer 5 — UI & AI surfaces

**delivery-ops React app** — single web runtime on `:8888`
- **All capabilities visible to all users** (D6). The Portfolio Manager sees
  everything; specialists see everything too — they just lean on different
  pages. No nav-level filtering.
- **Role lens dropdown** in the header (D6): "Show me this page as Team Executive / EM /
  IC". Re-renders the current data using the audience preset, never hides
  data.
- **Embedded chat panel** (D7): the Ops Assistant agent lives as a persistent
  chat surface inside the app. Available to every user. Reduces reactive
  pings to the Portfolio Manager (D8).
- **Pages organised by domain, not by old-app** (see directory structure
  below).
- **Product picker** (D1, D5): top-level dropdown selects active product set
  (NDB / DataLens / NCM / …) for the user's view.

**Cursor agents & workflows** (`.cursor/`)
- One user-facing orchestrator (`ops-assistant.md`) delegates to 6 specialist
  sub-agents (`team-exec-specialist`, `tpm-specialist`, `rm-specialist`,
  `triage-specialist`, `confluence-publisher-specialist`,
  `dependency-tracker-specialist`) — D16 orchestrator-workers pattern.
- Workflows chain MCP tools for recurring playbooks (Monday status, quarterly
  team-exec report, release cascade rename).
- Skills are reusable procedures (`team-exec-release-report`,
  `move-gate-date`, `confluence-width-cleanup`, `fetch-project-tickets`, …).
- Rules are global constraints (`persona-aware-output`, `no-localhost`,
  `product-agnostic`, `jira-date-hierarchy`, `citation-first-output`, …).
- "VP" terminology is dropped everywhere per D33 — use "team-exec".

**Static-mounted legacy apps (D37).** Mature standalone web apps that
already have a working UI (vanilla JS / no React) can ship as a static
asset folder under `apps/<name>/` served by the delivery-ops Express
server at `/<name>/*`. Today this is how `apps/bin-packing/` is brought
in. The sidebar entry opens the app in a new browser tab so the two UIs
don't have to share a viewport. The expectation is that a static-mounted
app eventually gets its algorithm core extracted to `shared/services/`
and its UI rewritten as a React component under
`apps/delivery-ops/client/src/domains/`, but only when there's a
functional reason — never for stylistic harmony.

---

## Payload concepts — Engineering vs Release (D36)

NDB (and other products like DataLens, NCM) is a **portfolio**, not a
single team. Multiple cross-functional teams contribute to a release,
each working in their own JIRA project:

- NDB engineering team → `ERA`
- Feature intake / PM → `FEAT` (X-FEAT, Capability)
- Tech pubs → `TECHPUBS`
- PM / programme management → `PM`
- …and more, depending on the product

All of them routinely set `fixVersion = NDB-2.11` on their own tickets
when contributing to that release. This forces two distinct payload
concepts to exist as first-class citizens:

| Concept | JQL shape | Audience | Status |
|---|---|---|---|
| **Engineering Payload** | `project = ERA AND (5-bucket union)` — scoped to the dev team's project | EM, IC, sprint reports, dev burndown | What the legacy chatbot computed. Numbers people trust = these numbers. `buildEngineeringPayloadJql`. |
| **Release Payload** | `(5-bucket union)` — no project filter; anything with the release fixVersion across every contributing team's project | TPM, RM, Team Exec, "are we shipping?" dashboards | NEW concept (D36). `buildReleasePayloadJql`. No pollution guard — trust fixVersion. |

`releaseDatasetService.fetchReleaseData` and `releaseInsightsService`
currently produce **Engineering Payload** only, preserving legacy
numbers. When the first cross-team consumer lands, add
`fetchReleasePayloadData` (same code path, no project scope) and label
the resulting metrics distinctly so they aren't confused with the
engineering-only number people already see.

`productService.getJiraProjects(productId)` returns the **engineering
project** (e.g. `['ERA']` for NDB). It does NOT enumerate every
contributing project — there's no need to, because Release Payload is
anchored by fixVersion, not by a project list.

---

## Directory structure (target)

```
~/NDB-Ops-Tools/ndb-delivery-ops/
├── ARCHITECTURE.md                      this file
├── FEATURE_CATALOG.md                   feature inventory
├── REARCHITECTURE_PLAN.md               phased plan (next doc)
├── DECOMMISSION.md                      already done
├── README.md
├── AGENTS.md                            project persona for Cursor
│
├── apps/
│   └── delivery-ops/                    THE single user runtime
│       ├── client/                      React (port 8888)
│       │   └── src/
│       │       ├── domains/             pages grouped by feature domain
│       │       │   ├── status/          ReleaseVersions, OutstandingWork, ReleaseBrief
│       │       │   ├── planning/        CapacityPlanner, BinPacking, DateMover, …
│       │       │   ├── timeline/        ReleaseGantt, SayVsDo, Predictive
│       │       │   ├── triage/          TicketTriage, JiraQuery
│       │       │   ├── confluence/      BulkPageCreator, TemplateEditor, StatusAutoPublish
│       │       │   ├── sprint/          SprintHealth, SprintInsights, TeamProfile, SyncHub
│       │       │   ├── kpi/             KpiDashboard, KpiEditor
│       │       │   └── admin/           UserMgmt, TeamMgmt
│       │       ├── layout/              Sidebar (persona-aware), Header
│       │       ├── auth/                JIRA PAT auth, role detection
│       │       └── shared/              common components, hooks
│       │
│       └── server/                      Express (port 6001)
│           ├── routes/                  thin route handlers per domain
│           ├── services/                business logic per domain
│           └── middleware/              auth, rate-limit, error, timeout
│
├── mcp-server/                          AI tool surface (stdio)
│   └── src/
│       ├── connectors/                  → moves to shared/ in Phase 1
│       └── tools/                       one per feature
│
├── shared/                              NEW — cross-runtime code
│   ├── connectors/                      jiraConnector, confluenceConnector, githubConnector, aiConnector
│   ├── types/                           Release, Ticket, Persona, RAG, …
│   └── utils/                           date logic, JQL builders, ID maps
│
├── crystalball-i/                       AI prediction engine (used by predictabilityService)
│
├── .cursor/
│   ├── AGENTS.md                        project AI guidance
│   ├── agents/                          one per persona
│   ├── rules/                           global constraints (.mdc)
│   ├── skills/                          reusable procedures (SKILL.md per dir)
│   ├── workflows/                       multi-step playbooks
│   └── mcp.json                         registers mcp-server
│
└── _archive/  ← actually at ~/NDB-Ops-Tools/_archive/   17 tarballs of decommissioned originals
```

Two things go away vs. today:
- `apps/tpm-confluence-tools/` (Streamlit) — its features move into
  `apps/delivery-ops/client/src/domains/confluence/`
- The duplicated JIRA / Confluence code in route files, components, and the
  Streamlit app — consolidated into `shared/connectors/`

---

## Persona-aware navigation

The same React app, three different views.

```
user.role ──► permissionService ──► visiblePages[]
                                          │
                                          ▼
                              Sidebar.filter(page => page in visiblePages)
```

`user.role` is one of: `team-exec | tpm | rm | feat | team | ic | admin` (D33).

A `PERSONA_PAGES` map (new constant) declares which paths each role sees by
default. Admin sees all. Any user can flip a "Switch role" dropdown in the
sidebar header to view as another role (the dropdown is gated on the
`admin` permission so non-Ops users can't impersonate).

Implementation hook: extend the existing `permissionService.js` and
`TAB_PERMISSIONS` map to include a `role` dimension, in addition to the
existing per-permission allowlist.

---

## Migration strategy summary

Status legend: ✅ done, 🟡 partial, ⏳ pending. Live tracker for the
per-capability ports is `CONSOLIDATION.md`.

| Phase | What | Status (as of Session 2026-05-20) |
|---|---|---|
| **A. AI layer rebuild** | Orchestrator agent + 6 specialists + 13 skills + 9 rules + 3 workflows + persona-aware sidebar foundations | ✅ done — commit `54bb48a` |
| **B1. Connectors consolidation (JIRA)** | Pull JIRA into `shared/connectors/jiraConnector.ts`; route handlers use it | ✅ done — `mcp-server` + `apps/delivery-ops/server` both consume |
| **B2. Connectors consolidation (Confluence)** | Pull Confluence into `shared/connectors/confluenceConnector.ts` with `appendStructuredRow` primitive | ✅ done — landed with D30 date-mover slice |
| **B3. Other connectors (GitHub, Slack, Email, AI)** | Same pattern | ⏳ pending |
| **C. Service extraction (Python → TS port)** | The 17 archived apps + 5 user-level skills → TS services in `shared/`. Tracked as CONSOLIDATION.md #1–#20. | 🟡 ~5 of 20 capabilities done: #1a payload JQL, #1b dataset trunk (Phases 1+2 of 3), #3 insights first slice, #10 date mover, #14 bin-packing (static-mounted), #17 ticket fetch (wired). |
| **D. Streamlit retirement (release-analytics)** | Rebuild Sync Hub / Insights / Sprint Analysis as React pages | ⏳ pending — blocked on completing #1b Phase 3 (cache) |
| **E. Streamlit retirement (tpm-confluence-tools)** | Rebuild Bulk Page Creator + Template Editor as React pages | ⏳ pending |
| **F. MCP-backed UI pages** | React pages for Capacity Planner, Bin-Packing, Story Points, Date Mover, Say vs Do | 🟡 only bin-packing has a sidebar entry today (static-mounted, opens in new tab). Date Mover backend ships but no React form. |
| **G. New gaps** | Sprint Planner, Status Page Auto-Publisher, Cross-team dependency map, Triage UI | ⏳ pending |
| **H. D34 wiring sweep** | Replace remaining hardcoded `projectKey`/`labelPrefix`/`releasePrefix`/`sprintCalendar` with `productService` resolution at each call site | 🟡 productService exposes them all; only `/api/jira/issue-breakdown` exercises any of it today, and it intentionally omits `projectKey` to match legacy. Wire as each new consumer lands. |

**Concrete recommended next slice** (per session-end review): #1b Phase 3
(cache + sync + changelog) — unblocks every downstream analytics
consumer. Alternative: #7 Team Exec report service + minimal React route,
which delivers user-visible value sooner but on top of an
Engineering-Payload-only dataset (D36).
