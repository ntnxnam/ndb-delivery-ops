# Team Management — Data Layer & Middleware Contract

**Route**: `/team-management` (`/admin` redirects here)  
**Server routes used**: `server/routes/admin.js`, `server/routes/releaseDataset.js` (cache endpoints)  
**Config files modified**: `server/config/allowedUsers.json`, `server/config/teamBoardConfig.json`

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

### 4. Onboarding wizard — validate JIRA board + collect sprint calendar

```
POST /api/admin/validate-board
Headers: Authorization Bearer, X-Username
Body: { boardId, jiraToken }
```

**Server flow**: `admin.js → sprintCalendar.collectSprintCalendarFromBoard` → `GET /rest/agile/1.0/board/{boardId}` then paginated `GET /rest/agile/1.0/board/{boardId}/sprint` → infer `{ s1StartIso, sprintDays }`  
**Returns**: `{ success, board, sprintCalendar, inferredFrom, sprintCount }`

---

### 5. Onboarding wizard — save new team

```
POST /api/admin/teams
Headers: x-jira-token, x-username
Body: { id, name, projectKey, projectType, boardId, sprintCalendar: { s1StartIso, sprintDays }, baseFilter, sprintBaseFilter, versionPatterns?, userConfig? }
```

**Server flow**: `admin.js → loadTeamBoardConfig → appends new team → saveTeamBoardConfig → writes allowedUsers/KPI`  
**Returns**: `{ success: true, team: { id, name, ... }, message }`  
**Side effect**: `saveTeamBoardConfig` invalidates the mtime cache so Project Status / version lists see the new team on the next request without a restart. The Admin UI also `upsertTeam`s into `TeamContext`. The new team is **not** auto-applied; the admin clicks **Fetch**. D43: this file is a multi-team registry — Save must persist to disk, not only the browser dropdown.

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
One entry per product/team. Written by the onboarding wizard. Used by `teamConfig.js` and `productService`.

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Non-admin calling admin endpoints | 403 | "Permission denied" |
| allowedUsers.json write fails | 500 | "Config save failed — manual edit required" |
| Removing last admin | 400 | "Cannot remove the last admin user" |
| Board validation fails | 404 | Wizard shows "Board not found — check ID" |
| Cache clear while sync running | 409 | "Sync in progress — cannot clear cache now" |
| teamBoardConfig.json write fails | 500 | "Team config save failed" |
