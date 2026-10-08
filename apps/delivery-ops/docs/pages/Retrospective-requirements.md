# Retrospective — Requirements

**Route**: `/release/retrospective`  
**Component**: `RetrospectivePage`  
**Permission**: `RELEASE_VERSIONS_VIEW`  
**Audience**: RM, director, TPM — post-gate behavioural analysis

---

## Purpose

The Retrospective page answers "did teams follow their gate contracts?" for a completed or in-flight release. It checks four gates (CCM, CG, PG, GA) and shows per-project compliance, a "naughty list" of top violators, reopen quality, companion readiness, and the PG-to-GA interval.

It also answers "how does this release compare to recent ones?" via a
**Cross-Release Comparison** section at the top, contrasting the selected release
against the latest big (major/minor) releases on delivery, quality, PG
bug/improvement verification, and team KPI categories — all split by resolution.

---

## User Stories

| ID | Story |
|----|-------|
| RT-01 | As an RM, I can select a release and see gate compliance across CCM, CG, PG, GA in one page. |
| RT-02 | As a director, I can see a gate timeline ruler showing when each gate occurred relative to plan. |
| RT-03 | As an RM, I can see which projects had the most gate violations ("naughty list") so I know where to focus process improvement. |
| RT-04 | As a TPM, I can click into a project to see the specific issues that caused the violation. |
| RT-05 | As an RM, I can see reopen quality — how many issues were reopened after being closed at each gate. |
| RT-06 | As an RM, I can see companion readiness — whether companion releases (patch versions) were ready when the main release shipped. |
| RT-07 | As an RM, I can see the PG-to-GA calendar interval per project. |
| RT-08 | As a user, all counts link to JIRA queries that reproduce the exact result. |
| RT-09 | As a TPM, I can compare the selected release against the latest 3 big releases on task closure, bug counts, P0/P1, reopen rate, PG verification, and team KPI categories — by resolution. |
| RT-10 | As an RM, I can see PG bug/improvement verification patterns: how many were unverified at PG and how long verification took (Resolved → Closed). |
| RT-11 | As a user, each comparison cell shows a delta vs the previous release and a trend sparkline, and links to JIRA. |

---

## UI Behaviour

0. **Cross-Release Comparison** (`ReleaseComparisonTable` + `ComparisonTrendChart`) — top section (audience: tpm, dense):
   - Columns = compared releases (latest 3 big + the selected one), oldest → newest
   - Row groups: **Delivery** (task closure %, bugs total, P0 open, P1 open, reopen rate), **PG Verification** (bug/improvement unverified@PG, verify-lag median, reopen rate), **KPI Categories** (one row per team KPI from `kpiConfig.json`, split total/done/open)
   - Every numeric cell links to JIRA; each cell shows a coloured delta vs the release on its left (green = improved, red = regressed) and a trend sparkline
   - Delivery + PG rows are offline (per-release bundles); KPI rows are live release-scoped counts
1. **Release picker** — shared with other pages via `SelectedReleaseContext`; defaults to last selected
2. **Gate timeline ruler** (`GateTimelineRuler`) — horizontal swimlane showing CCM / CG / PG / GA actual vs planned dates
3. **Gate compliance cards** (`GateComplianceCard`) — one card per gate:
   - CCM: "Tasks + Unit Tests open at code complete" — count + closed %
   - CG: "P0/P1 bugs open at commit gate" + "P0/P1 found after gate"
   - PG: "Tests and bugs closed or deferred" — open count + deferred count
   - GA: "All P0/P1 resolved" — open count at GA
4. **Naughty list table** (`NaughtyListTable`) — top N projects ranked by violation severity; expandable rows show specific tickets
5. **Reopen quality panel** (`ReopenQualityPanel`) — projects with highest reopen rate; trend over sprints
6. **Companion readiness panel** (`CompanionReadinessPanel`) — for each companion release listed in config, was it in GA when the parent shipped?
7. **PG-to-GA panel** (`PgToGaPanel`) — calendar days per project from PG to GA; benchmark line

---

## Permissions

- Requires `RELEASE_VERSIONS_VIEW`
- No write actions on this page — read-only analysis

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Release not yet at PG | PG and GA compliance cards show "Gate not reached yet" |
| Bootstrap data unavailable | Falls back to live JIRA queries; shows "Live data" badge |
| Project has zero violations | Omit from naughty list; show in "All compliant" section |
| Companion release not found in config | Omit row; show footnote "Companion config missing" |
| Top N parameter | Defaults to 10; adjustable via query param `?topN=20` |
| Fewer than 2 comparable releases | Comparison section shows "Need at least two comparable releases" |
| A release's bundle missing | That column shows "—"; other releases still render |
| KPI breakdown fails for a release | KPI rows show "—" for that release; delivery/PG rows unaffected |
| PG date unknown for a release | Unverified@PG shows "—"; verify-lag still computed from Closed dates |

---

## Acceptance Criteria

- [ ] Gate compliance cards render within 5 seconds using cached bundle data
- [ ] Naughty list is ordered by violation count descending, breaking ties by severity
- [ ] Every count in every card links to a JIRA URL returning the same issues
- [ ] Gate timeline ruler dates match `releaseVersionsEmailConfig.json` exactly
- [ ] Page renders correctly for both past releases (all gates done) and active releases (some gates future)
- [ ] Cross-Release Comparison spans the latest 3 big releases plus the selected one, oldest → newest
- [ ] Delivery + PG verification rows derive from per-release bundles offline (no JIRA call)
- [ ] KPI category rows use the team's `kpiConfig.json`, split into total/done/open by resolution
- [ ] Every comparison cell links to a JIRA query and shows a delta vs the previous release
