# Sprint Report — Requirements

**Route**: `/sprint-report`  
**Component**: `SprintReportPage`  
**Permission**: `SPRINT_REPORTS_VIEW`  
**Audience**: EM, TPM, team lead — sprint velocity and health

---

## Purpose

The Sprint Report page provides sprint-level velocity reporting for a team. It supports three modes: Past Sprint (closed sprint analysis), Current Sprint (in-flight), and Trends (multi-sprint longitudinal — currently inactive/WIP). Data comes from the team dataset bundle (pre-computed) or live JIRA sprint API.

---

## User Stories

| ID | Story |
|----|-------|
| SR-01 | As an EM, I can select a past sprint and see how many issues were resolved — broken down by Dev velocity, QA verification, and QA test tasks. |
| SR-02 | As an EM, I can see the issue breakdown by resolution category (Done, Unresolved, Duplicate/Not Repro, Others). |
| SR-03 | As an EM, I can select a fiscal quarter / year and see the sprint reports for all sprints within it. |
| SR-04 | As an EM, I can see a pie chart of issue types for the selected sprint. |
| SR-05 | As an EM, I can see open P0/P1 bugs for the current sprint. |
| SR-06 | As a TPM, I can switch team context and see the same views for a different team without navigating. |
| SR-07 | As a user, all velocity numbers link to JIRA queries reproducing that exact count. |

---

## UI Behaviour

1. **Mode tabs** — Past / Current (Trends tab visible but disabled with "Coming soon" tooltip)
2. **Team selector** — inherits from global team context; changing it reloads the sprint list
3. **Sprint selector** — dropdown of available sprints for the selected team
4. **Fiscal quarter picker** — Nutanix fiscal year (Q1 = Aug–Oct); selecting a quarter shows sprints within that range
5. **Velocity breakdown** — three bars or chips per sprint: Dev Velocity (blue), QA Verification (orange), QA Test Tasks (green)
6. **Resolution pie chart** — Done / Unresolved / Duplicate-or-Not-Repro / Others
7. **Issue type pie chart** — Task / Bug / Improvement / Test / other
8. **P0/P1 open bugs table** — for Current sprint mode only; links to JIRA per issue

---

## Modes

| Mode | Data source | Sprint selection |
|------|------------|-----------------|
| Past | Bundle (pre-computed) | Pick any closed sprint |
| Current | Live JIRA sprint API | Auto-selects active sprint |
| Trends (WIP) | Bundle | Multi-select sprints; line chart |

---

## Sprint System

- Duration: 3 weeks, Wednesday-to-Wednesday
- Anchor: NDB-2.8 CC date 2024-10-30 (S1 end)
- Naming: S1, S2, S3 … (numerical, never alphabetical sort)
- Fiscal quarter ranges: Q1 Aug–Oct, Q2 Nov–Jan, Q3 Feb–Apr, Q4 May–Jul

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Team has no sprint data in bundle | Falls back to live JIRA board sprint API |
| Sprint with 0 resolved issues | Show "No resolved issues in this sprint" empty state |
| Fiscal quarter has no sprints (future quarter) | Show "No sprint data for this period" |
| Active sprint mid-flight | Current mode shows partial data with "Sprint in progress" badge |

---

## Acceptance Criteria

- [ ] Past sprint data loads from bundle within 2 seconds
- [ ] Sprint selector shows sprints in numerical order (S1, S2 … not S1, S10, S11, S2)
- [ ] All three velocity types are shown as separate bars / chips — never collapsed into a single number
- [ ] Fiscal quarter correctly maps to Nutanix fiscal calendar (Q1 starts Aug 1)
- [ ] Every count links to a JIRA URL returning the matching issues
