# Sprint Performance — Data Layer & Middleware Contract

**Route**: `/sprint-performance`  
**Server routes**: `server/routes/jira/sprint-performance.js` (mounted in `routes/jira/index.js`)  
**Hook**: `client/src/hooks/useSprintPerformance.js`  
**API doc**: [`docs/api/jira-sprint-performance.md`](../api/jira-sprint-performance.md)

---

## API Calls (client → server)

| Call | When |
|---|---|
| `GET /api/jira/sprint-performance/reports?teamId=` | On mount and on Reload. Returns the report list and the current job. |
| `GET /api/jira/sprint-performance/report?teamId=&file=` | After the list loads; also when another report is picked. |
| `POST /api/jira/sprint-performance/generate` `{ teamId }` | When **Regenerate from JIRA** is clicked. |
| `GET /api/jira/sprint-performance/status?teamId=` | Every 5 s, but **only while `job.state === 'running'`**; stops on done or error. |

There is no automatic refetch on error; the user retries with an explicit button. All calls go through `authenticatedGet` / `authenticatedPost` (request-gated).

---

## Server flow

```
route (sprint-performance.js)
  → sprintPerformanceReportService      list / read / write reports/, in-memory job per team
    → sprintPerformanceService.collectSprintPerformance
        → JIRA Agile  GET /rest/agile/1.0/board/{boardId}/sprint      (originBoardId filter, cadence slots)
        → JIRA GET /rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=&sprintId=   per sprint, concurrency 4
             (completedIssues, issuesNotCompletedInCurrentSprint, puntedIssues, issuesCompletedInAnotherSprint,
              issueKeysAddedDuringSprint, entityData.types/statuses, currentEstimateStatistic)
        → JIRA GET /rest/api/2/user?username=&expand=groups           per assignee (org directory)
        → JIRA POST /rest/api/2/search  key in (…100 keys…)          current status, resolution, resolutiondate, fixVersions (raw.live)
    → orgDirectory.buildOrgDirectory      manager = Team-*-DirectReports, leader = largest Team-*-Org ≤70% share
    → sprintPerformanceMetrics.computeSprintPerformance   rows, aggregates, narrative
    → sprintReleaseGates.releaseGatesForSlots   releaseVersionsEmailConfig.json → releaseGateDates, parsed by
                                                shared parseReleaseGateTimeline, mapped to slots (meta.releases)
    → sprintPerformanceHtml.renderSprintPerformanceHtml   static sections + embedded payload + inline app
  → fs  apps/delivery-ops/reports/Sprint-{Team}-S{a}-S{b}-{YYYY-MM-DD}.html
```

The CLI `server/scripts/generateSprintPerformanceReport.js` uses the same service (`writeReport`).

---

## Data shapes

**Embedded payload** (the `sprintPerformanceApp(DATA)` argument inside the HTML):

```json
{
  "meta": { "teamName": "NDB", "slots": [{ "slot": 54, "name": "S54", "range": "03 Jun–23 Jun", "url": "…" }],
            "config": { "rag": { "greenSayDoPct": 75, "yellowSayDoPct": 60 } }, "sprintScope": "…",
            "jiraBaseUrl": "https://jira.nutanix.com", "unassignedLabel": "Unassigned" },
  "dict": { "teams": [], "managers": [], "leaders": [], "people": [], "types": [], "statuses": [] },
  "groups": { "managers": { "Name": "Team-Name-DirectReports" }, "leaders": { "Name": "Team-Name-Org" } },
  "issues": { "ERA-12345": ["summary", 0, 1] },
  "sprints": { "30298": "NDB-LEIA-S51(26/Aug-15/Sep)" },
  "rows": [["ERA-12345", 54, 30111, 0, 2, 1, 7, 37, 3, 2]]
}
```

- **Row layout:** `[key, slot, sprintId, teamIdx, managerIdx, leaderIdx, personIdx, flags, storyPoints, sprintCountEver, statusAtCloseIdx]`.
- **Flag bits** (in order): `added, removed, done, carried, devDone, testDone, qaVerified, pendingQA, unresolvedNow, isTest, doneElsewhere`.
- **Unit:** one row is one issue listed in one sprint's JIRA Sprint Report (all issue types, as JIRA shows them).
- **Done** = Completed Issues (board done column at sprint close) + completed outside the sprint. **Carried** = Issues Not Completed. **Removed** = Issues Removed From Sprint. **Added** = keys JIRA marks *.
- **Story points** = `currentEstimateStatistic` of completed issues (equals JIRA's completed estimate sum).
- `meta.sprintReportBase` + sprint id = the JIRA Sprint Report URL.
- **Status:** sprint-report status is the status at sprint close; it is kept per row (`rows[i][10]`) for the drill-down. "Now" flags (`unresolvedNow`, `pendingQA`) and `issues[key][1]` use the live status from `raw.live`.
- `issues[key]` = `[summary, liveStatusIdx, typeIdx, resolutionIdx, resolvedIso, [fixVersionIdx…], shippedInIdx|-1]`; `versionInfo[name]` = `[released 0/1, releaseDate]`.
- `meta.releases` = `[{ release, type, gates: [{ kind: EC|CCM|CG|PG|GA, label, iso, style: solid|dotted, color, slot, frac }] }]`, limited to the release prefix of the team and to gates inside the window. `frac` is the position within the slot (0–1). `dotted` = superseded date.
- Discipline phases are computed in the browser (`sprintPerformanceTimeline.segmentPhases`) from the filtered rows: binary segmentation on planned-weighted say/do.

---

## Caching

- Reports on disk are the cache. Page loads never call JIRA.
- Regeneration is explicit (button or CLI). There is no TTL.
- Only one job runs per team at a time; job state lives in memory and resets when the server restarts.
- The CLI `--cache <path>` flag reuses a raw dataset for offline re-renders.

---

## Error handling

| Failure | Behaviour |
|---|---|
| Missing/invalid JIRA token | 401 from `validateJiraTokenMiddleware`; the hook shows the message with a Retry button. |
| Unknown `teamId` | 400 `Unknown team`. |
| No report yet | 404 from `/report`; the page shows the empty state. |
| JIRA timeout during generation | Board fetch and each sprint report are retried 3× with a 60 s timeout; a persistent failure fails the job. |
| Job failure | `job.state = 'error'` with a message; the previous report remains. |

---

## Config

`server/config/sprintPerformanceConfig.json`:
- defaults: window slots, RAG thresholds, grace hours, resolutions, QA ratio, ranking minimums, `phaseMinSprints` / `phaseMinShiftPts` (discipline timeline);
- per-team: cadence anchor, `managerLeaderOverrides`.
