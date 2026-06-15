# Feature Dashboard — Data Layer & Middleware Contract

**Route**: `/feature-dashboard`  
**Server routes used**: `server/routes/jira/index.js`, `server/routes/feature.js`  
**Hooks**: `useFeatureDashboard` (`client/src/feature/hooks/`)  
**Services**: `client/src/feature/services/featureDashboardService.js`

---

## API Calls (client → server)

### 1. Fetch release versions (picker)

```
GET /api/jira/releases?productId=ndb
```

Same as Project Status — shared call, result cached in context.

---

### 2. Fetch feature payload

```
GET /api/feature/payload?featKey=ERA-XXXX&release=NDB-2.11&productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `feature.js → featurePayloadService → jiraConnector.search`

**JIRA queries run**:
1. Fetch the FEAT ticket itself: `key = {featKey}` (gets gate dates from customfields)
2. Fetch all children: `issueFunction in portfolioChildrenOf("key = {featKey}")` — all epics/stories/bugs
3. Fetch epic children: `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = {featKey}') AND type=Epic")`

**Fields fetched**: `summary, status, priority, issuetype, fixVersions, assignee, labels, duedate, customfield_11067, customfield_35863, customfield_35864, customfield_10360 (sprint), components, resolutiondate`

**Client-side derivation** (in `FeatureDashboardPage.js`):
- Gate open counts: filter by `ccDate ≤ today` + `status != Done`
- Bug phase distribution: scan `labels` array for `PHASE_LABEL_MAP` keys
- Reconciliation: issues where `fixVersions` does not include selected release
- Epic completion over time: group by `resolutiondate` week

---

### 3. JIRA URL construction for clickable counts

Handled client-side via `featureDashboardService.jiraSearchUrl(jiraBaseUrl, jql)`:

```javascript
// Example generated URLs
`${jiraBaseUrl}/issues/?jql=issueFunction in portfolioChildrenOf("key=${featKey}") AND status != Done AND due <= "${cgDate}"`
```

No additional server call — URLs are constructed locally and opened in new tab.

---

## Data Shapes

### Feature payload response
```json
{
  "success": true,
  "data": {
    "feature": {
      "key": "ERA-12345",
      "summary": "Storage Write Throughput",
      "ccDate": "2026-05-15",
      "cgDate": "2026-06-01",
      "pgDate": "2026-07-01"
    },
    "children": [
      {
        "key": "ERA-12400",
        "summary": "Write path optimization epic",
        "issueType": "Epic",
        "status": "In Progress",
        "fixVersions": ["NDB-2.11"],
        "labels": ["system-test"],
        "duedate": "2026-05-20"
      }
    ]
  }
}
```

---

## Client-Side Derivation Logic

All of the following run in the component/hook — no additional API calls:

| Derived metric | Logic |
|---------------|-------|
| CCM open count | Children where `issuetype in (Task, Unit Test)` AND `status not in Done` AND `ccDate <= today` |
| CG P0/P1 open count | Children where `issueType = Bug` AND `priority in (P0, P1)` AND `status != Done` |
| Bug phase counts | Scan each bug's `labels` for `regression`, `system-test`, `longevity`, `performance`, `stress`, `unit-test` |
| Reconciliation | Children where `fixVersions` does not include selected release |
| Epic completion trend | Closed epics grouped by ISO week of `resolutiondate` |

---

## Caching

| Data | Cache | TTL |
|------|-------|-----|
| Release versions | In-memory (shared context) | 5 min |
| Feature payload | `useState` in `useFeatureDashboard` | Session; cleared on featKey or release change |
| Reconciliation overrides | `localStorage` keyed by `featKey + release` | Persistent |

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Feature key not found | 404 | Show "Feature not found" inline error |
| JIRA token expired | 401 | Prompt re-auth |
| portfolioChildrenOf unsupported | 400 | Show "JIRA search plugin unavailable — contact admin" |
| Feature has >1,000 children | 200 (paginated) | Fetches all pages; shows "Loading X of Y" progress |
