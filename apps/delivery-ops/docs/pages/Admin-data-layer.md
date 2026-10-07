# Team Management — Data Layer & Middleware Contract

**Route**: `/team-management` (`/admin` redirects here)  
**Server routes used**: `server/routes/admin.js`, `server/routes/releaseDataset.js` (cache endpoints)  
**Config files modified**: `server/config/allowedUsers.json` (permission groups only), `server/config/teamBoardConfig.json`, `server/config/kpiConfig.json` (new team entry)

---

## API Calls (client → server)

### 1. Fetch current permissions / user list

```
GET /api/admin/users
Headers: x-jira-token, x-username
```

**Server flow**: `admin.js → reads allowedUsers.json` → returns structured permission map  
**Returns**:
```json
{
  "users": {
    "namratha.singh": ["allowedUsers", "kpiTabAllowedUsers", "adminUsers"],
    "john.doe": ["allowedUsers"]
  },
  "groups": {
    "allowedUsers": ["namratha.singh", "john.doe"],
    "kpiTabAllowedUsers": ["namratha.singh"],
    "adminUsers": ["namratha.singh"]
  }
}
```

---

### 2. Add user to permission group

```
POST /api/admin/users/add
Headers: x-jira-token, x-username
Body: { username, group }
```

**Server flow**: `admin.js → reads allowedUsers.json → adds user to specified group → writes file`  
**Returns**: `{ success: true, users: { ...updated } }`

---

### 3. Remove user from permission group

```
DELETE /api/admin/users/remove
Headers: x-jira-token, x-username
Body: { username, group }
```

**Server flow**: same as add but removes from array  
**Guard**: server prevents removing the last admin from `adminUsers`

---

Client hooks: `useTeamAdmin` (list / save / test) and `useTeamDetect` (detect / board calendar), both via `authenticatedGet` / `authenticatedPost` / `authenticatedPut` (request gate). Full contracts: `docs/api/admin.md`.

### 4. Team form — detect settings from the base filter

```
POST /api/admin/inspect-base-filter
Headers: Authorization Bearer, X-Username
Body: { baseFilter, name?, boardId? }
```

**Server flow**: `admin.js → teamInspectService.inspectBaseFilter` →
- `GET /rest/gadget/1.0/stats/generate?statType=project` (every project in the base filter; search pagination is the fallback) → main project by count
- `getProjectVersions(project)` → total + unreleased names
- `GET /rest/agile/1.0/board?projectKeyOrId=&type=scrum` → board pick → `collectSprintCalendarFromBoard`
- `GET /rest/api/2/project/{projectKey}/components` → component names for the selected project

**Returns**: `{ baseFilter, sprintScope, issueCount, projects, projectKey, versions, board, feature }`

Changing the JIRA project dropdown, or typing a project key, calls `POST /api/admin/project-scope` with `{ projectKey, name }` and replaces versions, boards, and components. A typed key does not have to be one of the projects Detect listed.

### 4b. Team form — calendar for a manually chosen board

```
POST /api/admin/board-calendar
Body: { boardId }
```

**Returns**: `{ boardId, boardName, sprintCalendar, inferredFrom, sprintCount }` (or `sprintCalendar: null` + `calendarError`)

---

### 5. Team form — save team

```
POST /api/admin/teams            (create)
PUT  /api/admin/teams/:teamId    (edit)
Headers: x-jira-token, x-username
Body: { id? (create only), name, baseFilter, projectKey, boardId, sprintCalendar: { s1StartIso, sprintDays }, featureComponents? }
```

**Server flow**: `admin.js → teamAdminService.createTeam / updateTeam` → validate → strip legacy fields → `saveTeamBoardConfig` (create also adds an empty KPI list in `kpiConfig.json`). `allowedUsers.json` is not written.
**Returns**: `{ success: true, team, message }`
**Side effect**: `saveTeamBoardConfig` invalidates the mtime cache so Project Status / version lists see the new team on the next request without a restart. The Admin UI also `upsertTeam`s / `updateTeam`s into `TeamContext`. The new team is **not** auto-applied; the admin clicks **Fetch**. D43: this file is a multi-team registry — Save must persist to disk, not only the browser dropdown.

### 5b. Test a saved team

```
POST /api/admin/test-team-config
Body: { teamId }
```

**Returns**: `results.{ projectAccess, versionAccess, baseFilter, sprintScope }`, each `{ valid, ... }`.

---

### 6. Fetch cache metadata

```
GET /api/release-dataset/sync-status?productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → reads shared/.cache/release-dataset/ndb/bundle.meta.json`  
**Returns**:
```json
{
  "lastSync": "2026-06-15T06:00:00Z",
  "releaseCount": 18,
  "bundleSizeBytes": 4200000,
  "productId": "ndb"
}
```

---

### 7. Clear cache

```
DELETE /api/release-dataset/cache?mode=bundle&productId=ndb
Headers: x-jira-token, x-username
```

`mode=bundle` — deletes only the bundle JSON (per_release + bundle.json)  
`mode=full` — deletes entire product cache directory

---

### 8. Trigger sync

```
POST /api/release-dataset/sync?productId=ndb
Headers: x-jira-token, x-username
```

Returns a Server-Sent Events stream with progress updates. Admin UI shows live progress log.

---

## Config Files

### `server/config/allowedUsers.json`
```json
{
  "allowedUsers": ["namratha.singh", "john.doe"],
  "kpiTabAllowedUsers": ["namratha.singh"],
  "adminUsers": ["namratha.singh"],
  "releaseSetupUsers": ["namratha.singh"]
}
```

### `server/config/teamBoardConfig.json`
One entry per product/team. Written by the team form. Used by `teamConfig.js` and `productService`.

```json
{
  "id": "ncn",
  "name": "Nutanix Cloud Native",
  "projectKey": "NCN",
  "boardId": 4741,
  "baseFilter": "filter=NCN-All-Base-Filter and statusCategory!=Done",
  "sprintCalendar": { "s1StartIso": "2020-02-20", "sprintDays": 14 },
  "featureComponents": { "NKP": ["NKP-Core"], "NDK": ["NDK"] }
}
```

The sprint scope is never stored: `sprintScopeFromBaseFilter(baseFilter)` (server `utils/teamScope.js`, shared `utils/teamScope.ts`) removes ORDER BY and a trailing `statusCategory != Done`.

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Non-admin calling admin endpoints | 403 | "Permission denied" |
| allowedUsers.json write fails | 500 | "Config save failed — manual edit required" |
| Removing last admin | 400 | "Cannot remove the last admin user" |
| Base filter invalid or matches no tickets | 400 | Team form shows the JIRA message |
| Board / versions / FEAT lookup fails during Detect | 200 (inline `error` / `calendarError`) | That section shows the error; a missing sprint calendar asks for S1 start date and sprint length |
| Team code already exists | 409 | Team form shows "Team already exists" |
| Cache clear while sync running | 409 | "Sync in progress — cannot clear cache now" |
| teamBoardConfig.json write fails | 500 | "Team config save failed" |
