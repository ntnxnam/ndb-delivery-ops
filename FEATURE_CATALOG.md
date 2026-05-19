# Feature Catalog — NDB-Delivery-Ops

The single source of truth for what the platform *should* offer, deduplicated
from 17+ legacy apps. **Features are organised by job-to-be-done, not by app.**

Each feature has:

- **Job**: the one-line user need
- **Persona**: who uses it (see `~/.cursor/context/ndb-ops/audience.md`)
- **State**: live / mcp-only / archived (recoverable) / never-built
- **Source**: where the code currently lives (or lived)
- **Decision**: keep / merge / build / cut

State legend:

- `live` = working in the monorepo today
- `mcp-only` = exists as an MCP tool but no UI yet
- `archived` = code in `~/NDB-Ops-Tools/_archive/` tarballs
- `never-built` = identified gap

---

## Reuse matrix — capabilities are not pages

The 8 domains below organise features for navigation, but many of the most
valuable capabilities are not "a page" — they're computations that surface in
**multiple pages**. The Services layer (`ARCHITECTURE.md` Layer 3) exists
exactly so each capability is implemented once and consumed by every surface
that needs it.

| Capability (service) | Surfaces it appears in |
|---|---|
| **Story Point Roll-up** (`storyPointsService.rollUp`) | • standalone page (Domain 2) for "size my Feature" workflow  • column in Release Versions table (`/all-status`)  • column in Outstanding Work tracker  • field in Team-Executive Report  • MCP tool `calculateStoryPoints` |
| **RAG / Risk Score** (`statusService.calcRag`) | • column in Release Versions  • headline badge in Team-Executive Report  • status cell in Sync Hub landing  • indicator in Release Brief  • indicator in Outstanding Work |
| **Date Shift** (`dateService.cascade`) | • standalone Date Mover page  • inline "shift dates" action on a Release Versions row  • used by Release Cascade Rename workflow  • MCP tool `moveJiraDates` |
| **Say vs Do** (`predictabilityService.sayVsDo`) | • standalone page  • card in Team Executive Dashboard  • badge on Team Profile  • column in Release Versions for FEAT predictability  • MCP tool `sayVsDo` |
| **Sprint Health metrics** (`sprintService.classify` + carryover/scope-creep) | • Sprint Report page  • tile in Team Profile  • sparkline in KPI Dashboard  • input to Sprint Planner |
| **Capacity calc** (`capacityService.estimate`) | • standalone Capacity Planner page  • input column in Bin-Packing  • badge in Team Profile  • MCP tool `planCapacity` |
| **Predictive Landing** (`predictabilityService.predictLanding`) | • CrystalBall standalone page  • column in Release Versions  • headline in Team-Executive Report  • alert in Sync Hub |
| **Outstanding Work computation** (`statusService.outstanding`) | • standalone Outstanding Work page  • count in Release Versions  • section in Release Brief  • section in Team-Executive Report |
| **Confluence Connector** (`confluenceConnector`) | • Bulk Page Creator  • Template Editor  • Confluence Extractor  • future Status Page Auto-Publisher  • any skill that publishes to Confluence |
| **Confluence Width Cleanup** (`.cursor/skills/confluence-width-cleanup`) | invoked by all four Confluence-publishing features above |
| **Sprint Classification** (`sprintService.classify`) | • used inside Sprint Health  • used inside Story Point Roll-up (only counts committed work)  • used inside Capacity calc (uses delivered velocity) |
| **JIRA Connector** (`jiraConnector`) | every feature in every domain |
| **Chart rendering** (`chartService` — D4) | • inline in agent chat replies  • Team-Executive Report  • KPI Dashboard  • Status email HTML  • Sync Hub (release-analytics rebuild) |
| **NLP → query plan** (`nlpQueryService` — D4) | • Ops Assistant agent (primary)  • Team Executive "how's NDB-2.11?" intents  • any "ask in plain English" chat surface |
| **Product context** (`productService` — D1) | • every Layer-3 service that touches external systems  • product picker in delivery-ops top bar  • per-product audience overrides for `audience.md` styles |

How to read this: the rows are services in Layer 3. Every "Surface" is either
a React page (Layer 5), an MCP tool (Layer 4), or a skill/workflow (`.cursor/`).
The same row is called from all of them, no duplication.

