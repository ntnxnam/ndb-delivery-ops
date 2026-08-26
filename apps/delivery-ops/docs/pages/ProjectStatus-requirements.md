# Project Status — Requirements

**Route**: `/project-status`  
**Component**: `ReleaseVersionTab`  
**Permission**: `RELEASE_VERSIONS_VIEW`  
**Audience**: RM, TPM, director — primary release health surface

---

## Purpose

The Project Status page is the central release payload dashboard. It shows the full engineering payload for a selected release — all tickets across the 5-bucket structure (top-level projects, portfolio children, epic children, standalone epics, direct tickets) — in a filterable table with a Gantt timeline, and supports bulk status-email generation.

---

## User Stories

| ID | Story |
|----|-------|
| PS-01 | As a TPM, I can select a release version and see the full payload table so I know what's in scope. |
| PS-02 | As an RM, I can filter the table by team, component, status, and priority to focus on at-risk items. |
| PS-03 | As a director, I can see a Gantt chart of all payload items plotted against gate dates. |
| PS-04 | As an RM, I can generate a status email from the current filtered view. |
| PS-05 | As a TPM, I can see RAG status per project row without opening JIRA. |
| PS-06 | As a user, every count is a clickable link that opens the corresponding JIRA query. |
| PS-07 | As an RM, I can see gate dates (CCM, CG, PG, GA) as vertical rulers on the Gantt. |
| PS-08 | As a user, changes to the release selector persist to localStorage so my selection survives a refresh. |
| PS-09 | As a user, I can pick a team from a dropdown on the page (same control as other pages), not only from a hidden header. |
| PS-10 | As a user, changing the Team dropdown does not load data until I click Fetch, which then reloads this page and other team-scoped pages. |
| PS-11 | As a user, after I Fetch a team, the Release Version dropdown lists unique `fixVersion` names from tickets in that team's `baseFilter`. Missing `baseFilter` shows the Admin error and an empty dropdown. |

---

## UI Behaviour

1. **Team picker** — dropdown at top of the toolbar (and in the sidebar). Changing the dropdown only stages a team; **Fetch** applies it and loads fixVersions from `(${team.baseFilter}) AND (fixVersion is not EMPTY)`. Applied team persists in localStorage as `releaseVersionSelectedTeamId`. Shown even when the teams API fails, with a Retry control.
2. **Release picker** — dropdown next to the team picker; populated from JIRA; selection persists in localStorage
3. **Payload summary row** — shows total issues, open bugs, P0/P1 count, closed % as clickable KPI chips
4. **Filter bar** — team, component, status, priority, issue type; all client-side after initial load
5. **Payload table** — columns: Key, Summary, Type, Status, Priority, Assignee, Fix Version, Gate Date; sortable
6. **Gantt section** — horizontal bars per issue using JIRA date hierarchy (gate dates for FEAT tier, dueDate for Epics, sprint end for lower-level); gate rulers as vertical lines
7. **Email generation button** — opens EmailSender pre-filled with current view's data
8. **Legend** — colour coding for issue types and RAG statuses

---

## Permissions

- Requires `RELEASE_VERSIONS_VIEW`; users without it are redirected to Email Sender
- Gate date editing requires `RELEASE_SETUP_MANAGE` (surfaced as disabled controls for read-only users)

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Release with zero payload | Show "No issues found for this release" empty state |
| JIRA API timeout on initial load | Show skeleton loader for 10 s, then error with retry button |
| Issue with no gate date | Shown in Gantt as unscheduled (grey, no bar) |
| Sprint-based ticket with no sprint | Show blank Gantt bar; tooltip "No sprint assigned" |
| Payload > 5,000 issues | Table virtualised; Gantt caps at top 200 by due date proximity |
| User switches team (e.g. NDB → MSP) | Previous release is cleared; dropdown reloads from `POST /api/jira/release-versions` for the new team; default is picked from that list only |
| Parent-team version pattern is a glob (`*msp*`, `msp*`) | Treated as a wildcard, never thrown as `Invalid regular expression: Nothing to repeat` |

---

## Acceptance Criteria

- [ ] Release selector loads within 2 seconds of page mount
- [ ] Full payload table renders within 10 seconds for a release with ≤2,000 issues
- [ ] All KPI chip numbers link to JIRA queries that return the same count (±1 for timing)
- [ ] Gantt gate rulers align with dates from `releaseVersionsEmailConfig.json`
- [ ] Filter combinations produce correct subsets without a server round-trip
- [ ] Selected release survives browser refresh (localStorage)
- [ ] Team dropdown is visible on the page toolbar and in the sidebar; Retry appears if `/api/config/teams` fails
- [ ] Choosing a team (or Refresh on the current team) reloads Project Status and other team-scoped pages
- [ ] After Fetch, the release dropdown contains only fixVersions that appear on tickets in the selected team's `baseFilter`
- [ ] Switching away from NDB does not leave `NDB-2.11` selected
