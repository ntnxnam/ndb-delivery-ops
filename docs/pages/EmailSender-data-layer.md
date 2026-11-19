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
Headers: Authorization: Bearer <jira-pat>, x-username
Body: { additionalDetails, aiSummary, emailRecipients, selectedCCRecipients, emailSubject, jiraKey, jiraData, epics, workItems, issueBreakdown, sprintGanttData, … }
```

**CC**: Sender always CC'd. Project team from fetched `jiraData` (`emailSenderCCConfig.projectTeamFields` — assignee, QA Contact, PM Owner, watchers, etc.) is CC'd by default (@nutanix.com only). Leadership list from `GET /api/config/email-sender` (`defaultCC`) is shown as checkboxes (unchecked by default); only checked addresses are sent as `selectedCCRecipients` and intersected with the allowlist server-side.  
**HTML order**: Highlights and Lowlights → AI risk summary → Risk context (Indicator / Assessment / Path to Green) → Gates vs Actuals (one paired-bar table via `gateActualsUtils.buildGateVsActualRows`; CC Prescribed uses release `ccm*Gate` + ticket `customfield_11067`; CC Actual uses coding `created`→`resolved`) → JIRA ticket tables → epics → breakdown → Sprint timeline (`sprintGanttEmail.js`).
**Epics table**: Prefer Feature Dashboard `GET /api/feature/dashboard` `payload.canonical` (Features → child Epics via Parent Link), mapped to Status Sender row shape by `buildEpicsFromFeatureDashboard.js`. Columns always: Key, Issue Type, Summary, Status, Resolution, Assignee, QA Contact, Due Date, Fix Version. Fallback: `/api/jira/fetch-all-jira-tickets` `epics` when Feature Dashboard is unavailable.
**Actuals**: CC/CG/PG = latest `resolved` in pool even if some remain open; GA = only when all non-portfolio work is closed.
**Flow**: `sendEmail.js` (auth) → `sendEmailHandler` → `statusEmailSendService` → `statusEmailHtmlService` (`emailHtmlSanitize`) → `emailService.sendEmailDirect` → Nodemailer SMTP  
**Returns**: `{ success: true, messageId, recipients }` or `{ success: false, error: string }` (generic client error; no SMTP secrets)  
**Side effect**: writes to email history log (see Email History data layer)  
**SMTP**: `emailConfig.json` + `SMTP_*` env (STARTTLS service-account auth on corporate relay)  
**Sanitisation**: `server/utils/emailHtmlSanitize.js` allowlists tags/attrs, blocks `javascript:`/`data:`/`localhost` URLs; Quill path also sanitized in `emailFormatter.convertQuillHtmlToEmail`

---

### 6. Email Sender CC options

```
GET /api/config/email-sender
```

**Returns**: `{ defaultCC: string[], defaultTO: string[] }` from `server/config/emailSenderCCConfig.json`  
**Client**: `useEmailSenderCCConfig` → optional CC checkboxes on Email Sender

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
  "workItems": [{ "key": "ERA-1", "issueType": "Task", "resolved": "2026-06-01", "priority": "P2" }],
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
{ "success": false, "error": "Failed to send email. Please try again." }
```

---

## Risk trail disposition

Out of scope for EmailSender — same rationale as Feature Dashboard. See `FeatureDashboard-data-layer.md#risk-trail-disposition`.

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
| SMTP send failure | 500 | Show generic safe error (no SMTP secrets / stack) |
| Body too large (>500 KB) | 413 | Show "Email body too large — reduce content" |

---

## Security Notes

- `server/utils/emailHtmlSanitize.js` allowlists HTML and blocks `javascript:` / `data:` / `localhost` URLs before SMTP
- Quill/wiki content is also sanitized via `emailFormatter.convertQuillHtmlToEmail`
- JIRA token is never included in the email body
- Client auth header: `Authorization: Bearer <jira-pat>` (+ `x-username`)
