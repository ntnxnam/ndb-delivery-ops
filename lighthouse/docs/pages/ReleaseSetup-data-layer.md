# Release Setup — Data Layer & Middleware Contract

**Route**: `/release-setup`  
**Server routes used**: `server/routes/jira/index.js`, `server/routes/config.js`, `server/routes/dateMover.js`  
**Components**: `ReleaseSetup/index.js`, `ReleaseSetup/CreateRelease.js`, `ReleaseSetup/CleanupFilters.js`

---

## API Calls (client → server)

### 1. Create release version

```
POST /api/jira/version
Headers: x-jira-token, x-username
Body: { name, description, releaseDate, projectKey, productId }
```

**Server flow**: `jira/index.js → jiraConnector.createVersion(projectKey, payload)`  
**JIRA endpoint**: `POST /rest/api/2/version`  
**Returns**: `{ id, name, self }` (the created version object)  
**Side effect**: invalidates the in-memory release versions cache

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
