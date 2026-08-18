# API Documentation — SoS Summary Endpoints

## POST /api/jira/sos-items

**Purpose**: Fetch all Feature and Initiative tickets for a single release directly from JIRA (bypasses the on-disk dataset cache). Used by the SoS Summary page to ensure leadership receives current data.

**Auth**: Required (`validateJiraTokenMiddleware`)

**Request**

- Method: `POST`
- Path: `/api/jira/sos-items`
- Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `fixVersion` | string | yes | JIRA release version name, e.g. `"NDB-2.12"` |
| `teamId` | string | no | Team id to resolve `sosBaseFilter` from `teamBoardConfig.json`. Defaults to `"ndb"`. |

**Server flow**

1. Read `sosBaseFilter` for `teamId` from `teamBoardConfig.json` via `teamConfig.getTeamSosBaseFilter()`
2. If `sosBaseFilter` is a `filter=<name>` reference, resolve the JIRA filter to its JQL via `kpiService.resolveKpiJql()`
3. Build final JQL: `(${resolvedSosFilter}) AND fixVersion = "${fixVersion}" AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`
4. Call `releaseItemsDataService.fetchReleaseItemsFromJira()` — paginated, max 500 results
5. Call `releaseItemsDataService.processReleaseItems()` — maps raw JIRA fields to the canonical item shape
6. Respond with `{ success: true, data: { items } }`

**Response shape**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "key": "FEAT-12345",
        "summary": "Storage write throughput redesign",
        "status": "In Progress",
        "issuetype": "Feature",
        "priority": "High",
        "assignee": "john.doe",
        "fixVersions": "NDB-2.12",
        "labels": ["ndb-2.12-mustfix"],
        "customfield_11067": "2026-09-01",
        "customfield_35863": "2026-10-15",
        "customfield_35864": "2026-11-01",
        "customfield_23560": { "value": "Yellow", "color": "#FF991F" },
        "customfield_38460": "[2026-08-10] YELLOW: ...",
        "customfield_45660": "2026-08-10",
        "customfield_23073": "(raw status update — AI input only, not for display)"
      }
    ]
  }
}
```

**Error responses**

| HTTP code | When | Client should |
|---|---|---|
| 400 | `fixVersion` is missing | Show validation error |
| 401 | JIRA token missing or invalid | Redirect to login |
| 503 | JIRA unreachable | Show inline retry |
| 500 | Unexpected server error | Show generic error toast |

**Caching**: None. Always fetches live from JIRA.

---

## POST /api/email/send-sos

**Purpose**: Send a composed SoS (Scrum of Scrums) briefing email to engineering leadership via the existing SMTP relay. Saves to email history on success.

**Auth**: Required (`validateJiraTokenMiddleware`)

**Request**

- Method: `POST`
- Path: `/api/email/send-sos`
- Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `recipients` | string | yes | Semicolon-separated email addresses. Addresses without `@` get `@nutanix.com` appended. |
| `ccRecipients` | string | no | Semicolon-separated CC addresses. Sender always added to CC. |
| `subject` | string | yes | Email subject line |
| `releases` | string[] | yes | List of release names included in this SoS (e.g. `["NDB-2.12", "NDB-2.11"]`) |
| `gateSection` | string | yes | HTML string for the gate dates section |
| `blockers` | string | no | HTML string for the blockers section |
| `risks` | string | no | HTML string for the risks section |
| `actionItems` | string | no | Plain text action items (newline-separated) |
| `tableHTML` | string | yes | HTML table of Features/Initiatives |
| `productId` | string | no | Product identifier. Defaults to `"ndb"`. |
| `previewOnly` | boolean | no | If `true`, returns rendered HTML without sending |

**Server flow**

1. `validateJiraTokenMiddleware` — validates JIRA token, extracts sender email
2. `emailLimiter` — rate limit: 20 sends / 15 minutes
3. Parse and validate recipients via `emailService.parseEmailRecipients()`
4. Build email HTML (gate section + blockers + risks + action items + table)
5. `emailService.sendEmailDirect(mailOptions)` — sends via `mailrelay.dyn.nutanix.com:25`
6. `saveEmailHistory()` — persists to history DB
7. Respond with `{ success: true, messageId }`

**Response shape**

```json
{
  "success": true,
  "messageId": "<unique-id@nutanix.com>",
  "recipientCount": 3
}
```

**Error responses**

| HTTP code | When | Client should |
|---|---|---|
| 400 | Missing `recipients`, `subject`, `tableHTML`, or `releases` | Show field validation error |
| 401 | JIRA token missing or invalid | Redirect to login |
| 429 | Rate limit exceeded (20/15min) | Show "Too many emails" warning with retry time |
| 500 | SMTP relay unreachable or unexpected error | Show error toast with server message |

**Caching**: None.
