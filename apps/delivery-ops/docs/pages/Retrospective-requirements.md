# Retrospective — Requirements

**Route**: `/release/retrospective`  
**Component**: `RetrospectivePage`  
**Permission**: `RELEASE_VERSIONS_VIEW`  
**Audience**: RM, director, TPM — post-gate behavioural analysis

---

## Purpose

The Retrospective page answers "did teams follow their gate contracts?" for a completed or in-flight release. It checks four gates (CCM, CG, PG, GA) and shows per-project compliance, a "naughty list" of top violators, reopen quality, companion readiness, and the PG-to-GA interval.

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

---

## UI Behaviour

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

---

## Acceptance Criteria

- [ ] Gate compliance cards render within 5 seconds using cached bundle data
- [ ] Naughty list is ordered by violation count descending, breaking ties by severity
- [ ] Every count in every card links to a JIRA URL returning the same issues
- [ ] Gate timeline ruler dates match `releaseVersionsEmailConfig.json` exactly
- [ ] Page renders correctly for both past releases (all gates done) and active releases (some gates future)
