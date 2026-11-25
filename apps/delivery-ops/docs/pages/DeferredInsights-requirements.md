# Deferred Insights — Requirements

**Route:** `/deferred-insights`
**Nav:** Quality / KPIs → Deferred Insights
**Permission:** `[]` (all authenticated users — KPI_VIEW restriction removed per goal)
**Team-aware:** yes — labelPrefix/releasePrefix/projectKey from `teamBoardConfig`
**Audience:** `tpm` (primary), `rm`, `ic`, `qa_lead` (secondary)

## Purpose
Per-release view of bugs that got deferred via `<prefix>-<version>-deferred` labels: how many, where they landed (which fixVersion), what is still pending. Opens with hero numbers then line graph oldest→newest, then drill-down by release with ticket tables. Reuses KPI page patterns (heroes, dual-action JIRA links, drawer).

## Audiences
- **TPM/RM**: track deferral volume and fix rate across releases, identify pending tail
- **IC/QA**: see where deferred bugs landed, component/priority breakdown, ticket samples
- **Team Exec**: skim hero totals and fix rate

## User Stories
- **DI-01** As RM, I can see per-release deferred counts over time (line graph oldest→newest with fixed vs pending) and click a point to scroll to that release.
- **DI-02** As RM/PM, I see hero numbers: total deferred, fixed elsewhere, still pending, fix rate, release count — each with JQL proof (count→in-app drill, Open in JIRA→exact JQL).
- **DI-03** As IC/QA, I can drill into any release: where deferred bugs landed (by fixVersion chips), by priority/component breakdown, expandable ticket table + drawer with JQL link.
- **DI-04** As any authenticated user, I can filter by release (multi-select chips), priority (allowlisted), component (free-text) and see all sections narrow consistently.
- **DI-05** As any authenticated user (not just kpi_view), I can access /deferred-insights via sidebar under Release tracking without permission error.

## UI Behaviour
- **Filter bar:** Release multi-chip (All + per-release toggles), Priority select (allowlist), Component input (free-text, debounced)
- **Heroes:** 5 cards (total deferred, total fixed, total pending, fix rate, release count) — count button → drill drawer, Open in JIRA → hero JQL
- **Chart:** ComposedChart deferred/fixed/pending per release, click point → scroll to `di-release-<name>` + expand
- **Release cards:** Head shows release name, badge label, counts as buttons → drawer, expand button toggles table; meta row shows label code + Open in JIRA + View tickets; mini breakdowns for byFixVersion/byPriority/byComponent; expandable table with Key/Summary/Status/Priority/Now in/Component/Assignee
- **Drawer:** Shows tickets for hero or release drill, JQL link, close via Esc/overlay/close button, focus trap

## Permissions
- Client: `ProtectedRoute permissions={[]}` in `App.js:239`, `routeConfig.js:184 permissions:[] showInNav:true`, `TAB_PERMISSIONS['/deferred-insights']=[]` — visible to all authenticated users
- Server: `validateJiraTokenMiddleware` only (no KPI_VIEW gate) — `routes/deferredInsights.js:8`

## Edge Cases
- No releases discovered → hero totals 0, emptyReason with hint to add releases or pass ?releases=
- JIRA count/fetch error per release → card shows error, hero aggregates remaining, cache skipped on partial errors
- Component filter on empty → client-side no-op, shows 0 across
- Large payload (12 releases × 200) → paginated searchPages with timeout/delay, truncated flag

## Acceptance Criteria
- [ ] GET /deferred-insights renders DeferredInsightsPage for any authenticated user (no KPI_VIEW gate, no redirect to /)
- [ ] Sidebar shows Deferred Insights under Quality / KPIs for all authenticated roles
- [ ] routeConfig entry exists with permissions [] and showInNav true
- [ ] TAB_PERMISSIONS['/deferred-insights'] = []
- [ ] Server GET /api/deferred-insights/insights and POST /api/deferred-insights/insights/refresh return 200 (not 404) with non-empty payload when JIRA reachable; alias /api/jira/deferred-insights/* also works
- [ ] Direct navigation to /deferred-insights does not redirect to / for authenticated user without kpi_view
- [ ] Unauthenticated redirects to /login (not 404)

## Out of scope (v1)
- Changelog enrichment (who moved, when — pending latency/median-lag).
- Repeat-offender (3+ deferrals) table.
- Export CSV.
