# Sprint Performance — Requirements

**Route**: `/sprint-performance`  
**Component**: `SprintPerformancePage`  
**Permission**: `SPRINT_REPORTS_VIEW`  
**Audience**: `director` / `team-exec` (primary), `tpm` (exploration)

---

## Purpose

This is a leadership view of sprint delivery across every scrum team on a product board, for the last ~2 years (35 three-week cadence slots, configurable via `windowSlots`). Per-sprint numbers come from JIRA's own Sprint Report, so they match board → Reports → Sprint Report exactly. It answers three questions: "are we doing what we said?", "which org, manager or team is improving or slipping?" and "what should leadership act on?"

The page embeds a self-contained interactive HTML report. The same file can be downloaded and forwarded by email as is.

Unlike the Sprint Report page (one sprint, one team), this page covers many teams and many sprints, and groups results by reporting line (leader, then manager).

---

## Audiences

| Audience | Use |
|---|---|
| Director / Team Exec | Reads the verdict, highlights, lowlights and asks. Forwards the downloaded HTML. |
| Portfolio Manager / TPM | Filters by leader, manager or team; drills into a sprint cell; follows JIRA links to verify numbers. |
| EM | Filters to their own group to see their trend and chronic carry-overs. |

---

## User Stories

| ID | Story |
|----|-------|
| SP-01 | As a director, I see an org-wide RAG verdict with its rule (say/do thresholds) in one line. |
| SP-02 | As a director, I see highlights and lowlights. Each one cites the JIRA query behind it. |
| SP-03 | As a TPM, I can filter by leader, manager, scrum team and work type (Dev/Test), and every tile, chart and table re-computes. |
| SP-04 | As a TPM, I can click any team or manager name to filter by it, and click it again to clear the filter. |
| SP-05 | As a TPM, I can click a heatmap cell (team × sprint) to see every ticket in it with its outcome (Done / Carried / Not done / Invalid) and whether it was planned or added mid-sprint. |
| SP-06 | As an EM, I can search the chronic carry-over list by key, summary, assignee, manager or team. |
| SP-07 | As any user, every number opens the matching JIRA query (sprint IDs + `membersOf` group + issue type). |
| SP-08 | As a TPM, I can regenerate the report from live JIRA and see progress while it runs. |
| SP-09 | As any user, I can download the HTML or open it in a new tab. |
| SP-11 | As any user, every single-sprint link opens that sprint's JIRA Sprint Report (`RapidBoard.jspa?rapidView={board}&view=reporting&chart=sprintRetrospective&sprint={id}`), and the drill-down shows the same Completed / Not Completed / Removed lists with * for added issues. |
| SP-12 | As a director, I can narrow the range to the last 6 / 12 / 18 sprints or keep all ~2 years. |
| SP-13 | As a director, I read a plain-language discipline timeline ("between date X and date Y discipline was strong, after that it dwindled") with each phase's say/do, completion, scope added and the release gates that fell inside it. |
| SP-14 | As a TPM, I see say/do in the 2 sprints before, the sprint of, and the 2 sprints after every release gate (CC / CG / PG / GA, optionally EC), and can toggle gate types and superseded dates. |
| SP-10 | As any user, filter state is kept in the URL hash, so a downloaded file reopens with the same view. |

---

## UI Behaviour

1. **Toolbar** (app page):
   - report picker (shown only when there is more than one report);
   - **Regenerate from JIRA**, which is disabled while a job runs;
   - **Reload**, **Download HTML** and **Open in new tab**;
   - a status line showing the file name and modified time, job progress, or the last error.
2. **Report iframe** (`srcDoc`, sandboxed `allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads`) fills the remaining height.
3. **Inside the report:**
   - **Org-wide (not filtered):** verdict, highlights/lowlights, sprint hygiene, asks of leadership, appendix.
   - **Filtered (sticky filter bar):**
     - six KPI tiles (Say/Do, Completion, Scope added, Items delivered, Carried over, QA queue);
     - discipline timeline: auto-detected phases (split where say/do shifts ≥ `phaseMinShiftPts` for ≥ `phaseMinSprints` sprints), narrative per phase, say/do chart with phase bands, one lane per release with gate markers (hollow ◇ = superseded date), and a say/do-around-each-gate table;
     - delivery-trend chart and three-velocity-streams chart;
     - scrum-team heatmap (sortable columns; cells drill down);
     - leader/manager table (sort by items, say/do or decline; sparkline per row);
     - chronic carry-over table: every ticket planned into 3+ sprints (scroll box, sticky header, search), with live status, resolution, closed date, fix versions and "shipped in" (earliest released fix version on/after the closed date); tabs for Still open / Resolved — awaiting QA / Closed / All.
   - **Drill-down:** a side panel that closes with ✕, Esc, or a click on the backdrop.
4. **Empty state:** a dashed box prompting **Regenerate from JIRA**.

---

## Permissions

- **Client:** `SPRINT_REPORTS_VIEW` (route + sidebar via `TAB_PERMISSIONS['/sprint-performance']`).
- **Server:** `requireAuth('sprintReport')` + `validateJiraTokenMiddleware`. Generation uses the caller's own JIRA token.

---

## Edge Cases

| Case | Behaviour |
|---|---|
| No report on disk | Empty state; **Download** and **Open in new tab** are disabled. |
| Generation already running | POST returns the running job; no second job starts. |
| Generation fails | Status line shows "Last generation failed: …"; the previous report stays visible. |
| Team renamed over time (case, punctuation, date suffix) | Merged under the most recent spelling. |
| Team with no sprint in the last 3 slots | Collapsed behind "Show N teams…" and excluded from highlight/lowlight rankings. |
| Leader / manager / work filter active in drill-down | Banner warns the lists are a subset of the JIRA report. |
| Sprint started before planning (≥90% added after start) | Team row is greyed out, labelled "not scored", and sorted last. Scope shows as "–". |
| Team with fewer than `minPlannedForRanking` planned items | Not scored and excluded from highlight/lowlight rankings. |
| Assignee with no `Team-*-DirectReports` group | Grouped under "Unmapped (no manager group)"; the ownership-gap lowlight fires at ≥5%. |
| Matrix org (manager's reports split across leaders) | Manager placed under the majority leader. `managerLeaderOverrides` in config can force placement. |
| Latest slot still active | Appendix notes the slot is still closing. |
| Filter yields no rows | Tables show "No items for this filter." |

---

## Acceptance Criteria

- [ ] **Sprint Performance** appears in the left sidebar for users with `sprint_reports_view`.
- [ ] The page loads the newest `reports/Sprint-{Team}-S*-S*-{date}.html` without any JIRA call.
- [ ] **Regenerate** completes in about 3–4 minutes for the 2-year window (~500 sprints) and auto-loads the new report.
- [ ] With no leader/manager/work filter, a sprint's completed / not completed / removed / added counts and completed story points equal JIRA's Sprint Report for that sprint.
- [ ] Every single-sprint link opens the JIRA Sprint Report; multi-sprint ↗ links open a `Sprint in (…)` ticket search.
- [ ] Filters, sorting and drill-down work inside the iframe and in the downloaded file.
- [ ] The report contains no `localhost` URLs. All CSS and JS are inline, with no external requests.
- [ ] RAG verdict follows: green ≥75%, yellow ≥60%, else red (configurable).
