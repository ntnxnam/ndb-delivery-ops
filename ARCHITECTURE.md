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
│  │ (single :8888 runtime,     │    │ (TPM, RM, VP, FEAT Mgr,     │   │
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

| Service | Owns | Used by |
|---|---|---|
| `releaseService` | Release config, version cascade rename | `/api/releases/*`, `mcp:cascadeRename` |
| `statusService` | RAG roll-up, top risks, exec summary data | `/api/status/*`, `mcp:getReleaseStatus` |
| `capacityService` | Team capacity, bin-packing | `/api/capacity/*`, `mcp:planCapacity`, `mcp:binPackProjects` |
| `timelineService` | Gantt data, sprint dates, gate dates | `/api/timeline/*`, `mcp:ganttReleaseTimeline` |
| `predictabilityService` | Say-vs-do, predictive landing | `/api/predictability/*`, `mcp:sayVsDo`, `crystalball-i` |
| `kpiService` | KPI definitions, calculations, history | `/api/kpi/*` |
| `confluencePublishService` | Bulk page create, template apply, width-cleanup | `/api/confluence/*`, future `mcp:publishStatusPage` |
| `triageService` | Bug categorisation, ownership proposals | `/api/triage/*`, `mcp:triageTickets` |
| `sprintService` | Sprint health, classification, trends | `/api/sprints/*` (existing route, refactored) |
| `dateService` | Bulk date moves with audit + rollback | `/api/dates/*`, `mcp:moveJiraDates` |
| `storyPointsService` | Story-point roll-up across descendants | `/api/sizing/*`, `mcp:calculateStoryPoints` |
| `chartService` *(new, D4)* | Render charts (RAG-over-time, predictability, scope creep, top risks by owner) as SVG/PNG, audience-aware | inline in chat, VP report, KPI dashboard, emails |
| `nlpQueryService` *(new, D4)* | Natural language → tool-call plan. Routes VP/RM questions to the right MCP tools + connectors | Ops Assistant agent (primary), any chat surface |
| `productService` *(new, D1)* | Resolve `productId` → JIRA project key(s), Confluence space, GitHub org, audience config | every service that touches external systems |

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
- **Role lens dropdown** in the header (D6): "Show me this page as VP / EM /
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
- One agent per persona (`vp-assistant.md`, `tpm-assistant.md`, etc.)
- Workflows chain MCP tools for recurring playbooks (Monday status, quarterly VP report, …)
- Skills are reusable procedures (`vp-executive-report`, `confluence-width-cleanup`, …)
- Rules are global constraints (`persona-aware-output`, `no-localhost`, …)

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

`user.role` is one of: `vp | tpm | rm | feat | team | ic | admin`.

A `PERSONA_PAGES` map (new constant) declares which paths each role sees by
default. Admin sees all. Any user can flip a "Switch role" dropdown in the
sidebar header to view as another role (the dropdown is gated on the
`admin` permission so non-Ops users can't impersonate).

Implementation hook: extend the existing `permissionService.js` and
`TAB_PERMISSIONS` map to include a `role` dimension, in addition to the
existing per-permission allowlist.

---

## Migration strategy summary

(Full phased plan in `REARCHITECTURE_PLAN.md` — to be written after this is approved.)

| Phase | What | Risk |
|---|---|---|
| **A. AI layer rebuild** | New persona-aligned agents, sharpened rules, organised skills, persona-aware sidebar in delivery-ops | Low. Markdown + small React change. |
| **B. Connectors consolidation** | Pull jira/confluence/github into `shared/connectors/`. Refactor all callers. | Medium. Touches many files. Strangler-fig pattern. |
| **C. Service extraction** | Move business logic out of `server/routes/jira/index.js` (7k LOC) into `server/services/*`. Route handlers become 40-line wrappers. | Medium-high. Big file, lots of behaviour. Do one domain at a time. |
| **D. Streamlit retirement (release-analytics)** | Rebuild Sync Hub, Insights, Sprint Analysis, Release Analysis, Team Profiles, Release Brief as React pages under `domains/sprint/` and `domains/status/`. | High. Biggest single chunk, ~5,000 LOC equivalent. |
| **E. Streamlit retirement (tpm-confluence-tools)** | Rebuild Bulk Page Creator + Template Editor as React pages under `domains/confluence/`. | Medium. ~2,000 LOC equivalent. |
| **F. MCP-backed UI pages** | New web pages for Capacity Planner, Bin-Packing, Story Points, Date Mover, Say vs Do (all currently MCP-only). | Medium. Each is small but there are ~5 of them. |
| **G. New gaps** | Sprint Planner, Status Page Auto-Publisher, Cross-team dependency map, Triage UI. | Medium per gap. |

Each phase is a separate working session. Phase A can ship today.
