# API Contract — `/api/config/*` (teams)

**Route file**: `server/routes/config.js`  
**Mounted at**: `/api/config`

This file documents the team-list and team-base-filter endpoints. Other `/api/config/*` handlers live in the same route file.

---

### GET /api/config/teams

**Purpose**: Return the configured teams (id, name, board, **baseFilter**, sosBaseFilter, sprintCalendar, featureComponents) so the shared `TeamContext` can select a team and every page can scope JIRA queries to that team's base query.

**Auth**: not required (read-only config)

**Request**
- Method + path: `GET /api/config/teams`
- Query params: none
- Body: none
- Required headers: none (optional `x-jira-token` / `x-username` ignored)

**Server flow**
`config.js` → `teamConfig.loadTeamBoardConfig()` → `server/config/teamBoardConfig.json` (mtime-cached)

**Response shape**
```json
{
  "sprintFieldId": "customfield_10360",
  "defaultTeamId": "ndb",
  "teams": [
    {
      "id": "ndb",
      "name": "NDB",
      "boardId": 2888,
      "projectKey": "ERA",
      "baseFilter": "filter=NDB-All-Base-Filter and statusCategory!=Done",
      "sosBaseFilter": "filter=ndb-all-sos"
    }
  ]
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 500 | Config file unreadable | Show Retry on the team selector |

**Caching**
Yes — in-process, keyed by file mtime. Invalidated on `POST /api/config/team-base-filter` and admin team save. Client fetches once per session via `TeamContext`.

---

### POST /api/config/team-base-filter

**Purpose**: Set the team's JQL `baseFilter`. KPI widgets (and any caller of `getTeamBaseFilter`) then run as `(baseFilter) AND (kpi.baseQuery)` for that team, without a server restart.

**Auth**: required — KPI tab access; write is admin-only for that team

**Request**
- Method + path: `POST /api/config/team-base-filter`
- Query params: none
- Body:
  - `teamId` (string, required) — case-insensitive team id
  - `baseFilter` (string, required) — JQL fragment, e.g. `filter=NDB-All-Base-Filter and statusCategory!=Done`
- Required headers: `x-username` (and JIRA token for the surrounding session)

**Server flow**
`config.js` → `checkKpiTabAuthorization` → `checkKpiAdminAuthorization` → `getTeamById` → write `team.baseFilter` → `saveTeamBoardConfig` (invalidates mtime cache)

**Response shape**
```json
{
  "success": true,
  "teams": [{ "id": "ndb", "baseFilter": "filter=NDB-All-Base-Filter and statusCategory!=Done" }],
  "team": { "id": "ndb", "baseFilter": "filter=NDB-All-Base-Filter and statusCategory!=Done" }
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | `teamId` missing | Prompt for team |
| 403 | Caller is not KPI admin for that team | Hide the editor |
| 404 | Unknown `teamId` | Refresh teams from GET /api/config/teams |
| 500 | Disk write failed | Show error, keep previous filter |

**Caching**
Write invalidates the in-process teamBoardConfig cache immediately. Client should `replaceTeams` with the returned `teams` array so other pages see the new base query without a refetch.

---

### GET /api/config/ndb-leader-org

**Purpose**: Return the maintainable NDB engineering leader org map used by the leader-grouped SoS review page. Client matches SoS item `assigneeManager` against leader `matchNames` and manager `displayName` / `matchNames` (including nested `reports`).

**Auth**: not required (read-only config)

**Request**
- Method + path: `GET /api/config/ndb-leader-org`
- Query params: none
- Body: none
- Required headers: none

**Server flow**
`config.js` → read `server/config/ndbLeaderOrgConfig.json` (require cache cleared per request)

**Response shape**
```json
{
  "root": "Bharat",
  "leaders": [
    {
      "id": "anil",
      "displayName": "Anil",
      "role": "dev_senior_director",
      "matchNames": ["Anil Madan", "Anil"],
      "managers": [
        { "displayName": "Pranay Ega", "role": "dev_director" },
        { "displayName": "Adil Gul Rather", "role": "manager", "note": "DBE" }
      ]
    }
  ]
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 500 | Config file unreadable | Show Retry / keep previous map if cached |

**Caching**
No server TTL — file re-read each request. Client may hold in component state for the page session.
