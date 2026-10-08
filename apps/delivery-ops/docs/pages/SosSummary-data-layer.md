# SoS Summary Page — Data Layer

## API Endpoints Called (client → server)

### 1. `POST /api/jira/sos-items`

**Purpose**: Fetch Feature and Initiative tickets grouped by release. Live JIRA first; disk only as 429 fallback.

**When called**: Once on page load, and on Refresh All.

**Request**:
```json
{
  "teamId": "<selected team id>",
  "forceLive": false
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
`sos.js` → `releaseItemsDataService.fetchSosItems()` → live JIRA first → on 429 fall back to cache

**Caching**: Disk only as 429 fallback.

---

### 1b. `POST /api/jira/sos-items-history`

**Purpose**: Fetch CC / CG / PG changelog history so `formatDateWithHistory` can show struck-out previous dates and net delay.

**When called**: After items are on screen (cache or live). Skipped only when `degraded` is true (JIRA already rate-limited).

**Request**: `{ "teamId": "ndb" }`

**Response**: `{ success: true, data: { history: { [key]: { codeComplete, commitGate, promotionGate } } } }`

**Server flow**: `sos.js` → SoS filter keys → `fetchFieldHistoryForMultiple` → `transformFieldHistoryToCheckpointHistory`

---

### 1c. `GET /api/component/list?productId=<teamId>`

**Purpose**: Populate the Component filter with components registered on the selected team's JIRA project.

**When called**: On page load and when the team picker changes.

**Request**: query `productId` = selected team id (`ncn`, `ndb`, …).

**Server flow**: `component.js` → `getTeamById(productId).projectKey` → `GET /rest/api/2/project/{projectKey}/components`

**Response**: `{ components: [{ id, name }], count, projectKey, fetchedAt }`

**Caching**: Session, 1 hour, keyed by `projectKey`.

---

### 2. `POST /api/jira/issue-breakdown`

**Purpose**: Fetch child ticket breakdown (done / in-progress / remaining) per Feature/Initiative key.

**When called**: After a live `sos-items` fetch only (Refresh All). Skipped on cache load so a 429 recovery does not immediately re-trip JIRA.

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

**Purpose**: Send an HTML snapshot of the already-loaded SoS page via SMTP. Does not call JIRA.

**When called**: User clicks Email SoS (preview with `previewOnly: true`, then Send).

**Request**:
```json
{
  "htmlBody": "<!DOCTYPE html>...",
  "subject": "SoS Summary — 2026-08-25",
  "releases": ["NDB-2.12", "NDB-2.11"],
  "previewOnly": false
}
```

`recipients` / `ccRecipients` are optional. When omitted, the server applies:
- **To:** `sosEmailConfig.defaultTo` + dialog To field (`@nutanix.com` only)
- **CC:** `sosEmailConfig.defaultCC` + dialog CC field + sender (`@nutanix.com` only)

**Response**: `{ success: true, messageId: "...", recipientCount, accepted, rejected }`

**Server flow**:
`sendSos.js` → `validateJiraTokenMiddleware` (auth only, no JIRA search) → `emailLimiter` → merge default To/CC → `emailService.sendEmailDirect(mailOptions)` → `saveEmailHistory()` → respond

---

## Server Route → Service → JIRA Mapping

```
POST /api/jira/sos-items
  └── server/routes/jira/sos.js
      └── releaseItemsDataService.fetchSosItems()
          ├── loadSosItemsFromCache()        (default — no JIRA)
          └── fetchSosItemsFromJira()        (Refresh All / cache miss; 429 → cache)

POST /api/email/send-sos
  └── server/routes/email/sendSos.js
      └── emailConfig.defaultTo + emailSenderCCConfig.defaultCC
      └── emailService.sendEmailDirect()    (SMTP only — no JIRA)
      └── saveEmailHistory()
```

## Data Shapes

### Item shape (from sos-items)

Identical to the shape returned by `/api/jira/release-items`. All fields defined in `releaseItemsDataService.RELEASE_ITEMS_CONFIG.FIELDS_LIST` (25 fields).

Key fields used by the UI:
- `key`, `summary`, `status`, `issuetype`, `assignee`
- `customfield_11065` (Test Lead), `customfield_10860` (QA Contact — shown when Test Lead is empty or a different person)
- `customfield_11260` (PM Owner), `customfield_27764` (TPM / Program Mgr)
- `assigneeManager` (display name) / `assigneeManagerEmail` — from `customfield_19262`; powers the client-side **Assignee Mgr** filter and the release-versions email manager CC
- `customfield_11067` (CC Date), `customfield_35863` (CG Date), `customfield_35864` (PG Date)
- `customfield_23560` (Risk Indicator — RAG chip + strikethrough history trail from `sos-items-history`)
- `customfield_47780` (Risk Assessment), `customfield_55664` (Path to Green) — both rendered under the Risk Indicator in the State column
- `customfield_55662` (Link to CG checklist), `customfield_55663` (Link to PG checklist)
- `customfield_38460` (AI Executive Summary — displayed in ExecSummaryCell)
- `customfield_45660` (Status Update Date — staleness check in ExecSummaryCell)
- `customfield_23073` (Status Update text — **passed to AI only, never displayed**)
- `labels`, `fixVersions`

### Client-side filtering

The page renders the shared `ReleaseVersionFilterBar` (`showSection={false}`) above the release sections. Filters (Risk, Status, Assignee, Assignee Mgr, Status-update staleness) are applied purely client-side via `applyFilters` to a copy of `byVersion`; versions with no surviving items are hidden. Batch AI summary, email snapshot, history, and breakdown passes still operate on the full unfiltered set.

## Caching Strategy

The page is routed through the shared `Layout` / `ReleaseDataProvider`. Feature/Initiative rows come from `sos-items`, which hits JIRA first.

| Data | Cache | TTL |
|---|---|---|
| sos-items (Features/Initiatives) | Live JIRA; disk on 429 | 5 min client / until Refresh |
| sos-items-history (CC/CG/PG hops) | In-memory in `useSosHistory`; fetched after items load unless degraded | Until page refresh |
| Task breakdowns | In-memory Map in `useSosItems` hook | 5 min (same as Project Status) |
| KPI widget results | In-memory state in component | Until page refresh |
| AI exec summaries | None client-side (result written to JIRA `customfield_38460`) | — |
| Release AI briefing | None (generated fresh each compose panel open) | — |
| KPI config list | React state (loaded once per session) | — |

## Error Handling

| Error | Behaviour |
|---|---|
| JIRA 429 with warm cache | Page renders from cache + banner to wait, then Refresh All |
| JIRA 429 with empty cache | Friendly wait-60–90s message + Retry |
| JIRA unreachable for a release | Inline error in release section + Retry button |
| `sosBaseFilter` not configured | Warning banner; fallback to `baseFilter` |
| Task breakdown fetch fails for a key | `TaskBreakdownCell` shows "Breakdown unavailable" (existing behaviour) |
| KPI filter not found | Widget shows "Filter not found" — other widgets unaffected |
| AI service unavailable | ExecSummaryCell shows stale date warning (existing behaviour) |
| Email send fails | Toast error with server message; history not saved |
