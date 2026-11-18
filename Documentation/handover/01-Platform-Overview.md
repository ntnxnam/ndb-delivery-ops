# 01 — Platform Overview: What This App Does

> **Repo:** `nutanix-era-ndb-tools/NDB-Ops-Tools/ndb-delivery-ops` | **Monorepo name:** `portfolio-delivery-ops` (`AGENTS.md:1`, `package.json:2`)
> **One-liner:** A single monorepo for **portfolio delivery operations** — it turns JIRA + Confluence + GitHub + AI into release status, sprint health, KPI dashboards, and an Ops Assistant chat that answers "when are we landing and what's blocking us?" with citations.

---

## 1. Problem It Solves

Portfolio Managers and TPMs spend 70%+ of their week on **reactive pings** from Team Executives, RMs, EMs, FEAT managers (`DECISIONS.md:D8`). The platform's primary KPI is *time saved per day for the Portfolio Manager* by making the agent self-service to others.

Recurring artefacts (Team-Executive Report, Weekly Status Email, SoS summaries) are produced via **deterministic workflows**; ad-hoc questions ("how's NDB-2.11?") are answered by the **Ops Assistant agent** (`ARCHITECTURE.md:5-31`, `DECISIONS.md:D9/D16`).

---

## 2. Who Uses It (11 Audiences)

Per `~/.cursor/context/audience.md` and `FEATURE_CATALOG.md:249-272` — every user sees every (non-admin) tab per D6; role drives *presentation density*, not access.

| Persona | Primary job in the app | Default landing |
|---------|------------------------|-----------------|
| **Portfolio Manager** (you) | All 8 domains; reviews agent drafts before they reach leadership | Ops Assistant chat + Release Versions |
| **Team Executive / Director** | "When are we landing? What's blocking us?" — charts-first, RAG + risk register (D15) | Ops Assistant chat (team-exec lens) |
| **TPM** | Release tracking, weekly status (3-tier), triage, Confluence bulk publish | Release Versions |
| **RM** | Release readiness, gate-date moves, cascade renames | Release Versions / Sync Hub |
| **FEAT Manager** | Own feature's scope, dates, story points | Release Versions filtered to their FEAT |
| **EM / Team Manager** | Sprint health, capacity, velocity, team profile | My Team Profile |
| **IC / Engineer** | Own tickets, JQL runner | My Tickets |
| **QA Lead** | Defect trends, sprint insights | Sprint Insights |
| **Architect** | Timeline / Gantt, technical features | Release Timeline |
| **Admin** | Users, teams, KPI definitions, system config | Admin |

Audience drives presenter density (`shared/src/types/audience.ts:80`): `executive` (chart-first) vs `manager` vs `engineer` (firehose + JQL).

---

## 3. Architecture — 5 Layers

`ARCHITECTURE.md:35-155` — **One feature, one place.**

```
Layer 5: UI & AI surfaces          delivery-ops React (port 8888) + Cursor/MCP agents
Layer 4: API + MCP tools            Express routes + mcp-server/src/tools (stdio)
Layer 3: Services (business logic)  shared/services + server/services — stateless, reusable
Layer 2: Domain models + types      shared/types (Release, Ticket, Persona, RAG, Sprint …)
Layer 1: Connectors (one per system) shared/connectors — JIRA / Confluence / GitHub / Email / AI
```

**Key principles:**
- **Product-agnostic (D1):** No hardcoded NDB strings; every product-specific value (`projectKey`, `labelPrefix`, `releasePrefix`, `sprintCalendar`) comes from `productService` reading `teamBoardConfig.json` (`shared/src/services/productService.ts:361`, `DECISIONS.md:D34`).
- **One connector per external system (D3):** All JIRA calls via `shared/connectors/jiraConnector.ts` (`ARCHITECTURE.md:93-100`); D40 enforces Data Center PAT `Authorization: Bearer` only.
- **Services own business logic; routes/pages are thin** (`ARCHITECTURE.md:116-118`).
- **One React runtime for users** on `:8888` (`ARCHITECTURE.md:171-174`); Streamlit apps are being retired.

---

## 4. What the App Does — Top-Level Capabilities (8 Domains)

Grouped by job-to-be-done per `FEATURE_CATALOG.md:14-194`. See `02-Capability-Map.md` for the full table with live/mcp-only/planned states.

