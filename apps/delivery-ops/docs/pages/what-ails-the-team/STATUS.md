# STATUS — What ails the team

**Updated**: 2026-10-17  
**Goal state**: COMPLETE (pipeline KPIs MET after Fix loop)

## Goal KPI Card

See `GOALS.md`.

## KPI scorecard

| KPI | Status | Evidence |
|-----|--------|----------|
| G1 KPI-family exec band | MET | `/kpis`, `/oncalls`, `/cfdcfi`, `/system-test-scale` + `execPageBriefingWiring.test.js` |
| G2 Release exec band | MET | `ReleaseVersionTab` + wiring test |
| G3 Feature exec band | MET | `FeatureDashboardPage` band **above** Gantt + wiring test |
| G4 Multi-call stitch | MET | `pageAiBriefingService.test.js` — facets ∥ → stitch → compress; `sanitizeSummaryKeys` |
| G5 Persona gate | MET | Client `isExecAudience` + server `requireAuth('execAudience')`; hook no-fetch when disabled |
| G6 Perf / reliability | MET | Parallel facets; Retry works after error (`lastKeyRef` cleared on fail) |
| G7 Security | MET | Auth on route; AI key server-side; no localhost; React linkify; Security 5/5 |
| Docs | MET | Feature/GOALS/PLAN/STATUS + `docs/api/ai.md` page-briefing |

## Test evidence

```
server: pageAiBriefingService|auth.execAudience → 9 passed
client: ExecPageBriefing|useExecPageBriefing|execPageBriefingWiring → 12 passed
```

## Pipeline

| Stage | Status | Notes |
|-------|--------|-------|
| 0 Docs + KPI proposal | MET | |
| 1 Developer | MET | |
| 2 Code Review (Bugbot) | MET after Fix | Retry + server gate + ROLE_PERMISSIONS |
| 3 QA | MET | 3/3 |
| 4 UX | MET after Fix | Band above Gantt; no NAI meta chrome |
| 5 PM | MET after Fix | OnCalls dual-auto suppressed for exec; wiring AC |
| 6 Exec | MET after Fix | Compress VALID keys + post-sanitize |
| 7 JIRA Query Check | MET | No JQL builder edits on briefing path |
| 8 Fix | MET | Cycle 1 |
| 9 Security | MET | 5/5 on feature slice |

## Open asks (user)

1. Confirm / expand `execAudienceUsers` in `allowedUsers.json` (seeded list).
2. **Adjacent WIP** (not this feature): dirty `kpiConfig.json` OnCalls `baseQuery` / Bugs-Out-of-SLA — needs explicit JQL approval before merge (`jql-edit-approval`).
3. Manual smoke: exec login → Pull on each surface with live NAI.

## Residual

- Live NAI latency not CI-measured
- KPI count-only snapshots correctly omit ticket keys (sanitize strips any invented keys)
