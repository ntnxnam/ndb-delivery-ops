# Feature Dashboard — Requirements

**Route**: `/feature-dashboard`  
**Component**: `FeatureDashboardPage`  
**Permission**: `RELEASE_VERSIONS_VIEW`  
**Audience**: FEAT manager, TPM — feature-scoped deep dive

---

## Purpose

The Feature Dashboard gives a feature manager a single-feature view: enter a FEAT ticket key, pick a release, and see the complete payload under that feature — epics, stories, bugs — with gate-date progress, bug phase distribution, and a reconciliation check comparing what's in the feature's scope vs what's actually tagged to the release.

---

## User Stories

| ID | Story |
|----|-------|
| FD-01 | As a FEAT manager, I can enter a FEAT ticket key and see all sub-items so I know what's in my feature. |
| FD-02 | As a FEAT manager, I can see my feature's gate dates (CCM, CG, PG) and how many open items remain per gate. |
| FD-03 | As a FEAT manager, I can see bug counts broken down by test phase (regression, system-test, longevity, performance, stress). |
| FD-04 | As a TPM, I can do a reconciliation check — items in the feature tree that are NOT tagged to the release — to catch scope leaks. |
| FD-05 | As a FEAT manager, I can see an epic completion trend chart (closed epics over time). |
| FD-06 | As a user, every count links to the corresponding JIRA query. |
| FD-07 | As a user, I can switch releases and have the feature key persist so I can compare the same feature across releases. |
| FD-08 | As a FEAT manager, I can see an overall completion Gantt of every feature in the release — plotted against EC / CC / CG / PG / GA — before I choose a single feature to open. |

---

## UI Behaviour

1. **Release picker** — reuses the global release list; defaults to the currently selected release
2. **Overall completion Gantt** — shown as soon as a release is selected (before Choose). One row per Feature/Initiative; bars span EC → the feature's latest CC/CG/PG date; colour is the JIRA Risk Indicator (green / yellow / red / blue if unset). Gate dates from the release calendar are vertical rulers. Clicking a row selects that feature and opens the dashboard.
3. **Feature picker** — dropdown of FEAT-tier tickets for the selected release; pressing Choose (or clicking a Gantt row) loads the dashboard
4. **Gate status row** — three chips (CCM / CG / PG) each showing open count + RAG colour; each clickable to JIRA
5. **Bug phase breakdown** — horizontal bar chart with per-phase counts: Regression, System Test, Longevity, Performance, Stress, Unit Test
6. **Epic completion chart** — line chart, X = week, Y = cumulative closed epics; reference lines at gate dates
7. **Reconciliation table** — issues that are children of this FEAT but have a different or missing fixVersion; shows divergence from expected release scope
8. **Reason override** — inline dropdown on each reconciliation row to mark it as "Intentional defer", "Wrong version", "Need to tag", etc.

---

## Permissions

- Requires `RELEASE_VERSIONS_VIEW`
- Reconciliation reason overrides are written to `localStorage` (no server persistence yet; future: server-side per D-TBD)

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Invalid FEAT key | Show "Feature not found" inline error |
| FEAT has no children | Show "No sub-items found under this feature" |
| Feature spans multiple releases | Show data for selected release only; note "X items in other releases" |
| Phase labels absent from all bugs | Hide bug phase chart; show "No phase labels found" |
| Reconciliation finds zero mismatches | Show green "All items tagged correctly" state |
| Feature has no CC / CG / PG dates | Gantt row shows a dashed empty bar |
| Release has no EC or GA in calendar config | Show "Release gate dates (EC → GA) are not configured" instead of the chart |

---

## Acceptance Criteria

- [ ] Overall Gantt appears after a release is selected and before a feature is chosen
- [ ] Gantt row count matches the Feature picker list
- [ ] Clicking a Gantt row opens that feature's dashboard
- [ ] Feature data loads within 8 seconds for a feature with ≤500 sub-items
- [ ] Bug phase chart only shows phases that have at least 1 issue
- [ ] Reconciliation table is accurate: every row is a confirmed scope mismatch
- [ ] Gate chips RAG colours match the same logic used in Retrospective (same thresholds)
- [ ] Feature key persists in URL query param (`?feat=ERA-XXXX`) for shareability
