# API Contract — `/api/admin/*`

**Route file**: `server/routes/admin.js`
**Services**: `server/services/teamInspectService.js` (JIRA detection), `server/services/teamAdminService.js` (team registry CRUD + live test)
**Auth**: all team endpoints require `requireSuperAdmin` (checks `adminUsers` in `allowedUsers.json`) unless noted
**Mounted at**: `/api/admin`

> ⚠️ Breaking change in 2026-10: team onboarding now starts from the team's base filter.
> `POST /validate-jira-project`, `POST /validate-filters` and `POST /validate-board` were removed
> (use `POST /inspect-base-filter` and `POST /board-calendar`). Team configs no longer accept
> `projectType`, `versionPatterns`, `sprintBaseFilter` or `userConfig`; any of these sent to
> `POST`/`PUT /teams` are dropped and existing values are stripped on save. The sprint scope is
> derived from `baseFilter` (ORDER BY and a trailing `statusCategory != Done` removed).
> `allowedUsers.json` no longer has a per-team `teams` block. `test-team-config` returns
> `baseFilter` / `sprintScope` checks instead of `teamConfig` / `filterTests`.

---

### POST /api/admin/inspect-base-filter

**Purpose**: Detect every derivable team setting from a base filter — main JIRA project, its release versions, scrum board + sprint calendar, and FEAT components with their primary components — so the admin only types a name and a filter.

**Auth**: super-admin + JIRA token (`validateJiraTokenMiddleware`)

**Request**
- Method + path: `POST /api/admin/inspect-base-filter`
- Body params:
  - `baseFilter` (string, required) — team JQL, e.g. `filter=NDB-All-Base-Filter and statusCategory!=Done`
  - `name` (string, optional) — team name; used to prefer a board whose name matches
  - `boardId` (number, optional) — preferred board (kept if it belongs to the detected project)
  - `featureProjectKey` is no longer used. Component names come from the selected JIRA project.
- Required headers: `X-Username` (super admin), JIRA bearer token

**Server flow**
- `admin.js` → `teamInspectService.inspectBaseFilter`
- → JIRA `GET /rest/gadget/1.0/stats/generate?statType=project` for every project in the base filter (not a 500-issue sample). If that call fails, page `GET /rest/api/2/search` (`fields=project`) until the filter is exhausted. Main project = most frequent project key, ignoring the feature project (FEAT)
- → in parallel:
  - `JiraConnector.getProjectVersions(projectKey)` → total + unreleased version names
  - `GET /rest/agile/1.0/board?name=<team token>&type=scrum`, plus `projectKeyOrId=<key>`. Boards whose names match the team are the dropdown; the rest of the project list (often other teams on a shared project such as ERA) is returned as `otherBoards`. The requested `boardId`, if given, is read in parallel with the filter sample (otherwise the best name match). Sprint history is capped at 4 pages. A board that cannot be read returns `calendarError` and does not fail Detect.
  - `GET /rest/api/2/project/<selected project>/components` → every component name in that project. The form lists the project codes found in the base filter; choosing one reloads these names.
- Versions / board / feature failures are returned inline as `error` / `calendarError`; only a rejected base filter fails the request.

**Response shape**
```json
{
  "success": true,
  "baseFilter": "filter=NCN-All-Base-Filter and statusCategory!=Done",
  "sprintScope": "filter=NCN-All-Base-Filter",
  "issueCount": 1840,
  "sampledCount": 1840,
  "projects": [{ "key": "NCN", "name": "Nutanix Cloud Native", "count": 470, "share": 94 }],
  "projectKey": "NCN",
  "projectShare": 94,
  "versions": { "total": 60, "unreleasedCount": 4, "unreleased": ["NKP-2.16", "NKP-2.15.1"] },
  "board": {
    "boards": [{ "id": 4741, "name": "NCN Scrum" }],
    "boardId": 4741,
    "boardName": "NCN Scrum",
    "sprintCalendar": { "s1StartIso": "2020-02-20", "sprintDays": 14 },
    "inferredFrom": { "sprintCount": 120, "namedS1": false },
    "sprintCount": 120
  },
  "feature": {
    "projectKey": "NCN",
    "components": [{ "name": "NKP", "suggested": true }],
    "featureComponents": { "NKP": [] }
  }
}
```

