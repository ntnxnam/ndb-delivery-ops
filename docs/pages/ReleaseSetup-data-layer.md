# Release Setup — Data Layer & Middleware Contract

**Route**: `/release-setup`  
**Server routes used**: `server/routes/jira/setup.js` (`check-version-exists`, `create-version`, `check-filter-exists`, `create-filter`, `create-jch-ticket`, `rename-release-cascade`, `cleanup-duplicate-prefix-filters`)  
**Components**: `ReleaseSetup/index.js`, `ReleaseSetup/CreateRelease.js` (+ `JchFallbackBanner.js`), `ReleaseSetup/CleanupFilters.js`  
**Constants**: `client/src/utils/jqlTemplates.js` `COMPANION_RELEASE_PROJECTS = ['SDL','LBDR','TECHPUB','LEG','SR']` → `releaseProjectsForTeam()`; server mirror `server/utils/jqlTemplates.js` `RELEASE_PROJECTS`

---

## API Calls (client → server)

### 1. Check version exists (per-project, 5+team)

```
POST /api/jira/check-version-exists
Headers: x-jira-token, x-username
Body: { projectKey, versionName }
```

**Server flow**: `setup.js → releaseSetupService.checkVersionExists → GET /rest/api/2/project/{key}/versions`  
**Returns**: `{ exists, versionId, releaseDate, released }` — `CreateRelease` loops over `releaseProjectsForTeam(selectedTeam.projectKey)` = team project + SDL/LBDR/TECHPUB/LEG/SR

### 1b. Create release version (per-project)

```
POST /api/jira/create-version
Headers: x-jira-token, x-username
Body: { projectKey, versionName, releaseDate? }
```

**Server flow**: `setup.js → releaseSetupService.createVersion → POST /rest/api/2/version {name, project, released:false, releaseDate?}`  
**Returns**: `{ versionId, name, projectKey }`

### 1c. Create JCH ticket on create failure (fallback)

```
POST /api/jira/create-jch-ticket
Headers: x-jira-token, x-username
Body: { versionName, projectKey, errorDetail?, releaseDate? }
```

**Server flow**: `setup.js → releaseSetupService.createJchTicket → POST /rest/api/2/issue {project:{key:'JCH'}, summary:'Request: Create fixVersion {v} in {proj}', description:{version, project, releaseDate, truncated error}, issuetype:{name:'Task'}}`  
**Returns**: `{ key, id, url }` — client shows browse link via `JchFallbackBanner`

---

### 2. Rename release version

```
PUT /api/jira/version/:versionId
Headers: x-jira-token, x-username
Body: { name, description, releaseDate }
```

**Server flow**: `jira/index.js → jiraConnector.updateVersion(versionId, payload)`  
**JIRA endpoint**: `PUT /rest/api/2/version/{id}`

---

### 3. Cascade rename (preview)

```
GET /api/jira/versions/cascade-preview?oldName=NDB-2.11&newName=NDB-2.12&productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: fetches all versions matching `oldName.*` pattern, returns list of (id, currentName, proposedName) for each  
**Returns**: `{ affected: [{ id, currentName, proposedName }] }`  
**No JIRA writes** — preview only

---

### 4. Cascade rename (execute)

```
POST /api/jira/versions/cascade-rename
Headers: x-jira-token, x-username
Body: { renames: [{ id, newName }] }
```

**Server flow**: for each item in `renames`, calls `PUT /rest/api/2/version/{id}` sequentially (not parallel — to avoid JIRA rate limits); returns per-item status  
**Returns**: `{ results: [{ id, newName, success, error? }] }`

---

### 5. Cleanup filters — list stale

```
GET /api/config/stale-filters?productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `config.js → reads server/config/releaseVersionsEmailConfig.json + calls JIRA /rest/api/2/filter/{id}` for each configured filter; checks if referenced `fixVersion` names still exist in JIRA  
**Returns**: `{ staleFilters: [{ filterId, filterName, staleVersionRef }] }`

---

### 6. Cleanup filters — apply

```
POST /api/config/cleanup-filters
Headers: x-jira-token, x-username
Body: { filterIds: [123, 456] }
```

**Server flow**: for each filter ID, fetches its JQL, removes the stale `fixVersion` clause, PUTs the updated JQL back to JIRA  
**Returns**: `{ updated: [{ filterId, oldJql, newJql }] }`

---

## Data Shapes

### Create release request
```json
{
  "name": "NDB-2.12",
  "description": "NDB 2.12 major release",
  "releaseDate": "2026-12-15",
  "projectKey": "ERA",
  "productId": "ndb"
}
```

### Cascade preview response
```json
{
  "affected": [
    { "id": "10200", "currentName": "NDB-2.11",     "proposedName": "NDB-2.12" },
    { "id": "10201", "currentName": "NDB-2.11.1",   "proposedName": "NDB-2.12.1" },
    { "id": "10202", "currentName": "NDB-2.11.1.1", "proposedName": "NDB-2.12.1.1" }
  ]
}
```

---

## Config Files Modified by These Operations

| Operation | File modified |
|-----------|--------------|
| Rename | `server/config/releaseVersionsEmailConfig.json` — release key updated |
| Cascade rename | Same file — all affected release keys updated |
| Cleanup filters | `server/config/releaseVersionsEmailConfig.json` — stale filter refs removed |

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Version name conflict in JIRA | 400 | Show "Release already exists" inline |
| JIRA rate limit (429) | 429 | Server retries 3× with backoff; after 3 failures returns error |
| Cascade partially fails | 207 Multi-Status | Show per-companion result table; partial success state |
| Config file write fails (permissions) | 500 | Show "Config update failed — contact admin" |