### Domain 1 — Release Status & Reporting
- **Release Versions Table** (`/project-status`, `apps/delivery-ops/client/src/components/ReleaseVersionTab.js:1`) — every FEAT/Initiative for a release with RAG, dates, owners.
- **Team-Executive Report** — single-page RAG + top risks; Markdown + email HTML + Confluence XML renderers (`DECISIONS.md:D15d`).
- **Status Email Sender** (`/`, `client/src/components/EmailSender/`) — compose status email from JIRA query + send via SMTP.
- **Release Brief / One-Pager** (`/release/brief`, `client/src/release/ReleaseBriefPage.js:1`) — compact publishable doc with velocity + forecast panels.
- **Outstanding Work Tracker** (`/release-outstanding-work`) — work-not-done with ETAs/blockers.

### Domain 2 — Planning & Capacity
- **Capacity Planner** (MCP `plan_capacity`) — engineer-days for a release window factoring PTO/holidays.
- **Project Bin-Packing** (`/bin-packing/*`, `apps/bin-packing/`) — suggest what fits given capacity; largest-first with FTE constraints (D37 static mount, 7k LOC vanilla JS).
- **Story Point Roll-up** (MCP `calculate_story_points`) — sum SP across all descendants of a Feature.
- **Date Mover** (`POST /api/date-mover/move-gate-date` via `release-gate-ops` skill, `shared/src/services/dateMoverService.ts:358`) — bulk-cascade gate dates with mandatory reason + Confluence audit row + JIRA rollback on audit failure (D30/D31, also handles release-config slip + sprint extension).
- **Release Setup / Config** (`/release-setup`, `/release-config`) — create + edit release versions and gate dates.

### Domain 3 — Timeline & Predictability
- **Release Timeline Gantt** (`client/src/components/ReleaseVersionGantt.js:1`, MCP `gantt_release_timeline`) — visual Gantt with JIRA date hierarchy (Feature: CC>CG>PG, Epic: dueDate per `ticket.ts:116`).
- **Sprint Gantt** — sprint-by-sprint ticket timeline.
- **Say vs Do** (MCP `say_vs_do`) — committed vs delivered SP per sprint.
- **Predictive Landing (CrystalBall-I)** (`GET /api/release-dataset/forecast`, `shared/src/services/landingForecastService.ts:348`) — MVP landing-date forecast with confidence bands.
- **Sprint Analysis** (`/sprint-report`) — per-sprint deep dive: scope creep, carry-over, blockers.

### Domain 4 — Triage & Backlog
- **Ticket Triage** (4 flavours per D19: bug triage, crisis/P0, stale-ticket sweep, pending-response chase via unreplied JIRA comments D24) — agent-driven proposals for owner/priority/component/severity.
- **JIRA Query Runner** (`client/src/jira/`) — free-form JQL → table.

### Domain 5 — Confluence Publishing
- **Bulk Page Creator + Template Editor** (`apps/tpm-confluence-tools/`, Streamlit → React Phase F) — create N standardized pages from JIRA query.
- **Status Page Auto-Publisher** — one-click push weekly email → Confluence.
- **Width Cleanup skill** (`agent-pack/skills/confluence-width-cleanup/`) — sanitise storage XML before publish.

### Domain 6 — Sprint Analytics & Team Health
- **Sprint Health Scoreboard** (`/sprint-report`, `shared/src/services/sprintMetrics.ts:55`) — committed vs delivered, carry-over %, scope creep %.
- **Sprint Performance** (`/sprint-performance`) — multi-sprint trends.
- **Team Profile** — velocity history, members, components, current load.

### Domain 7 — KPI & Custom Metrics
- **KPI Dashboard** (`/kpis`, `/system-test-scale`, `/oncalls`, `/cfdcfi`, `server/routes/jira/kpi.js:234`) — per-team KPI defs in `kpiConfig.json`, pulse analytics with MTTR/status dwell.
- **Leadership Commit Report** (MCP `leadership_commit_report`, `shared/connectors/githubConnector.ts:76`) — GitHub commit activity per repo/author.

### Domain 8 — Admin & Platform
- **User / Team Management** (`/team-management`, `server/routes/admin.js:220`, `server/routes/config.js:1025`) — teams defined in `teamBoardConfig.json`; team inspect auto-detects project/boards from baseFilter.
- **Auth** (`server/middleware/auth/jira.js:281`) — JIRA PAT validation against `GET /rest/api/2/myself`, 24h permission cache, legacy `allowedUsers.json` → `TAB_PERMISSIONS` mapping.
- **Notifications, health check, rate limiting** (`server/middleware/security.js:163`).

