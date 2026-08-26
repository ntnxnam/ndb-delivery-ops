# API Documentation — SoS Summary Endpoints

## POST /api/jira/sos-items

**Purpose**: Fetch Feature and Initiative tickets grouped by `fixVersion`. Live JIRA first; disk cache only as a 429 fallback.

**Auth**: Required (`validateJiraTokenMiddleware`)

**Request**

- Method: `POST`
- Path: `/api/jira/sos-items`
- Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `teamId` | string | yes | Team id to resolve `sosBaseFilter` or `baseFilter`. No silent NDB default. |
| `forceLive` | boolean | no | Ignored for fetch order (always live). Kept for client compatibility. |

**Server flow**

1. `sos.js` → `releaseItemsDataService.fetchSosItems()`
2. Live JIRA: `(${resolvedSosFilter}) AND issuetype in (Feature, Initiative) AND status != Cancelled`
3. On JIRA 429 with a warm cache → respond from cache (`source: "cache"`, `degraded: true`)

**Caching**: Disk only as 429 fallback.

**Response shape**

```json
{
  "success": true,
  "data": {
    "byVersion": {
      "NDB-2.12": [
        {
          "key": "FEAT-12345",
          "summary": "Storage write throughput redesign",
          "status": "In Progress",
          "issuetype": "Feature",
          "fixVersions": "NDB-2.12"
        }
      ]
    },
    "usedFallbackFilter": false,
    "source": "jira",
    "degraded": false,
    "lastSyncIso": "2026-08-26T15:00:00.000Z"
  }
}
```

**Error responses**

| HTTP code | When | Client should |
|---|---|---|
| 400 | teamId missing or team has no base filter | Show Admin / Fetch error |
| 401 | JIRA token missing or invalid | Redirect to login |
| 429 | JIRA rate-limited and cache empty | Wait 60–90s, then Retry |
| 503 | JIRA unreachable | Show inline retry |
| 500 | Unexpected server error | Show generic error toast |

---

## POST /api/jira/sos-items-history

**Purpose**: Fetch checkpoint-field date change history (Code Complete, Commit Gate, Promotion Gate) for all Feature and Initiative tickets in scope of the team's SoS filter. Used by the SoS Summary page to show struck-out old dates and delay deltas alongside the current gate dates.

**Auth**: Required (`validateJiraTokenMiddleware`)

**Request**

- Method: `POST`
- Path: `/api/jira/sos-items-history`
- Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `teamId` | string | no | Team id to resolve `sosBaseFilter`. Defaults to `"ndb"`. |

**Server flow**

1. Resolve `sosBaseFilter` → JQL (same as `/sos-items`)
2. Fetch only `key` for all matching Feature/Initiative tickets via `makeJiraSearchFetcher`
3. Call `fetchFieldHistoryForMultiple(itemKeys, jiraToken)` — fetches JIRA changelog for `customfield_11067`, `customfield_35863`, `customfield_35864`
4. Call `transformFieldHistoryToCheckpointHistory(rawHistory)` — normalises to `{ codeComplete, commitGate, promotionGate }` arrays per key
5. Respond with `{ success: true, data: { history, itemCount } }`

**Response shape**

```json
{
  "success": true,
  "data": {
    "itemCount": 42,
    "history": {
      "FEAT-12345": {
        "codeComplete": [
          { "date": "2026-08-01", "changedAt": "2026-07-15", "from": "2026-07-25" },
          { "date": "2026-09-01", "changedAt": "2026-08-01", "from": "2026-08-01" }
        ],
        "commitGate": [],
        "promotionGate": []
      }
    }
  }
}
```

**Error responses**

| HTTP code | When | Client should |
|---|---|---|
| 401 | JIRA token missing or invalid | Redirect to login |
| 500 | History fetch failed | Log warning; page renders without history overlay (dates show as plain) |

**Caching**: None. Fire-and-forget on the client; non-blocking — page renders from `/sos-items` before this completes.

---

## POST /api/email/send-sos

**Purpose**: Send an HTML snapshot of the already-loaded SoS page to engineering leadership via the existing SMTP relay. Does not fetch JIRA. Saves to email history on success.

**Auth**: Required (`validateJiraTokenMiddleware`) — token is used only to identify the sender.

**Request**

- Method: `POST`
- Path: `/api/email/send-sos`
- Body:

| Field | Type | Required | Description |
|---|---|---|---|
| `htmlBody` | string | yes (or `tableHTML`) | Full HTML snapshot built from in-memory SoS page state. |
| `subject` | string | yes | Email subject line |
| `releases` | string[] | yes | List of release names included in this SoS (e.g. `["NDB-2.12", "NDB-2.11"]`) |
| `recipients` | string | no | Extra To addresses (comma-separated). Merged with `emailConfig.defaultTo`. |
| `ccRecipients` | string | no | Extra CC addresses. Merged with `emailSenderCCConfig.defaultCC` + sender. |
| `tableHTML` | string | no | Legacy Feature/Initiative table HTML if `htmlBody` is omitted. |
| `gateSection` | string | no | Legacy gate dates HTML (used only with `tableHTML`) |
| `blockers` | string | no | Legacy blockers HTML |
| `risks` | string | no | Legacy risks HTML |
| `actionItems` | string | no | Legacy plain-text action items |
| `productId` | string | no | Product identifier. |
| `previewOnly` | boolean | no | If `true`, returns resolved To/CC/HTML without sending |

**Server flow**

1. `validateJiraTokenMiddleware` — validates JIRA token, extracts sender email (no JIRA search)
2. `emailLimiter` — rate limit: 20 sends / 15 minutes
3. Resolve To = `emailConfig.defaultTo` + optional `recipients` (`@nutanix.com` only)
4. Resolve CC = `emailSenderCCConfig.defaultCC` + sender + optional `ccRecipients`
5. Use client `htmlBody` (or wrap legacy `tableHTML`)
6. If `previewOnly`, return `{ to, cc, subject, htmlBody }` and stop
7. `emailService.sendEmailDirect(mailOptions)` — SMTP only
8. `saveEmailHistory()` — persists to history DB
9. Respond with `{ success: true, messageId, recipientCount, accepted, rejected }`

**Response shape**

```json
{
  "success": true,
  "messageId": "<unique-id@nutanix.com>",
  "recipientCount": 1,
  "accepted": ["ndb-projects-updates@nutanix.com"],
  "rejected": []
}
```

**Error responses**

| HTTP code | When | Client should |
|---|---|---|
| 400 | Missing `subject`, `htmlBody`/`tableHTML`, or `releases`; or no To list after defaults | Show field validation error |
| 401 | JIRA token missing or invalid | Redirect to login |
| 429 | Rate limit exceeded (20/15min) | Show "Too many emails" warning with retry time |
| 500 | SMTP relay unreachable or unexpected error | Show error toast with server message |

**Caching**: None.
