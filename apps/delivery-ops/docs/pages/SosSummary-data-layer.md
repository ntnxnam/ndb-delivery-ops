# SoS Summary Page — Data Layer

## API Endpoints Called (client → server)

### 1. `POST /api/jira/sos-items`

**Purpose**: Fetch all Feature and Initiative tickets for a single release from JIRA live (no cache).

**When called**: Once per active release on page load, and on per-release Refresh.

**Request**:
```json
{
  "fixVersion": "NDB-2.12",
  "teamId": "ndb"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "key": "FEAT-12345",
        "summary": "...",
        "status": "In Progress",
        "issuetype": "Feature",
        "assignee": "john.doe",
        "customfield_11067": "2026-09-01",
        "customfield_35863": "2026-10-15",
        "customfield_35864": "2026-11-01",
        "customfield_23560": { "value": "Yellow" },
        "customfield_23073": "...(status update text, passed to AI only)...",
        "customfield_45660": "2026-08-10",
        "customfield_38460": "[2026-08-10] YELLOW: ...",
        "labels": ["ndb-2.12-mustfix"],
        "fixVersions": "NDB-2.12"
      }
    ]
  }
}
```

**Server flow**:
`sos.js` → `teamConfig.getTeamSosBaseFilter(teamId)` → resolve filter name via JIRA Filter API → build JQL → `releaseItemsDataService.fetchReleaseItemsFromJira` (bypasses cache) → `releaseItemsDataService.processReleaseItems` → respond

**JQL built**:
```
filter=ndb-all-sos AND fixVersion = "NDB-2.12" AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC
```

**Caching**: None. Always live.

---

### 2. `POST /api/jira/issue-breakdown`

**Purpose**: Fetch child ticket breakdown (done / in-progress / remaining) per Feature/Initiative key.

**When called**: Bulk batch after `sos-items` resolves. Batched 5 keys at a time.

**Reused as-is** from Project Status — no changes.

**Request**:
```json
{ "jiraKeys": ["FEAT-12345", "FEAT-12346"] }
```

**Response**: see `taskBreakdownService.js` — `{ success, isBulk, results: { [key]: { breakdown, overallStats, outstandingUrl } } }`

---

### 3. `POST /api/ai/exec-summary`

**Purpose**: Generate AI executive summary for a single Feature/Initiative.

**When called**: On-demand per row (Generate button) or bulk auto-generate.

**Reused as-is** from Project Status — no changes.

**Request**:
```json
{
  "item": { ...fullJiraItem },
  "ganttConfig": { ...gateMarkerDates },
  "breakdownData": { ...taskBreakdown },
  "release": "NDB-2.12",
  "releaseContext": { "p0BugsCount": 2, "daysFromPG": 45 }
}
```

**Response**: `{ summary: "[2026-08-18] YELLOW: ...", phase, signals }`

---

### 4. `GET /api/config/kpi?teamId=ndb-all-sos`

**Purpose**: Load KPI list for the SoS team entry.

**When called**: Once on page mount.

**Reused as-is** — same config endpoint used by KPI page.

---

### 5. `POST /api/jira/release-kpi-results-batch`

**Purpose**: Run all KPI queries for a single release.

**When called**: Once per release when KPI subsection is first expanded (lazy).

**Reused as-is** from ReleaseVersionTab/KPI page.

**Request**: `{ teamId: "ndb-all-sos", releaseVersion: "NDB-2.12" }`

**Response**: `{ success: true, results: { [kpiId]: { total, issues?, combinedJql } } }`

**JQL pattern**: `filter=NDB-2.12-All AND (kpiJql) AND status != Closed`

---

### 6. `POST /api/ai/release-summary`

**Purpose**: Generate the release-level AI briefing (RAG verdict + top blockers + 7-day action list) for the compose panel.

**When called**: When user opens compose panel (lazy).

**Reused as-is** — same endpoint as Release Brief page.