---

## 5. AI Layer — Orchestrator-Workers

`DECISIONS.md:D16/D38/D39`, `agent-pack/identity/ops-assistant.md:1`, `shared/src/agentRuntime/loop.ts:205`.

- **One user-facing orchestrator:** `ops-assistant` — every host (Cursor, web chat, future Slack) loads `agent-pack/` via `loadAgentPack()` (`shared/src/agentPack/loadAgentPack.ts:191`). Workflow: perceive → memory → tool loop → provenance; `mutate` is HITL-queued while D26 is open.
- **6 specialist sub-agents** in `agent-pack/identity/specialists/` (team-exec, tpm, rm, triage, confluence-publisher, dependency-tracker).
- **20 skills** in `agent-pack/skills/` (e.g. `team-exec-status-answer` D15: compound question + risk register, `weekly-status-email` D17: 3-tier hybrid, `release-gate-ops` D30/D31, `dependency-walk` D18) — each declares `capabilityType` (deterministic/generative/agent/agentic) + `toolClass` (read/draft/mutate) in `agent-pack/manifest.json:1`.
- **Web chat** (`POST /api/ai/chat` → `server/routes/ai.js:646` → `shared/agentRuntime` + NAI `ntnx-beam` via `shared/connectors/aiConnector.ts:206`) — session/user/org memory (`shared/src/agentRuntime/memoryStore.ts:137`), provenance log, HITL inbox (`hitl.ts`).
- **MCP surface:** 8 tools + 1 resource (`mcp-server/src/index.ts:74`) over stdio.

**Team Executive answer protocol (D15):** Every leadership question = "when landing?" + "what's blocking?" → parallel `predictLanding` + `topBlockers` → risk-register render with citations (D10), confidence indicators, drill-in offer.

---

## 6. Integrations (Connectors)

`shared/connectors/` — one TS module per external system (D3), no ad-hoc `axios.get(JIRA_URL)` elsewhere.

| Connector | File | Auth | Used by |
|-----------|------|------|---------|
| **JIRA** | `jiraConnector.ts:473` | Data Center PAT `Bearer` only (D40) | Every feature; `searchAll` with 429 retry + proxy support |
| **Confluence** | `confluenceConnector.ts:413` | PAT (falls back to JIRA PAT) | Date-mover audit (`appendStructuredRow`), bulk publish |
| **GitHub** | `githubConnector.ts:76` | Optional `GITHUB_TOKEN` Bearer | Leadership commit report |
| **Email (SMTP)** | `emailConnector.ts:29` + `server/utils/emailClient.js` | `mailrelay.dyn.nutanix.com` / `secure-mailrelay.corp.nutanix.com:587` | All email sends; history in `emailHistoryDB` |
| **AI (NAI)** | `aiConnector.ts:206` | `AI_API_KEY` (NuToken) → `tokens.corp.nutanix.com/enterpriseai`, model `ntnx-beam` | Chat, exec summaries, SoS coaching, release briefings |
| **Slack** | deferred | — | No caller yet (D3) |

---

## 7. Tech Stack

| Layer | Stack |
|-------|-------|
| **Client** | React 18.3.1 + React Router 7.12 + axios + recharts 3.7 + lucide-react (`apps/delivery-ops/client/package.json:1`) — plain JS (no TS), CRA on `:8899` dev proxy → Express `:8001` |
| **Server** | Node ≥20, Express, `node-cron` (email scheduler every minute), `helmet`/`cors`/`compression`, `tinydb`+`sqlite3` for history/schedules (`apps/delivery-ops/server/package.json:1`) |
| **Shared lib** | TypeScript ESM (`@portfolio-delivery-ops/shared`, `shared/src/index.ts:442`), `zod`, `axios`, `https-proxy-agent` |
| **MCP** | `@modelcontextprotocol/sdk` stdio server (8 tools) |
| **Legacy** | Python/Streamlit `apps/tpm-confluence-tools` (own venv, `:8501`), vanilla JS `apps/bin-packing` (`:3847` standalone, `/bin-packing/*` when mounted) |
| **Auth** | JIRA PAT only; no OAuth — validated against `GET /rest/api/2/myself` with token cache (`server/utils/tokenCache.js:163`) |
| **AI** | Nutanix Enterprise AI gateway (`AI_API_BASE_URL`, `AI_DEFAULT_MODEL=ntnx-beam`, `AI_MAX_TOKENS=8192`) |

---

