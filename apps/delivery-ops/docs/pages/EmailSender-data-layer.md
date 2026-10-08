# Email Sender — Data Layer & Middleware Contract

**Route**: `/`  
**Server routes used**: `server/routes/email/`, `server/routes/jira/index.js`  
**Services used**: `server/services/emailService.js`, `server/services/confluenceService.js`

---

## API Calls (client → server)

### 1. Extract Confluence page content

```
GET /api/confluence/page?url=<encodedUrl>
Headers: x-jira-token, x-username
```

**Flow**: `client → GET /api/confluence/page → confluenceService.extractPage(url, token) → Confluence REST API`  
**Returns**: `{ title, bodyHtml, bodyText }`  
**Error handling**: 403 if user lacks Confluence access; 404 if page not found; 500 on network failure

---

### 2. Fetch release versions (populates release selector)

```
GET /api/jira/releases?productId=ndb
Headers: x-jira-token, x-username
```

**Flow**: `server/routes/jira/index.js → jiraConnector.getVersions(projectKey) → JIRA /rest/api/2/project/{key}/versions`  
**Returns**: `[{ id, name, released, releaseDate }]` sorted descending  
**Caching**: 5-minute in-memory cache per product

---

### 3. Fetch JIRA release summary (injects into email body)

```
GET /api/jira/release-summary?release=NDB-2.11&productId=ndb
Headers: x-jira-token, x-username
```

**Flow**: `server/routes/jira/index.js → releaseService.getSummary(release, productId) → jiraConnector.searchCount (multiple JQL calls)`  
**Returns**: `{ totalIssues, openBugs, p0p1Count, closedPct, gateStatus }`

---

### 4. Generate Fresh AI Summary (emailed)

```
POST /api/ai/exec-summary
Headers: Authorization (JIRA Bearer), x-username
Body: { item, breakdownData, release }
```

**Flow**: same as Project Status `ExecSummaryCell` → `naiService.generateExecSummary`.  
**Client**: `AiSummaryDraft.js` — draft owned by `EmailSender` (`aiSummaryDraft`); required before Send; passed as `aiSummary` on `/api/email/send` (no JIRA `PUT`).

---

### 5. Send email

```
POST /api/email/send
Headers: x-jira-token, x-username
Body: { additionalDetails, aiSummary, emailRecipients, emailSubject, jiraKey, jiraData, epics, issueBreakdown, sprintGanttData, … }
```

**HTML order**: Highlights and Lowlights → AI risk summary → Risk context (Indicator / Assessment / Path to Green) → Gates vs dates → JIRA ticket tables → epics → breakdown → Sprint timeline (`sprintGanttEmail.js`).
**Flow**: `server/routes/email/sendEmailHandler.js → sanitize.js (sanitize htmlBody) → emailService.send(options) → Nodemailer → mailrelay.dyn.nutanix.com:25`  
**Returns**: `{ success: true, messageId }` or `{ success: false, error: string }`  
**Side effect**: writes to email history log (see Email History data layer)  
**SMTP relay**: `mailrelay.dyn.nutanix.com:25`, no auth, plain TCP  
**Sanitisation**: `server/utils/sanitize.js` strips script tags, data: URIs, on* attributes before handing to Nodemailer

---

## Data Shapes

### Email send request body
```json
{
  "additionalDetails": "<h2>Highlights:</h2>…",
  "aiSummary": "[2026-10-08] YELLOW: …",
  "emailRecipients": "optional.extra@nutanix.com",
  "emailSubject": "Feature - … - Weekly Update - 08/Oct/2026",
  "jiraKey": "FEAT-16815",
  "jiraData": { "key": "FEAT-16815", "summary": "…" },
  "epics": [],
  "issueBreakdown": {},
  "sprintGanttData": { "sprintTickets": [], "timelineColumns": [], "sprintStats": {} },
  "isTest": true
}
```

### Email send response (success)
```json
{ "success": true, "messageId": "<abc123@mailrelay>" }
```

### Email send response (failure)
```json
{ "success": false, "error": "ECONNREFUSED — SMTP relay unavailable" }
```

---

## Caching

| Data | Cache strategy | TTL |
|------|---------------|-----|
| Confluence page content | No cache — always fresh | — |
| Release versions list | In-memory per product | 5 min |
| Release summary | No cache — called on demand | — |
| Email history entries | Appended to disk on send | Persistent |

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Confluence unreachable | 502 | Show "Confluence extraction failed" |
| JIRA token invalid | 401 | Show re-auth prompt |
| SMTP send failure | 503 | Show verbatim SMTP error |
| Body too large (>500 KB) | 413 | Show "Email body too large — reduce content" |

---

## Security Notes

- `server/utils/sanitize.js` MUST remain on the send path — never bypass
- HTML body is sanitized server-side even if client-side sanitization is applied
- JIRA token is never included in the email body