**Request**: `{ version: "NDB-2.12" }`

**Response**: `{ summary: "## Release Health: RED\n...", intelligence: { p0BugsCount, mustFixTickets, bucketCounts } }`

---

### 7. `POST /api/email/send-sos`

**Purpose**: Send the composed SoS email via SMTP.

**When called**: User clicks Send in compose panel.

**Request**:
```json
{
  "recipients": "vp-eng@nutanix.com; dir-ndb@nutanix.com",
  "ccRecipients": "namratha.singh@nutanix.com",
  "subject": "NDB SoS Status — 2026-08-18",
  "releases": ["NDB-2.12", "NDB-2.11"],
  "gateSection": "<HTML string>",
  "blockers": "<HTML string>",
  "risks": "<HTML string>",
  "actionItems": "<plain text, newline-separated>",
  "tableHTML": "<HTML string of feature/initiative table>",
  "productId": "ndb"
}
```

**Response**: `{ success: true, messageId: "..." }`

**Server flow**:
`sendSos.js` → `validateJiraTokenMiddleware` → `emailLimiter` → `emailService.sendEmailDirect(mailOptions)` → `saveEmailHistory()` → respond

---

## Server Route → Service → JIRA Mapping

```
POST /api/jira/sos-items
  └── server/routes/jira/sos.js              (new, < 40 lines)
      └── teamConfig.getTeamSosBaseFilter()  (reads teamBoardConfig.json sosBaseFilter field)
      └── kpiService.resolveKpiJql()         (resolves filter= name to JQL via JIRA Filter API)
      └── releaseItemsDataService
          .fetchReleaseItemsFromJira()       (reused — paginated JIRA search, no cache)
          .processReleaseItems()             (reused — maps raw fields to item shape)

POST /api/email/send-sos
  └── server/routes/email/sendSos.js        (new, < 40 lines)
      └── emailService.sendEmailDirect()    (reused)
      └── saveEmailHistory()                (reused)
```

## Data Shapes

### Item shape (from sos-items)

Identical to the shape returned by `/api/jira/release-items`. All fields defined in `releaseItemsDataService.RELEASE_ITEMS_CONFIG.FIELDS_LIST` (24 fields).

Key fields used by the UI:
- `key`, `summary`, `status`, `issuetype`, `assignee`
- `customfield_11067` (CC Date), `customfield_35863` (CG Date), `customfield_35864` (PG Date)
- `customfield_23560` (Risk Indicator — rendered as RAG chip)
- `customfield_38460` (AI Executive Summary — displayed in ExecSummaryCell)
- `customfield_45660` (Status Update Date — staleness check in ExecSummaryCell)
- `customfield_23073` (Status Update text — **passed to AI only, never displayed**)
- `labels`, `fixVersions`

## Caching Strategy

| Data | Cache | TTL |
|---|---|---|
| sos-items (Features/Initiatives) | **None — always live JIRA** | — |
| Task breakdowns | In-memory Map in `useSosItems` hook | 5 min (same as Project Status) |
| KPI widget results | In-memory state in component | Until page refresh |
| AI exec summaries | None client-side (result written to JIRA `customfield_38460`) | — |
| Release AI briefing | None (generated fresh each compose panel open) | — |
| KPI config list | React state (loaded once per session) | — |

## Error Handling

| Error | Behaviour |
|---|---|
| JIRA unreachable for a release | Inline error in release section + Retry button |
| `sosBaseFilter` not configured | Warning banner; fallback to `sprintBaseFilter` |
| Task breakdown fetch fails for a key | `TaskBreakdownCell` shows "Breakdown unavailable" (existing behaviour) |
| KPI filter not found | Widget shows "Filter not found" — other widgets unaffected |
| AI service unavailable | ExecSummaryCell shows stale date warning (existing behaviour) |
| Email send fails | Toast error with server message; history not saved |