## 8. Data Model Highlights

- **Payload split (D36):** Engineering Payload (`project = ERA AND (6-bucket union)`) vs Release Payload (no project filter — any `fixVersion = NDB-2.11` ticket, `shared/src/services/payloadJqlService.ts:578`). Default is Release Payload since 2026-06-13.
- **6-bucket release query** (`PAYLOAD_BUCKET_KEYS`, `payloadJqlService.ts:578`): top-level projects, work-toward-project, standalone epics, etc. + Group 2 `moved_out` (left the release) + Group 3 long-term funded.
- **Dataset cache** (`shared/src/services/releaseDatasetCache.ts:668`, `shared/.cache/release-dataset/<productId>/`): `bundle.json` + `bundle.meta.json` + `per-release/*.json` + `.sync-lock`; scheduler sync every 15m (prod) + on-demand SSE (`server/jobs/syncScheduler.js:246`, `server/routes/releaseSync.js:450`).
- **Gate dates** (`releaseVersionsEmailConfig.json`): EC, CC (`customfield_11067`), CG (`customfield_35863`), PG (`customfield_35864`), GA — single source of truth; moves require reason (D30).
- **Sprint calendar:** Fixed-cadence (NDB anchor 2024-10-23 + 21-day, `shared/src/services/sprintsService.ts:131`).
- **RAG / risk:** `customfield_23560` → `classifyRiskIndicator` (`shared/src/services/riskIndicator.ts:248`), `computeReleaseHealthVerdict`.

---

## 9. Project Structure (Target)

`ARCHITECTURE.md:248-312` — monorepo with 5 workspaces (`package.json:5-11`):

```
apps/delivery-ops/          # THE single user runtime (React + Express)
  client/src/
    App.js:527, layout/ (Sidebar 937 lines, 8 nav groups), auth/, contexts/ (Team→Release→Data),
    components/ (40+ pages), release/ (brief/weekly-skim/retrospective/chatbot), feature/, design-system/, hooks/ (30), jira/, shared/
  server/
    index.js:292, routes/ (config/auth/admin/ai/feature/component/dependency/dateMover/releaseDataset/email/jira/*),
    services/ (44 files, 18.5k lines: naiService 1565, dependencyView 1845, etc.),
    middleware/, jobs/syncScheduler.js, utils/ (45+ helpers), config/ (18 JSONs)
apps/tpm-confluence-tools/   # Python/Streamlit — bulk Confluence (Phase F → React)
apps/bin-packing/            # Vanilla JS Gantt — static-mounted at /bin-packing/* (D37)
mcp-server/                  # MCP stdio — 8 tools + 1 resource
shared/                      # Cross-runtime lib — connectors(6), services(28), types(8), domain(4), agentPack+agentRuntime(12)
agent-pack/                  # Portable cookbook (SoT) — identity(7), skills(22), rules(12), workflows(3), context(29), prompts(10)
_archive/                    # 17 tarballs of decommissioned originals (~/NDB-Ops-Tools/_archive/)
```

---

## 10. Current State & What's Next

Per `CONSOLIDATION.md` and `ARCHITECTURE.md:349-368` (Phases A–H):

| Phase | Scope | Status |
|-------|-------|--------|
| A — AI layer rebuild | Orchestrator + 6 specialists + 13 skills + 9 rules | ✅ done |
| B — Connectors consolidation | JIRA + Confluence + GitHub/Email/AI into `shared/connectors/` | ✅ done (Slack deferred) |
| C — Service extraction (17 apps → `shared/services/`) | 20 capabilities tracked | 🟡 ~7 of 20 wired (payload JQL, dataset trunk, velocity, landing forecast, date mover, bin-packing static, ticket fetch) |
| D/E — Streamlit retirement | release-analytics + tpm-confluence-tools → React | 🟡 SyncHub simplified; Insights/Sprint Analysis + Bulk Pages pending |
| F — MCP-backed UI pages | Capacity, Bin-Packing, Story Points, Date Mover, Say-vs-Do | 🟡 only bin-packing has sidebar entry (static) |
| G/H — Gap features | Sprint Planner, Status Auto-Publisher, dependency map, triage UI | ⏳ pending (dependency-view read-only exists) |

**Do not restore `teamBoardConfig.json` to NDB-only** after Admin saves a new team (D43).

---

*Generated 2026-11-11 from live codebase scan. For deeper detail: `02-Capability-Map.md` (full feature table) and `03-Operations-Guide.md` (run/deploy).*
