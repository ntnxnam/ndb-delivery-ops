# Component Report — Data Layer & Middleware Contract

**Route**: `/component-report`  
**Server routes used**: `server/routes/component.js`  
**Contexts consumed**: none (live component APIs)

---

## API Calls (client → server)

### 1. Fetch component list

```
GET /api/component/list
Headers: x-jira-token, x-username
```

**Server flow**: `component.js → jiraConnector.getComponents(projectKey)`  
**JIRA endpoint**: `GET /rest/api/2/project/{projectKey}/components`

---

### 2. Fetch component issues (per component, on-demand)

```
GET /api/component/issues?component=Storage&productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `component.js → componentReportService.getComponentIssues(component, productId)`  
**Service**: `server/services/componentReportService.js`

**JQL**:
```
project=ERA AND component = "{component}" AND status not in (Done,Closed,Cancelled) AND issuetype = Bug
```

**Fields**: `key, summary, status, priority, assignee, fixVersions, created, labels, components`

**Important**: query fetches ALL open bugs for the component regardless of release — release filtering is done client-side.

---

### 3. Fetch component health (live)

```
GET /api/component/health?component={name}
GET /api/component/data?component={name}
```

**Client flow**: `ComponentReport → live component APIs`

If bundle unavailable, the component issues response (step 2) is used to derive health client-side.

---

## Client-Side Release Filtering

After issues are fetched once, the release filter in the UI runs purely client-side:

```javascript
// ComponentReport.js
const isInSelected = (fixVersionsStr, selectedReleases) => {
  if (!fixVersionsStr || !selectedReleases || selectedReleases.size === 0) return false;
  return fixVersionsStr.split(',').some(v => selectedReleases.has(v.trim()));
};

const isCurrent = (fixVersionsStr) => {
  // Issues with any NDB-* fixVersion or "master"
  return fixVersionsStr.split(',').some(v =>
    /^NDB-\d+\.\d+/.test(v.trim()) || v.trim().toLowerCase() === 'master'
  );
};
```

This means **no re-fetch when release filter changes** — the full issue set stays in memory and the UI re-derives sections A/B/C.

---

## Section Derivation (client-side)

| Section | Logic |
|---------|-------|
| Section A (Current) | `isCurrent(issue.fixVersions) === true` — issues in NDB-* or master |
| Section B (Other) | `isInSelected(issue.fixVersions, selectedReleases) === true` AND not in Section A |
| Section C (Cleanup) | All remaining open issues not in A or B |

---

## Data Shapes

### Component issue (from API)
```json
{
  "key": "ERA-56789",
  "summary": "Storage write path OOM",
  "status": "In Progress",
  "priority": "Blocker - P0",
  "assignee": "john.doe",
  "fixVersions": "NDB-2.11,master",
  "created": "2026-04-10T09:00:00Z",
  "labels": ["storage-regression"],
  "components": "Storage",
  "age": 66
}
```

`age` is computed server-side as `Math.floor((now - created) / 86400000)`.

### Component health (from bundle)
```json
{
  "component": "Storage",
  "rag": "red",
  "p0Count": 2,
  "p1Count": 5,
  "openCount": 34,
  "closedPct": 71,
  "deferrals": 3
}
```

---

## Caching

| Data | Cache | TTL |
|------|-------|-----|
| Component list | Bundle / in-memory | 24 h |
| Component health | Bundle | 24 h |
| Component issues | Per-component in `useState` | Session; no re-fetch until page remount |
| Release filter | Client-side `useState` | Not persisted |

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Component issues fetch fails | 500 | Show per-component error card; other components unaffected |
| JIRA token expired | 401 | Redirect to login |
| Component not found in JIRA | 404 | Show "Component not found" on that card |
| Bundle health data stale | — | Falls back to live derivation from issues response |