**Implication for the rest of this doc**: when a feature row below lists
"Decision: build UI page", it does **not** mean build the underlying logic
from scratch — the underlying logic is the service, and it's reused. The
UI page is a thin composition that calls the service plus zero or more
other services.

---

## Domain 1 — Release Status & Reporting

The "what's the status of release X?" job, in five different audiences.


| Feature                       | Job                                                                          | Persona           | State    | Source                                                                       | Decision                                    |
| ----------------------------- | ---------------------------------------------------------------------------- | ----------------- | -------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Release Versions Table        | Show every FEAT/Initiative for a release with risk indicators, dates, owners | TPM, RM, FEAT Mgr | live     | `apps/delivery-ops` ReleaseVersionTab                                        | **keep**                                    |
| Team-Executive Report           | Single-page exec summary for a release, RAG + top risks                      | Team Executive                | live     | `apps/delivery-ops` + team-exec-release-report skill                                | **keep, polish**                            |
| Status Email Sender           | Compose + send a status email built from a JIRA query                        | TPM, FEAT Mgr     | live     | `apps/delivery-ops` GenericEmailer                                           | **keep**                                    |
| Release Brief / One-Pager     | Compact, publishable release status doc                                      | RM, TPM           | archived | `_archive/ndb-release-sprint-analysis-with-chatbot/pages/7_Release_Brief.py` | **rebuild as React page**                   |
| Outstanding Work Tracker      | List of work-not-done with realistic ETAs and blockers                       | RM, TPM           | archived | `_archive/NDB-Outstanding-Work-Realistic-Timelines.tar.gz`                   | **rebuild as React page**                   |
| Email History                 | Audit log of sent emails with re-send                                        | All               | live     | `apps/delivery-ops`                                                          | **keep**                                    |
| Status Update Sender (legacy) | Old standalone status-update app                                             | TPM               | archived | `_archive/ndb-status-update-app.tar.gz`                                      | **cut — superseded by Status Email Sender** |


---

## Domain 2 — Planning & Capacity

The "how do I plan a release / sprint / commit" job.


| Feature             | Job                                                                                  | Persona      | State       | Source                                         | Decision                   |
| ------------------- | ------------------------------------------------------------------------------------ | ------------ | ----------- | ---------------------------------------------- | -------------------------- |
| Capacity Planner    | Estimate team capacity (engineer-days) for a release window, factor in PTO, holidays | RM, EM       | mcp-only    | `mcp-server/src/tools/planCapacity.ts`         | **build UI page**          |
| Project Bin-Packing | Given N projects + team capacity, suggest what fits                                  | RM           | mcp-only    | `mcp-server/src/tools/binPackProjects.ts`      | **build UI page**          |
| Story Point Roll-up | Sum story points for a Feature/Initiative across all descendants                     | FEAT Mgr, RM | mcp-only    | `mcp-server/src/tools/calculateStoryPoints.ts` | **build UI page**          |
| Date Mover          | Bulk-cascade JIRA date changes across many tickets safely                            | RM           | mcp-only    | `mcp-server/src/tools/moveJiraDates.ts`        | **build UI page**          |
| Release Setup       | Create + configure a new release version                                             | RM           | live        | `apps/delivery-ops` ReleaseSetup               | **keep**                   |
| Release Config      | Edit release dates, milestones, gate dates                                           | RM           | live        | `apps/delivery-ops` ReleaseConfig              | **keep**                   |
| Sprint Planner      | Recommend sprint commit list based on velocity + available work                      | EM, FEAT Mgr | never-built | —                                              | **build** (high-value gap) |


---

## Domain 3 — Timeline & Predictability

The "when will it land, and is our schedule realistic?" job.


