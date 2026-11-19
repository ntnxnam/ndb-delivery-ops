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

---

### GET /api/config/email-sender

**Purpose**: Return optional CC / To lists for the Email Sender page (`emailSenderCCConfig.json`). Client shows `defaultCC` as checkboxes (unchecked by default).

**Auth**: not required (read-only config)

**Request**
- Method + path: `GET /api/config/email-sender`
- Query params: none
- Body: none
- Required headers: none

**Server flow**
`config.js` → read `server/config/emailSenderCCConfig.json` (require cache cleared per request)

**Response shape**
```json
{
  "defaultCC": [
    "namratha.singh@nutanix.com",
    "bharath@nutanix.com",
    "ashish.kumar@nutanix.com",
    "ashish.mohindroo@nutanix.com",
    "karan.singh@nutanix.com"
  ],
  "defaultTO": [],
  "projectTeamFields": [
    { "id": "assignee", "label": "Assignee" },
    { "id": "customfield_10860", "label": "QA Contact" }
  ]
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 500 | Config file unreadable | Hide optional CC section / allow send without leadership CC |

**Caching**
No server TTL — file re-read each request. Client holds via `useEmailSenderCCConfig`.

---

### GET /api/config/releases/:version/release-preview

**Purpose**: Preview the 5-step release-finalize flow for a version — open-ticket count, JIRA `released` flags (synced + live), and whether a **repair path** is available when JIRA is already marked released but Lighthouse is not.

**Auth**: required — admin / team-admin only (same set as `mark-released`). Checked via `releaseFinalizeService.isAuthorized(username, teamId)`.

**Request**
- Method + path: `GET /api/config/releases/:version/release-preview?teamId=ndb`
- Path param: `version` (string, required) — e.g. `NDB-2.12`
- Query: `teamId` (string, optional but recommended) — team id for release-prefix resolution
- Required headers: `Authorization: Bearer <PAT>` or `x-jira-token`, `x-username`

**Server flow**
`config.js:1064` → `releaseFinalizeService.previewRelease` → reads `releaseVersionsEmailConfig.json` for `lighthouseReleased` / `jiraSyncedReleased` → live JIRA `getProjectVersions` for `jiraLiveReleased` → count open tickets via `fixVersion = "<v>" AND status NOT IN ("Done","Complete","Closed","Cancelled","Fixed")`.

**Response shape**
```json
{
  "version": "NDB-2.12",
  "teamId": "ndb",
  "projectKey": "ERA",
  "jql": "fixVersion = \"NDB-2.12\" AND status NOT IN (\"Done\", \"Complete\", \"Closed\", \"Cancelled\", \"Fixed\")",
  "openCount": 12,
  "sample": [{ "key": "ERA-123", "summary": "…", "status": "In Progress" }],
  "alreadyReleased": false,
  "jiraAlreadyReleased": true,
  "canRepair": true,
  "jiraVersions": [{ "projectKey": "ERA", "id": "12345", "name": "NDB-2.12", "released": true, "releaseDate": "2026-05-01" }],
  "releasedFlag": false,
  "emailTo": ["ndb-tpms@nutanix.com"]
}
```

**Repair signal**: `canRepair = jiraAlreadyReleased && !alreadyReleased`. When `true`, `POST mark-released` will skip the JIRA `PUT /rest/api/2/version/:id` and still complete Lighthouse + email + ticket-move.

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 403 | Caller not admin/team-admin | Hide preview button |
| 404 | Team not found for release | Check `teamId` / `releasePrefixes` |
| 500 | JIRA fetch failed | Retry; openCount may be 0 |

---

### POST /api/config/releases/:version/mark-released

**Purpose**: Mark a release as Released — 5-step holistic flow: JIRA version `released=true` (skipped on repair), Lighthouse `released` flag, release email, move open tickets to `master` fixVersion, JIRA comments with assignee/manager mentions.

**Auth**: required — admin / team-admin only. Body `teamId` + `note` (optional) are forwarded for audit.

**Request**
- Method + path: `POST /api/config/releases/:version/mark-released`
- Path param: `version` (string, required)
- Body: `teamId` (string, required), `note` (string, optional, ≤2000 chars, HTML-escaped)
- Required headers: `Authorization: Bearer <PAT>`, `x-username`

**Server flow**
`config.js:1075` → `releaseFinalizeService.markReleased` → validate `releaseGateDates[version]` exists and `existing.released !== true` (409 otherwise) → detect `jiraAlreadyReleased` (synced `_jira.released` or live `getProjectVersions`) → if not already released in JIRA: `PUT /rest/api/2/version/:id {released:true}` per projectKey → send email via `sendEmailDirect` → paginated `search` for open tickets → per-ticket `PUT fixVersions` (add `master` preserving other versions) + `POST comment` → persist `releaseVersionsEmailConfig.json` with `released:true`, `releasedAt`, `releasedBy`, `_jira.released:true` and `_jira.repairFromJira:true` when repair.

**Repair path** (`JIRA-already-released`): when `jiraAlreadyReleased` is true at entry, JIRA `PUT` is skipped — `jiraResults` contains `{ skipped:true, reason:"JIRA already marked released — lighthouse repair only" }` and `lighthouse.repair=true`. This prevents `400`/`409` from JIRA and still completes Lighthouse, email, and ticket migration.

**Response shape**
```json
{
  "success": true,
  "version": "NDB-2.12",
  "teamId": "ndb",
  "projectKey": "ERA",
  "jira": [{ "projectKey": "ERA", "id": "12345", "released": true }],
  "lighthouse": { "released": true, "releasedAt": "2026-11-20T10:00:00.000Z", "repair": false },
  "email": { "to": ["ndb-tpms@nutanix.com"], "messageId": "<…>" },
  "tickets": { "moved": 12, "failed": 0, "errors": [], "jql": "fixVersion = \"NDB-2.12\" AND status NOT IN (…)" },
  "jiraBaseUrl": "https://jira.nutanix.com"
}
```

Repair variant: `jira` is `[{ "skipped": true, "reason": "JIRA already marked released — lighthouse repair only" }]` and `lighthouse.repair: true`.

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 403 | Caller not admin/team-admin | Hide release button |
| 404 | Release not in `releaseGateDates` or team not found | Sync releases first / check team |
| 409 | Already `released` in Lighthouse | Show "Already released" |
| 500 | Disk write / JIRA / email failure (partial) | Inspect `jira`/`email`/`tickets` sub-results |

**Caching**
No cache — writes `releaseVersionsEmailConfig.json` immediately. Client should refetch release config after success.
