# Sprint Report — Data Layer & Middleware Contract

**Route**: `/sprint-report`  
**Server routes used**: `server/routes/jira/index.js` (sprint sub-routes)  
**Hooks**: `useTeam` (shared `TeamContext` — no extra teams fetch)

---

## API Calls (client → server)

### 1. Fetch team list (shared)

```
GET /api/config/teams
```

**Server flow**: `config.js → teamConfig.loadTeamBoardConfig()` — no JIRA call  
**Returns**: `{ teams: [{ id, name, boardId, baseFilter, sprintCalendar, featureComponents, ... }], defaultTeamId }`  
**Context**: `TeamContext` fetches once on app mount. Sprint JQL is scoped with the sprint scope derived from the selected team's `baseFilter` (ORDER BY and trailing `statusCategory != Done` removed; `getTeamSprintBaseFilter` / `sprintScopeFromBaseFilter`).

---

### 2. Past sprint report (live JIRA)

```
POST /api/jira/sprint-report-by-range
Headers: x-jira-token, x-username
Body: { teamId, startDate, endDate, componentNames? }
```

**Client flow**: `SprintReportPage → POST /api/jira/sprint-report-by-range` (no disk bundle).

---

### 3. Current sprint report (live JIRA)

```
GET /api/jira/current-sprint?teamId=<id>
Headers: x-jira-token, x-username
```

**Server flow**: `jira/index.js → sprintService.getCurrentSprint(teamId, boardId)` → calls JIRA Agile API `GET /rest/agile/1.0/board/{boardId}/sprint?state=active`  
**Returns**: current sprint metadata + in-flight issue counts (not resolved — open issues in this sprint)

---

## Velocity Type Definitions (enforced)

Per `sprint-velocity-types.mdc`:

| Type | Issue filter | Measure |
|------|-------------|---------|
| Dev | `not in (portfolio types, Test)` resolved in sprint window | issue count + SP |
| QA Verification | `Bug OR Improvement` transitioned to `Closed` in sprint window | `count × 0.33` adjusted count |
| QA Test Tasks | `issueType = Test` resolved in sprint window | issue count + SP |

These three are **always shown separately** — never merged.

---

## Sprint Boundary Calculation

Sprint boundaries are computed client-side in `SprintReportPage.js`:

```
S1 start: 2024-10-09 (Wed)
Anchor:   NDB-2.8 CC = 2024-10-30 (S1 end)
Duration: 3 weeks (21 days)
Start day: Wednesday
```

The fiscal quarter → date-range mapping also runs client-side via `getNutanixQuarterRange(fiscalYear, quarter)`.

---

## Data Shapes

### Bundle sprint record (pre-computed)
```json
{
  "sprintName": "S22",
  "startDate": "2026-04-23",
  "endDate": "2026-05-14",
  "dev": { "count": 47, "storyPoints": 89, "jql": "..." },
  "qaVerification": { "count": 18, "adjustedCount": 5.94, "jql": "..." },
  "qaTestTasks": { "count": 12, "storyPoints": 24, "jql": "..." },
  "resolutionBreakdown": {
    "Done": 47,
    "Unresolved": 5,
    "Duplicate or Not Reproducible": 3,
    "Others": 2
  }
}
```

---

## Caching

| Data | Cache | TTL |
|------|-------|-----|
| Team list | In-memory (from config file) | Process lifetime |
| Past sprint data | Bundle (`TeamDatasetContext`) | 24 h |
| Current sprint data | No cache — always live | — |
| Sprint boundary calc | Client-side derived | Session |

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| No active sprint on board | 404 | Show "No active sprint found for this team" |
| JIRA board not configured for team | 400 | Show "Board not configured — contact admin" |
| Bundle missing sprint for selected period | 200 (fallback) | Falls back to live JIRA; shows "Live data" badge |
