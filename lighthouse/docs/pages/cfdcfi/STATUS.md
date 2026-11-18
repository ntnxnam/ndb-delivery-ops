# STATUS — CFD / CFI hero → in-page popup

**Updated**: 2026-10-16  
**Goal state**: COMPLETE (post-fix: 3-series chart + drill title)

## KPI scorecard

| KPI | Status | Evidence |
|-----|--------|----------|
| G1 Hero → in-page drill | MET | `CfdCfiPage.heroDrill.test.js`: click `Show Open now: 2` → `role=dialog` “Open now — Top-CFD” with `ERA-90001` / `ERA-90002` |
| G2 JIRA proof retained | MET | Same test: drawer link encodes exact `OPEN_JQL`; tile hint `Open Open now in JIRA` present |
| G3 Optional kit API | MET | `PulseHero.onOpen` / `KpiPulseBand.onHeroClick`; pages omitting props keep JIRA-only `<a>` (`PulseHero.test.js`) |
| G4 Tests | MET | `CI=true npx react-scripts test --testPathPattern='CfdCfiPage.heroDrill\|openTicketsFilter\|PulseHero'` → **13 passed / 3 suites** (incl. Created/Resolved → JIRA) |
| G4 Release artifact | MET | This STATUS + `CfdCfi-requirements.md` CC-04/AC + `feature.md` / `GOALS.md` / `PLAN.md` |
| Constraints | MET | No hard-coded Top-CFI/Top-CFD in page/service; pattern from `cfdcfiConfig`; no JQL builder edits |

## Completion audit (objective checklist)

| Requirement | Verdict | Source |
|-------------|---------|--------|
| Hero click opens `OpenTicketsDrill` | MET | Page test dialog + ticket rows |
| Shows ticket info | MET | Key + summary in dialog |
| Not only external JIRA | MET | Count is `<button>`; JIRA is secondary |
| Verified by tests | MET | 11 passed |
| KPI dashboard behavior | MET | Rendered `CfdCfiPage` integration test (dashboard UI) |
| Release artifact | MET | docs/pages/cfdcfi/* + requirements AC |
| Maintain feature/GOALS/PLAN/STATUS | MET | All four files present and updated |

## Risks (residual)

- Open sample may truncate vs hero count — drawer copy + JIRA proof cover authenticity

## Chart series note (2026-10-17)

→Resolved / →Closed weekly bars use `status changed to … after/before` (not `resolutiondate`).

**Blank Top-CFI chart (Open=12, flow=0):** pulse was composed on team `combinedJql`, which includes `statusCategory!=Done`. That drops Closed/Resolved tickets from the universe, so Created/→Resolved/→Closed stayed zero. Fix: `buildPulse` uses KPI filter JQL only (`resolveKpiJql`); open list still uses open-scoped `combinedJql`.

## Created / Resolved click (2026-10-17)

`PULSE_PANEL_HERO_KEYS` in `KpiPulseBand` — only open-family heroes get `onOpen`. Created / Resolved / MTTR are count → JIRA (no empty drawer), same as OnCalls Created/Closed 7d.

## Next (optional)

Pull again on `/cfdcfi` — **Bars** mode shows Created (blue) / →Resolved (orange) / →Closed (green) side-by-side (not stacked).