> ⚠️ Breaking change in 2026-10-06: component names come from `GET /rest/api/2/project/{projectKey}/components` for the project selected from the base filter. They are no longer FEAT ticket components.

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | `baseFilter` missing, rejected by JIRA, or matches no tickets | Show `message`; let the admin fix the filter |
| 401 | JIRA token missing/invalid | Prompt for token |
| 403 | Not a super admin | Show Access Denied |
| 500 | Unexpected failure | Show error, allow retry |

**Caching**
No — live JIRA reads. Results are persisted only when the admin saves the team.

---

### POST /api/admin/project-scope

**Purpose**: Reload release versions and scrum boards when the admin picks a different JIRA project than the one Detect chose. Choosing DR loads DR boards, not the boards of the previously detected project.

**Auth**: super-admin + JIRA token

**Request**
- Method + path: `POST /api/admin/project-scope`
- Body params: `projectKey` (string, required — any JIRA project key, including one the admin typed that was not in the Detect list), `name` (string, optional — team name, used only to rank boards)
- Required headers: `X-Username`, JIRA bearer token

**Server flow**
`admin.js` → `teamInspectService.inspectProject` → `getProjectVersions(projectKey)`, `GET /rest/agile/1.0/board?projectKeyOrId=<key>&type=scrum`, and `GET /rest/api/2/project/<key>/components` → boards whose names match the project key are the dropdown; the rest are `otherBoards` → `collectSprintCalendarFromBoard` for the best match

**Response shape**
```json
{
  "success": true,
  "projectKey": "DR",
  "versions": { "total": 4, "unreleasedCount": 1, "unreleased": ["DR-1.0"] },
  "board": {
    "boards": [{ "id": 1592, "name": "DR-Core-WorkStream-Scrum-Board" }],
    "otherBoards": [],
    "matchedOn": "team",
    "boardId": 1592,
    "sprintCalendar": { "s1StartIso": "2024-10-23", "sprintDays": 14 }
  },
  "feature": { "projectKey": "DR", "components": [{ "name": "Cerebro", "suggested": true }], "featureComponents": { "Cerebro": [] } }
}
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Missing or invalid `projectKey` | Show the message |
| 401 / 403 | Token or super-admin check failed | Prompt for token / show Access Denied |

**Caching**
No.

---

### POST /api/admin/board-calendar

**Purpose**: Read the sprint calendar for a specific board — used when the admin picks a different board than the one Detect chose.

**Auth**: super-admin + JIRA token

**Request**
- Method + path: `POST /api/admin/board-calendar`
- Body params: `boardId` (number, required)
- Required headers: `X-Username`, JIRA bearer token

**Server flow**
`admin.js` → `teamInspectService.boardCalendar` → `collectSprintCalendarFromBoard` → `GET /rest/agile/1.0/board/{id}` + paginated `/sprint` → infer calendar (named S1, else earliest sprint; median length snapped to 7/14/21)

**Response shape**
```json
{ "success": true, "boardId": 2888, "boardName": "NDB Scrum", "sprintCalendar": { "s1StartIso": "2024-10-23", "sprintDays": 21 }, "inferredFrom": { "sprintCount": 40, "namedS1": true }, "sprintCount": 40 }
```
If the board cannot be read, or its sprints have no start dates, the response is still 200 with `sprintCalendar: null` and `calendarError`. The Team form then asks for an S1 start date and sprint length.

> ⚠️ Breaking change in 2026-10-05: a board with no dated sprints returns 200 and `calendarError` instead of 400, so Detect still returns the project, versions, and components.

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Missing/invalid `boardId` | Show the message |
| 401 / 403 | Token or super-admin check failed | Prompt for token / show Access Denied |

**Caching**
No.

---

### GET /api/admin/teams

**Purpose**: Return the team registry for the Team Management page.

**Auth**: super-admin

**Request**: none

**Server flow**
`admin.js` → `teamAdminService.listTeams` → reads `server/config/teamBoardConfig.json` + `kpiConfig.json` (no JIRA call)

**Response shape**
```json
{
  "success": true,
  "defaultTeamId": "ndb",
  "teams": [{
    "id": "ndb", "name": "NDB", "projectKey": "ERA", "boardId": 2888,
    "baseFilter": "filter=NDB-All-Base-Filter and statusCategory!=Done",
    "sprintCalendar": { "s1StartIso": "2024-10-23", "sprintDays": 21 },
    "featureComponents": { "NDB": ["NDB-Core"] },
    "sprintScope": "filter=NDB-All-Base-Filter",
    "kpiCount": 5
  }]
}
```
`sprintScope` and `kpiCount` are computed, not stored.

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 403 | Not a super admin | Show Access Denied |
| 500 | Config unreadable | Show error |

**Caching**
`teamBoardConfig.json` is mtime-cached in `teamConfig.js`; saves invalidate it.

---

### POST /api/admin/teams

**Purpose**: Add a team to the registry using the values confirmed after Detect.

**Auth**: super-admin

**Request**
- Body params:
  - `name` (string, required)
  - `baseFilter` (string, required)
  - `projectKey` (string, required) — uppercased; must match `^[A-Z][A-Z0-9_]+$`
  - `sprintCalendar` (object, required) — `{ s1StartIso: "YYYY-MM-DD", sprintDays: 1–90 }`
  - `id` (string, optional) — team code; defaults to a slug of `name` (lowercase letters, digits, dashes, max 40)
  - `boardId` (number, optional)
  - `featureComponents` (object, optional) — `{ "<FEAT component>": ["<primary component>", ...] }`
- Any other field (including the removed `projectType`, `versionPatterns`, `sprintBaseFilter`, `userConfig`) is ignored.

**Server flow**
`admin.js` → `teamAdminService.createTeam` → validate → append to `teamBoardConfig.json` (`saveTeamBoardConfig`) → add an empty KPI list for the team in `kpiConfig.json`

**Response shape**
```json
{ "success": true, "team": { "id": "data-lens", "name": "Data Lens", "projectKey": "DL", "baseFilter": "filter=DL", "sprintCalendar": { "s1StartIso": "2024-10-23", "sprintDays": 14 } }, "message": "Team \"Data Lens\" created successfully" }
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Missing name/baseFilter, invalid projectKey or team code, missing/invalid `sprintCalendar` | Show `message` |
| 403 | Not a super admin | Show Access Denied |
| 409 | Team code already exists | Ask for a different code |
| 429 | General rate limit (JSON body `{ success: false, error, message }`) | Wait and retry |
| 500 | File write failure | Show "Config save failed" |

