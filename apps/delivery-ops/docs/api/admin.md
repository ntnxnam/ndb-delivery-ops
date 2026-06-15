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
`admin.js → jiraConnector.getProject(projectKey)`

**Response**
```json
{ "success": true, "project": { "key": "ERA", "name": "NDB Engineering", "id": "10001" } }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 404 | Project not found | Show "Project not found in JIRA" |
| 403 | Token lacks access | Show "Token does not have access to this project" |

---

### POST /api/admin/validate-filters

**Purpose**: Validate that a list of JIRA saved filter IDs exist and are accessible — used in team onboarding wizard.

**Auth**: super-admin

**Request**
- Body: `{ filterIds: number[], jiraToken: string }`

**Server flow**  
`admin.js → jiraConnector.getFilter(id)` for each filter ID

**Response**
```json
{ "success": true, "results": [{ "id": 175938, "name": "NCM-All-Base-Filter", "valid": true }] }
```

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
- Body: `{ id: string, name: string, displayName: string, boardId: number, baseFilterId: string|number, kpiConfig?: object }`

**Server flow**  
Reads `teamBoardConfig.json` → appends → writes file → invalidates in-memory config cache.

**Response**
```json
{ "success": true, "teams": [ /* updated list */ ] }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | Team ID already exists | Show "Team ID already in use" |
| 500 | File write failure | Show "Config save failed — check server disk" |

---

### PUT /api/admin/teams/:teamId

**Purpose**: Update an existing team's configuration.

**Auth**: super-admin

**Request**
- Path: `teamId` (string)
- Body: partial team config (any subset of fields)

**Server flow**  
Reads `teamBoardConfig.json` → merges changes for matching `teamId` → writes.

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 404 | teamId not found | Show "Team not found" |

---

### POST /api/admin/test-team-config

**Purpose**: Run a live smoke test against JIRA for a team config (board reachable + base filter valid).

**Auth**: super-admin + JIRA token required

**Request**
- Body: `{ teamId: string, boardId: number, baseFilterId: string|number, jiraToken: string, username: string }`

**Server flow**  
Calls JIRA board API + runs a test JQL using the base filter. Returns pass/fail per check.

**Response**
```json
{ "success": true, "checks": { "board": true, "baseFilter": true, "jqlTest": true } }
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
