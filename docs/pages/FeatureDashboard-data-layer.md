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

### 2. Fetch release features (picker + overall Gantt)

```
GET /api/feature/list?release=NDB-2.11
Headers: x-jira-token, x-username
```

**Server flow**: `feature.js` → `JiraConnector.searchAll` + `parseReleaseGateTimeline`

**JIRA query**: `fixVersion = "{release}" AND issuetype in (Feature, Initiative) AND status not in (Cancelled, Backlog) ORDER BY summary ASC`

**Fields fetched**: `summary, issuetype, status, assignee, codeComplete, commitGate, promotionGate, riskIndicator`

The selected-feature dashboard header also fetches `riskAssessment` (`customfield_47780`), `pathToGreen` (`customfield_55664`), `cgChecklistLink` (`customfield_55662`), and `pgChecklistLink` (`customfield_55663`).

**Response extras used by the overall Gantt**:
- `features[].ccDate` / `cgDate` / `pgDate` — feature gate dates
- `features[].risk` — Risk Indicator (`Green` / `Yellow` / `Red`)
- `gates` — release EC / CC / CG / PG / GA ISO dates for vertical rulers

Bar colour is derived client-side from `risk`. Bar span is EC → latest of CC/CG/PG (or GA if the feature is Done).

---

### 3. Fetch feature payload

```
GET /api/feature/payload?featKey=ERA-XXXX&release=NDB-2.11&productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `feature.js → featurePayloadService → jiraConnector.search`

**JIRA queries run**:
1. Fetch the FEAT ticket itself: `key = {featKey}` (gets gate dates from customfields)
2. Fetch all children: `issueFunction in portfolioChildrenOf("key = {featKey}")` — all epics/stories/bugs
3. Fetch epic children: `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = {featKey}') AND type=Epic")`

**Fields fetched** (dashboard canonical via `buildDashboardFields`): includes `summary, issuetype, status, resolution, assignee, priority, created, updated, resolutiondate, duedate, labels, fixVersions, parentLink, epicLink, qaContact`, plus risk/gate/status-update custom fields. Status Sender reuses `payload.canonical` epics with Status Sender column formatting.

**Server-side timing (Spec A)** — on `GET /api/feature/dashboard`:
- Load JIRA status → category map (`GET /rest/api/2/status`)
- For each non-portfolio work item, `getIssue(key, { expand: 'changelog' })` (concurrency 3)
- `timing.realStart` = earliest transition into statusCategory In Progress; `timing.plannedStart` = release EC
- `hygiene.wrongFixVersionCount` = work items whose `fixVersions` omit the selected release (soft; clickable JQL)

**Client-side derivation** (in `FeatureDashboardPage.js`):
- Gate open counts: filter by `ccDate ≤ today` + `status != Done`
- Bug phase distribution: scan `labels` array for `PHASE_LABEL_MAP` keys
- Reconciliation: issues where `fixVersions` does not include selected release
- Epic completion over time: group by `resolutiondate` week
- Timing strip: planned EC vs real start + quiet hygiene caption

---

### 4. JIRA URL construction for clickable counts

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
| Overall Gantt bar | Span EC → latest of feature `ccDate` / `cgDate` / `pgDate` (GA if status is Done); colour from `risk` |

---

## Caching

| Data | Cache | TTL |
|------|-------|-----|
| Release versions | In-memory (shared context) | 5 min |
| Feature list + gates | `useState` in `useFeatureDashboard` | Session; cleared on release change |
| Feature payload | `useState` in `useFeatureDashboard` | Session; cleared on featKey or release change |
| Reconciliation overrides | `localStorage` keyed by `featKey + release` | Persistent |

---

## Risk trail disposition

Feature Dashboard and EmailSender intentionally do not render the risk movement trail. Feature Dashboard's risk is a derived roll-up for Gantt colouring, not a per-ticket history view; EmailSender's AI-summary path owns risk context via `riskAssessment`/`pathToGreen`. Trail remains in scope only for Project Status and SoS surfaces (table + email snapshot). No wiring planned — revisit if per-ticket history is needed on those pages.

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Feature key not found | 404 | Show "Feature not found" inline error |
| JIRA token expired | 401 | Prompt re-auth |
| portfolioChildrenOf unsupported | 400 | Show "JIRA search plugin unavailable — contact admin" |
| Feature has >1,000 children | 200 (paginated) | Fetches all pages; shows "Loading X of Y" progress |
