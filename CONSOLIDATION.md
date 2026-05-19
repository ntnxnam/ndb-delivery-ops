# Consolidation Port Tracker

Single source of truth for what's being merged from 17 archived apps + 5 skills into the `ndb-delivery-ops` monorepo. Every row is a capability, not an app.

**Runtime decision:** single Node + TypeScript runtime. Python sources from archives are ported, not run alongside.

## Status legend

- `pending` — source identified, not yet ported
- `porting` — actively being ported in current branch
- `ported` — TS implementation exists in `shared/services/` or `apps/delivery-ops/server/services/`, callable
- `wired` — exposed through an API route AND consumed by at least one UI page
- `skip` — archive contained no usable code

## Trunk (everything depends on this)

| # | Capability | Source | Target TS module | Status |
|---|---|---|---|---|
| 1a | 5-bucket release payload JQL builders + sidecars | `release-sprint-analysis-with-chatbot/payload_jql.py` | `shared/services/payloadJqlService.ts` | **ported** (9/9 parity tests pass; D1 product-agnostic via `projectKey` + `labelPrefix`) |
| 1b | Canonical `releaseDataset` (`processed_df` equivalent + cache) | `release-sprint-analysis-with-chatbot/data_layer.py` (1,508 LOC) | `shared/services/releaseDatasetService.ts` | pending |

## Capabilities that read from the trunk

| # | Capability | Source | Target | Status |
|---|---|---|---|---|
| 2 | 3-stream sprint velocity (Dev / QA-Verif 1:3 / QA-Test) | `team_velocity_profile.py` | `shared/services/velocityService.ts` | pending |
| 3 | Insights engine (z-score, severity, phase, WoW diff) | `insights*.py` | `shared/services/insightsService.ts` | pending |
| 4 | Landing forecast (release date prediction) | `landing_forecast.py` | `shared/services/landingForecastService.ts` (replaces stub) | pending |
| 5 | Chart catalog + `[chart:<id>]` tokens | `chart_catalog.py` | `shared/services/chartCatalogService.ts` (replaces stub) | pending |
| 6 | NAI chatbot (one-tool function-calling) | `chatbot_tools.py + chatbot_router.py + chatbot_context.py + nai_client.py` | `shared/services/chatbot/{tools,router,context,naiClient}.ts` | pending |
| 7 | Team Executive release report generator | `~/.cursor/skills/team-exec-release-report/` | `shared/services/vpReportService.ts` + retain skill | pending |
| 8 | Predictive Team Executive analytics (Monte Carlo, completion prob, QI forecast) | `~/.cursor/skills/predictive-team-exec-analytics/` | `shared/services/predictiveAnalyticsService.ts` | pending |
| 10 | Date mover — gate-date move with **mandatory reason + Confluence audit** (D30) | `ndb-date-mover/` + new Confluence audit writer | `shared/services/dateMoverService.ts` + depends on `shared/connectors/confluenceConnector.ts` | pending |
| 11 | Outstanding-work pulse (realistic timeline) | `NDB-Outstanding-Work-Realistic-Timelines/shipwatch + jira-fetcher` | `shared/services/outstandingWorkService.ts` | pending |
| 13 | Release timeline visualizer (date overrides, holiday cal) | `Release-Timelines-Visualizer/` | `apps/delivery-ops/client/src/components/ReleaseTimelineVisualizer/` | pending |
| 14 | Bin packing / resource Gantt | `ndb-projects-bin-packing/` | `shared/services/binPackingService.ts` | pending |
| 15 | Say-vs-do tracking | `ndb-say-vs-do/` | `shared/services/sayVsDoService.ts` | pending |
| 16 | Story point calculator (JIRA + Confluence) | `ndb-story-point-calculator/` | `shared/services/storyPointService.ts` | pending |

## Independent / already in monorepo

| # | Capability | Source | Target | Status |
|---|---|---|---|---|
| 9 | Capacity planner (t-shirt, bandwidth, rollup) | `ndb-capacity-planner/` (103 Py files) | `shared/services/capacityService.ts` | pending |
| 12 | Confluence template engine + page mgmt | `Confluence-Page-Creator/` | `apps/tpm-confluence-tools/` | already in repo (Python) — needs port |
| 17 | Fetch project tickets (8-clause JQL primitive) | `~/.cursor/skills/fetch-project-tickets/` | `shared/services/ticketFetchService.ts` | **ported** (28/28 parity tests; single+bulk forms; comprehensive+work-items views; URL builders; D1 product-agnostic via `projectKey`) |
| 18 | Sprint Gantt chart (date-hierarchy-aware) | `~/.cursor/skills/sprint-gantt-chart/` | `apps/delivery-ops/client/src/components/SprintGantt/` | pending |
| 19 | Confluence width cleanup | `~/.cursor/skills/confluence-width-cleanup/` | retain as skill (no code port) | retained as skill |
| 20 | Status sender (current app) | `apps/delivery-ops/` | — | already in repo |

## New cross-cutting need surfaced during inventory

| Capability | Why surfaced | Target | Status |
|---|---|---|---|
| Confluence connector (read + structured-row append) | Required by #10 (D30) and #12; previously assumed deferrable | `shared/connectors/confluenceConnector.ts` | pending — must land before or with #10 |

## Skip (no usable code)

- `PM-App` — empty (.git only)
- `NamPortfolioManagement` — one orphan file
- `jira-pm-app-full` — early ancestor of #20
- `ndb-status-update-app` — early ancestor of #20
- `GitHub-Commits` — docs only
- `NDB-SWOT` — docs only
- `Data-Dash` — appears to be an earlier branch of the chatbot app; supersede with #1-#6

## Speculative stubs to retire when their port lands

These were written in Phase D1 before the inventory was done. Each is replaced by the corresponding ported service above.

- `shared/services/statusService.ts` (releaseRag + topBlockers) → folded into #1, #3
- `shared/services/predictabilityService.ts` (predictLanding + sayVsDo stubs) → replaced by #4 + #15
- `shared/services/dependencyService.ts` (graph stubs) → leave for now, port later
- `shared/services/chartService.ts` (placeholder SVG) → replaced by #5

## Port pattern (the contract every row follows)

Each capability port lands in a single PR-shaped commit with:

1. The TS module in `shared/services/` (pure logic, no Express, no React)
2. Unit tests in `shared/tests/<service>.test.ts` covering the same behaviour the Python tests covered
3. An API route in `apps/delivery-ops/server/routes/` that calls the service
4. A UI surface in `apps/delivery-ops/client/src/` that calls the route (when applicable)
5. Update this table: status `pending` → `porting` → `ported` → `wired`
6. Update `DECISIONS.md` only when a design choice is forced (not for routine ports)