| Feature                            | Job                                                             | Persona | State                   | Source                                                                                   | Decision                                      |
| ---------------------------------- | --------------------------------------------------------------- | ------- | ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| Release Timeline Gantt             | Visual Gantt of features across a release                       | All     | mcp-only + live partial | `mcp-server/src/tools/ganttReleaseTimeline.ts` + `apps/delivery-ops` ReleaseVersionGantt | **merge into one UI page**                    |
| Sprint Gantt                       | Sprint-by-sprint timeline of tickets                            | EM      | live                    | `apps/delivery-ops` (sprint-gantt-chart skill)                                           | **keep**                                      |
| Say vs Do (Predictability)         | Plot what was committed at start-of-sprint vs delivered at end  | Team Executive, RM  | mcp-only                | `mcp-server/src/tools/sayVsDo.ts`                                                        | **build UI page**                             |
| Predictive Landing (CrystalBall-I) | AI prediction of release landing date with confidence intervals | Team Executive, RM  | live (mock data)        | `apps/delivery-ops` + `crystalball-i/`                                                   | **wire to real data**                         |
| Sprint Analysis                    | Per-sprint deep-dive: scope creep, carry-over, blockers         | EM, TPM | live                    | `apps/delivery-ops` SprintReportPage                                                     | **keep, merge with archived Sprint_Analysis** |
| Release Analysis                   | Per-release deep-dive                                           | RM      | live                    | `apps/delivery-ops` ReleaseAnalysisPage                                                  | **keep**                                      |


---

## Domain 4 — Triage & Backlog

The "what came in, what should we work on, who owns it" job.


| Feature            | Job                                                               | Persona      | State       | Source                                                                  | Decision                               |
| ------------------ | ----------------------------------------------------------------- | ------------ | ----------- | ----------------------------------------------------------------------- | -------------------------------------- |
| Ticket Triage      | Categorise incoming bugs/stories, propose owners, flag duplicates | TPM, EM      | never-built | (planned by `tpm-assistant` agent)                                      | **build as agent workflow + light UI** |
| Spec-to-Backlog    | Read a Confluence spec, generate Epic + child tickets in JIRA     | TPM          | never-built | (Atlassian plugin skill exists)                                         | **build as workflow**                  |
| Bug Trend Analysis | Track defect rates per team / component over time                 | EM, FEAT Mgr | archived    | `_archive/ndb-release-sprint-analysis-with-chatbot/pages/2_Insights.py` | **rebuild as React page**              |
| JIRA Query Runner  | Free-form JQL → table viewer                                      | All          | live        | `apps/delivery-ops` JiraQuery                                           | **keep**                               |


---

## Domain 5 — Confluence Publishing

The "publish status / release-page / spec to Confluence" job.


| Feature                       | Job                                                                             | Persona | State            | Source                                                 | Decision                                            |
| ----------------------------- | ------------------------------------------------------------------------------- | ------- | ---------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Bulk Page Creator (templated) | Create N standardised Confluence pages from a JIRA query, using a base template | TPM     | live (Streamlit) | `apps/tpm-confluence-tools/`                           | **rewrite in React, port to delivery-ops**          |
| Template Editor               | Customise the base template (sections, placeholders, macros)                    | TPM     | live (Streamlit) | `apps/tpm-confluence-tools/pages/2_Template_Editor.py` | **rewrite in React**                                |
| Confluence Extractor          | Pull a Confluence page back as structured data                                  | All     | live (partial)   | `apps/delivery-ops` ConfluenceExtractor                | **keep, unify with the Confluence Connector below** |
| Status Page Auto-Publisher    | Push the weekly status email content as a Confluence page (one-click)           | TPM, RM | never-built      | —                                                      | **build** (high-value gap, ties Domain 1 + 5)       |
| Confluence Width Cleanup      | Sanitise width styles on emitted Confluence storage XML                         | TPM     | live (skill)     | `.cursor/skills/confluence-width-cleanup/`             | **keep as skill, invoked by all 4 features above**  |


---

## Domain 6 — Sprint Analytics & Team Health

The "how is my team / a team doing" job.


| Feature                          | Job                                                                    | Persona | State    | Source                                           | Decision                                    |
| -------------------------------- | ---------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------ | ------------------------------------------- |
| Sprint Health Scoreboard         | Committed vs delivered, carry-over %, scope creep % per sprint         | EM, TPM | live     | `apps/delivery-ops` SprintReportPage             | **keep**                                    |
| Sprint Trends                    | Multi-sprint trend lines for the same team                             | EM      | live     | `apps/delivery-ops` SprintReportPage (mode=Past) | **keep**                                    |
| Sprint Insights                  | Patterns, anomalies, AI commentary on a sprint                         | EM      | archived | `_archive/.../pages/2_Insights.py`               | **rebuild as React page (small)**           |
| Team Profile                     | One page per team: velocity history, members, components, current load | EM, RM  | archived | `_archive/.../pages/6_Team_Profiles.py`          | **rebuild as React page**                   |
| Sync Hub (data refresh)          | Background pull of release/sprint data with progress UI                | RM, EM  | archived | `_archive/.../pages/1_Sync_Hub.py`               | **rebuild as React landing for RM persona** |
| Carry-over / Scope Creep Metrics | Standalone view of work that slipped sprint-to-sprint                  | EM, RM  | partial  | `apps/delivery-ops` SprintReportPage             | **promote to its own page**                 |


