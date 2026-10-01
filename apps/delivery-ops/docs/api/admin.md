# API Contract — `/api/admin/*`

**Route file**: `server/routes/admin.js`  
**Auth**: all endpoints require `requireSuperAdmin` middleware (checks `adminUsers` in `allowedUsers.json`) unless noted  
**Mounted at**: `/api/admin`

---

### POST /api/admin/validate-jira-project

**Purpose**: Validate that a JIRA project key exists and is accessible with the current token — used in team onboarding wizard.

**Auth**: super-admin

**Request**
- Body: `{ projectKey: string, jiraToken: string }`

**Server flow**  
`admin.js → jiraClient.getJira(token) → JiraConnector.get(project) + get(project versions)`

**Response**
```json
{
  "success": true,
  "project": { "key": "ERA", "name": "NDB Engineering", "projectTypeKey": "software", "lead": { "displayName": "Lead" } },
  "versions": { "total": 12, "open": 4, "openVersionNames": ["NDB-2.12"] }
}
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 404 | Project not found | Show "Project not found in JIRA" |
| 403 | Token lacks access | Show "Token does not have access to this project" |

---

### POST /api/admin/validate-filters

**Purpose**: Validate that each team JQL filter (or saved-filter name) is executable — used in team onboarding wizard.

**Auth**: super-admin

**Request**
- Body: `{ filters: [{ name: string, filterQuery?: string }], jiraToken: string }`
- `filterQuery` is JQL. If omitted, the server tests `filter=<name>`.

**Server flow**  
`admin.js → jiraClient.getJira(token) → JiraConnector.searchCount(jql)` for each filter

**Response**
```json
{ "success": true, "results": [{ "name": "baseFilter", "valid": true, "issueCount": 25 }] }
```

---

### POST /api/admin/validate-board

**Purpose**: Validate a JIRA Agile board and collect sprint calendar (`s1StartIso`, `sprintDays`) from its sprints — used by the team onboarding wizard **Detect from board** action.

**Auth**: super-admin

**Request**
- Method + path: `POST /api/admin/validate-board`
- Body params:
  - `boardId` (number, required) — JIRA Agile board ID
  - `jiraToken` (string, required) — caller PAT
- Required headers: super-admin username (`X-Username`)

**Server flow**
`admin.js` → `getJira(token)` → `collectSprintCalendarFromBoard` → `GET /rest/agile/1.0/board/{boardId}` → paginated `GET /rest/agile/1.0/board/{boardId}/sprint` → infer calendar (named S1, else earliest sprint; median duration snapped to 7/14/21)

**Response shape**
```json
{
  "success": true,
  "board": { "id": 2888, "name": "NDB Scrum", "type": "scrum" },
  "sprintCalendar": { "s1StartIso": "2024-10-23", "sprintDays": 21 },
  "inferredFrom": { "sprintCount": 40, "namedS1": true, "namedS1Name": "S1" },
  "sprintCount": 40
}
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Missing `boardId` / `jiraToken`, or board has no dated sprints | Show the message; allow manual S1 + length entry |
| 404 | Board not found | Show "Board not found — check ID" |
| 403 | Token lacks access | Show "Token does not have access to this board" |

**Caching**
No — live JIRA read. Inferred calendar is persisted only when the admin saves the team.

---

### GET /api/admin/teams

**Purpose**: Return the current team configuration list.

**Auth**: super-admin

**Request**: none

**Server flow**  
Reads `server/config/teamBoardConfig.json` — no JIRA call.

**Response**
```json
{ "success": true, "teams": [{ "id": "ndb", "name": "NDB", "boardId": 2888, "baseFilterId": "NDB-All-Base-Filter" }] }
```

---

### POST /api/admin/teams

**Purpose**: Add a new team to the configuration.

**Auth**: super-admin