**Caching**
Invalidates the `teamBoardConfig.json` mtime cache.

---

### PUT /api/admin/teams/:teamId

**Purpose**: Update an existing team; the team code cannot change.

**Auth**: super-admin

**Request**
- Path: `teamId` (string)
- Body: any of `name`, `baseFilter`, `projectKey`, `boardId`, `sprintCalendar`, `featureComponents` (same rules as POST). Omitted fields keep their current values; `id` in the body is ignored.

**Server flow**
`admin.js` → `teamAdminService.updateTeam` → merge onto the stored team → strip legacy fields → validate → `saveTeamBoardConfig`

**Response shape**
```json
{ "success": true, "team": { "id": "ncn", "name": "NCN" }, "message": "Team \"ncn\" updated successfully" }
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Merged team fails validation | Show `message` |
| 404 | `teamId` not found | Show "Team not found" |

**Caching**
Invalidates the `teamBoardConfig.json` mtime cache.

---

### POST /api/admin/test-team-config

**Purpose**: Live check that a saved team's project, versions, base filter and derived sprint scope all work with the caller's token.

**Auth**: super-admin + JIRA token

**Request**
- Body: `{ teamId: string }` (required)

**Server flow**
`admin.js` → `teamAdminService.testTeamConfig` → `GET /rest/api/2/project/{key}`, `getProjectVersions`, `searchCount(baseFilter)`, `searchCount(sprintScope)`

**Response shape**
```json
{
  "success": true,
  "teamId": "ndb",
  "teamName": "NDB",
  "results": {
    "projectAccess": { "valid": true, "projectName": "NDB Engineering" },
    "versionAccess": { "valid": true, "totalVersions": 12, "sampleVersions": ["NDB-2.12"] },
    "baseFilter": { "valid": true, "issueCount": 100 },
    "sprintScope": { "valid": true, "jql": "filter=NDB-All-Base-Filter", "issueCount": 340 }
  }
}
```
`success` is false when any check fails; failing checks carry `error`.

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | `teamId` missing | Fix the request |
| 404 | Team not found | Refresh the list |

**Caching**
No.

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