---

## Domain 7 — KPI & Custom Metrics

The "track the metrics that matter to leadership" job.


| Feature                  | Job                                                                      | Persona | State        | Source                                           | Decision                     |
| ------------------------ | ------------------------------------------------------------------------ | ------- | ------------ | ------------------------------------------------ | ---------------------------- |
| KPI Dashboard            | Track defined KPIs (bug count, velocity, predictability) over time       | Team Executive, RM  | live         | `apps/delivery-ops` KPIPage                      | **keep**                     |
| KPI Editor               | Define + modify which KPIs are tracked and their thresholds              | Ops PM  | live         | `apps/delivery-ops` (KPI admin)                  | **keep**                     |
| Leadership Commit Report | GitHub commit activity for leadership/managers (signal of hands-on time) | Team Executive      | mcp-only     | `mcp-server/src/tools/leadershipCommitReport.ts` | **keep as MCP-only (niche)** |
| Predictive Team Executive Analytics  | Forecast quality, completion, risk for a release                         | Team Executive      | live (skill) | `.cursor/skills/predictive-team-exec-analytics/`        | **keep**                     |


---

## Domain 8 — Admin & Platform

Foundational features every other domain depends on.


| Feature                | Job                                                                 | Persona | State               | Source                                  | Decision                              |
| ---------------------- | ------------------------------------------------------------------- | ------- | ------------------- | --------------------------------------- | ------------------------------------- |
| User Management        | Add / remove users, set roles                                       | Admin   | live                | `apps/delivery-ops` AdminPanel          | **keep**                              |
| Team Management        | Define teams, project keys, board IDs, base filters                 | Admin   | live                | `apps/delivery-ops` TeamList            | **keep**                              |
| Role-Based Permissions | Map users to personas (Team Executive / TPM / RM / FEAT / EM / IC) and to pages | Admin   | live (lightly used) | `apps/delivery-ops` auth/permissions    | **extend to drive persona-aware nav** |
| Auth (JIRA PAT)        | Authenticate users via JIRA Personal Access Token                   | All     | live                | `apps/delivery-ops` auth/               | **keep**                              |
| Notifications          | In-app toasts, error banners                                        | All     | live                | `apps/delivery-ops` notificationService | **keep**                              |


---

## Connectors (Layer 1 — see ARCHITECTURE.md)

Not features per se, but the **single source of truth** for each external system.
Today these are duplicated across apps; one of them per system is the goal.


| Connector              | Currently in                                                                                                                                                           | Decision                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| JIRA                   | `mcp-server/src/connectors/jiraConnector.ts` (TS) + `apps/delivery-ops/server/middleware/auth/jira.js` (JS) + many ad-hoc axios calls in `server/routes/jira/index.js` | **consolidate to one TS connector, used by everyone**                                     |
| Confluence             | `apps/tpm-confluence-tools/src/confluence_client.py` (Python) + `apps/delivery-ops/client/src/services/confluenceService.js` (JS)                                      | **consolidate to one TS connector, used by both delivery-ops + future Bulk Page Creator** |
| GitHub                 | was in `_archive/GitHub-Commits.tar.gz`; now in `mcp-server/src/tools/leadershipCommitReport.ts`                                                                       | **extract to `mcp-server/src/connectors/githubConnector.ts*`*                             |
| AI / LLM (CrystalBall) | `crystalball-i/` package + `mcp-server` agent layer                                                                                                                    | **single `aiConnector` module**                                                           |


---

## Overlaps to retire (the "too many apps" debt)

These pairs/triples did the same thing:


| Concept             | Apps that did it                                                              | Keep                                                                 | Drop                           |
| ------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| Status updates      | status-sender + status-update-app + Release_Brief                             | status-sender                                                        | the other 2                    |
| Portfolio mgmt      | NamPortfolioManagement + jira-pm-app-full + PM-App + parts of status-sender   | status-sender                                                        | the other 3                    |
| Sprint analysis     | status-sender SprintReport + release-sprint-analysis Sprint_Analysis          | merged into one page in delivery-ops                                 | the standalone Streamlit page  |
| Confluence          | tpm-confluence-tools + status-sender ConfluenceExtractor                      | one Confluence Connector module + two UI surfaces calling it         | both ad-hoc clients            |
| Timeline / Gantt    | Release-Timelines-Visualizer + ReleaseVersionGantt + mcp ganttReleaseTimeline | one Timeline Service + one UI page + one MCP tool, all sharing logic | the duplicated implementations |
| Predictive          | CrystalBall + CrystalBall-I                                                   | CrystalBall-I                                                        | CrystalBall                    |
| Chatbot (Streamlit) | release-sprint-analysis/Chatbot                                               | the MCP agent layer (Cursor + tpm/rm assistants)                     | the Streamlit chatbot          |


---

## Gaps (features no app ever built but Ops needs)


| Gap                        | Domain           | Why valuable                                                                          |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| Sprint Planner             | Planning         | EMs currently eyeball the commit list; this would propose one from velocity           |
| Status Page Auto-Publisher | Confluence       | Today a TPM writes the same content twice (email + Confluence). One-click fixes that. |
| Ticket Triage workflow     | Triage           | Currently manual; tpm-assistant agent should drive a structured triage                |
| Carry-over standalone page | Sprint Analytics | Buried inside SprintReportPage; deserves its own surface for RMs                      |
| Cross-team dependency map  | Planning         | Multiple TPMs have asked; no app ever built it                                        |


---

## Persona → feature access matrix

Per **D6 (revised)**:
- **Tab visibility**: admin-only filter; every non-admin tab is visible to every user.
- **Default landing surface**: per-role UX default (this matrix), overridable per-user via D25.
- **Role lens (preview-as-X)**: universal — every user can preview the current page in any audience.

Every user can reach every capability. This matrix shows the **default
landing surface** and **primary interaction mode** by persona — not a
visibility filter.


| Persona                       | Domains they live in                              | Default landing surface                 | Primary interaction mode                |
| ----------------------------- | ------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| **Portfolio Manager** (you)   | all 8                                             | Ops Assistant chat + Release Versions   | agent + dashboards + workflows          |
| Team Executive / SVP                      | 1, 3, 7                                           | Ops Assistant chat (Team Executive lens)            | **agent-first, NLP, charts** (D4)       |
| Director                      | 1, 3, 7                                           | Ops Assistant chat (similar to Team Executive)      | agent + dashboards                      |
| TPM                           | 1, 4, 5, 6                                        | Release Versions                        | pages + agent for triage                |
| RM                            | 1, 2, 3, 6, 7                                     | Sync Hub (rebuilt as React)             | pages + workflows                       |
| FEAT Manager                  | 1, 2 (story points, dates), 3                     | Release Versions filtered to their FEAT | pages                                   |
| Team Manager (EM)             | 6 (sprint health), 2 (capacity), 3 (sprint Gantt) | My Team Profile                         | pages                                   |
| IC / Engineer                 | 1 (their tickets), 4 (JIRA query)                 | My Tickets                              | pages                                   |
| QA Lead                       | 4 (bugs), 6 (defect trend)                        | Sprint Insights                         | pages + agent                           |
| Architect / Tech Lead         | 1 (technical features), 3 (timeline)              | Release Timeline                        | pages + agent                           |
| Admin                         | 8 + everything                                    | Admin                                   | pages                                   |

**Critical role-vs-mode point** (per D4, D6, D8):

- Roles **6–11** (TPM down) primarily use **pages + dashboards**. They live in
  the data and click through tables.
- Roles **2–5** (Team Executive, Director, Portfolio Manager) primarily use the **Ops
  Assistant agent** in chat. The page surfaces exist as drill-in / fallback.
- The same React app serves both — what differs is which UI element gets the
  user's first click. Team Executives land in chat; FEAT Mgrs land in a table.