**Request**
- Body: `{ id, name, projectKey, projectType, boardId, sprintCalendar: { s1StartIso, sprintDays }, baseFilter, sprintBaseFilter, versionPatterns?, userConfig? }`
- `sprintCalendar` is required (`s1StartIso` ISO date, `sprintDays` integer 1–90). Collect it with **Detect from board** (`POST /api/admin/validate-board`).

**Server flow**  
`loadTeamBoardConfig` → appends team including `sprintCalendar` → `saveTeamBoardConfig` (writes `teamBoardConfig.json`, invalidates mtime cache) → writes `allowedUsers.json` / `kpiConfig.json`. D43: the registry is multi-team; NDB is the default entry, not the only one.

**Response**
```json
{ "success": true, "team": { "id": "analytics", "sprintCalendar": { "s1StartIso": "2024-10-23", "sprintDays": 21 } }, "message": "Team \"Analytics Team\" created successfully" }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | Missing id/name/projectKey | Show required-field error |
| 400 | Missing or invalid `sprintCalendar` | Prompt to detect from the sprint board |
| 409 | Team ID already exists | Show "Team ID already in use" |
| 429 | General rate limit (per user + IP, 15 min window) | Show `message`; wait and retry. Body is JSON: `{ success: false, error, message }` |
| 500 | File write failure | Show "Config save failed — check server disk" |

---

### PUT /api/admin/teams/:teamId

**Purpose**: Update an existing team's configuration.

**Auth**: super-admin

**Request**
- Path: `teamId` (string)
- Body: partial team config. If `sprintCalendar` is sent it is validated. The saved team must end up with a valid `sprintCalendar` (existing or new).

**Server flow**  
Reads `teamBoardConfig.json` → merges changes for matching `teamId` (calendar required) → writes `teamBoardConfig.json` and optional `allowedUsers.json`.

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | Resulting config would have no valid sprintCalendar | Prompt to detect from the sprint board |
| 404 | teamId not found | Show "Team not found" |

---

### POST /api/admin/test-team-config

**Purpose**: Run a live smoke test against JIRA for a team config (board reachable + base filter valid).

**Auth**: super-admin + JIRA token required

**Request**
- Body: `{ teamId: string }`
- Headers: JIRA Bearer token (via `validateJiraTokenMiddleware`)

**Server flow**  
`admin.js → loadTeamBoardConfig → jiraClient.getJira(req.jiraToken)` → project access, version list (with `versionPatterns`), and `searchCount` on `baseFilter` / `sprintBaseFilter`.

**Response**
```json
{
  "success": true,
  "teamId": "ndb",
  "teamName": "NDB",
  "results": {
    "teamConfig": { "valid": true },
    "projectAccess": { "valid": true, "projectName": "NDB Engineering" },
    "versionAccess": { "valid": true, "totalVersions": 12, "sampleVersions": ["NDB-2.12"] },
    "filterTests": { "valid": true, "results": [{ "name": "baseFilter", "valid": true, "issueCount": 100 }] }
  }
}
```

---

### GET /api/admin/token-cache-stats

**Purpose**: Return stats about the server-side token validation cache (hit rate, size).

**Auth**: none (internal diagnostic — no sensitive data)

**Response**
```json
{ "size": 12, "hits": 450, "misses": 23, "hitRate": "95.1%" }
```

---

### POST /api/admin/clear-token-cache

**Purpose**: Clear the server-side token validation cache.

**Auth**: none (internal diagnostic)

**Response**
```json
{ "success": true, "cleared": 12 }
```

---

### GET /api/admin/jira-cache-stats

**Purpose**: Return stats about the JIRA in-memory response cache.

**Auth**: none (internal diagnostic)

**Response**
```json
{ "entries": 34, "hitRate": "82%", "oldestEntry": "2026-06-15T07:00:00Z" }
```

---

### POST /api/admin/clear-jira-cache

**Purpose**: Clear the JIRA in-memory response cache.

**Auth**: none (internal diagnostic)

**Response**
```json
{ "success": true, "cleared": 34 }
```
