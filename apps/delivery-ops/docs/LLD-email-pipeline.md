---
report_type: LLD
module: Email Pipeline
version: "2.0"
generated: 2026-08-04
status: current
---

# Low-Level Design: Email Pipeline

---

## 1. Overview

Three email types are supported:

1. **Status Email** — Confluence content + optional JIRA data → SMTP
2. **Release Versions Email** — Full release table (frontend-generated HTML) + notes + legend + Gantt SVG → SMTP
3. **Generic Emailer** — JQL query result → user-selected columns → SMTP

All three use `mailrelay.dyn.nutanix.com:25` (no auth). SMTP is Nutanix-internal only — unavailable outside VPN.

---

## 2. Files

| File | Purpose |
|---|---|
| `server/routes/email/` | Route handlers per email type |
| `server/services/emailService.js` | Nodemailer transport + core send logic (**sacred — do not modify without approval**) |
| `server/utils/sanitize.js` | HTML sanitization before SMTP (**sacred**) |
| `client/src/components/ReleaseVersionTab.js` | Generates `tableHTML` for release email |

**Sacred path:** `emailService.js`, send handler, `sanitize.js` must not be changed without explicit user approval. Several past commits on `origin/main` are SMTP fixes; rebasing or squashing them out breaks email.

---

## 3. Nodemailer Configuration

```javascript
const transporter = nodemailer.createTransport({
  host: 'mailrelay.dyn.nutanix.com',
  port: 25,
  secure: false,
  auth: null,     // no auth on internal relay
  tls: { rejectUnauthorized: false },
});
```

**Note:** Available only from Nutanix internal network / VPN. Email sends fail from external networks with ECONNREFUSED.

---

## 4. Recipient Normalization

All three email types use the same normalization:

```javascript
function normalizeRecipients(input) {
  return input
    .split(';')
    .map(r => r.trim())
    .filter(Boolean)
    .map(r => r.includes('@') ? r : `${r}@nutanix.com`);
}
```

`namratha.singh@nutanix.com` is unconditionally added to CC on every outbound email. This cannot be removed at runtime.

---

## 5. Status Email (Email Sender Page)

### 5.1 Request Shape

```
POST /api/email/send
{
  "additionalDetails": "HTML string (from ReactQuill) — Highlights/Lowlights/Support",
  "aiSummary": "string — NAI risk brief (client-required before send)",
  "emailRecipients": "a@nutanix.com; b@nutanix.com",
  "emailSubject": "optional string",
  "jiraKey": "FEAT-16821 (optional)",
  "jiraData": { ...ticket fields },
  "epics": [ { key, summary, childEpics } ],
  "issueBreakdown": { total, breakdown, overallStats },
  "sprintGanttData": { sprintTickets, timelineColumns, sprintStats },
  "attachPdf": false,
  "isTest": false
}
```

### 5.2 Server Processing Pipeline

```
1. Validate: additionalDetails + required Highlights sections → 400 if missing
2. Normalize recipients via normalizeRecipients()
3. CC sender + emailSenderCCConfig.defaultCC (@nutanix.com only)
4. Format HTML body:
   a. Highlights and Lowlights (sanitized Quill HTML)
   b. AI risk summary (if aiSummary provided)
   c. Risk context + Gates vs dates (from jiraData)
   d. JIRA ticket card / epics / issue breakdown
   e. Sprint timeline (from sprintGanttData via sprintGanttEmail.js)
5. nodemailer.sendMail({
     from: SMTP service account,
     to: recipients[] (test mode: sender only),
     cc: …,
     subject: emailSubject (prefixed [TEST] in test mode),
     html: formattedHTML
   })
6. Write audit record to email history
7. Return { success: true, message: "Email sent successfully", recipients }
```

---

## 6. Release Versions Email

### 6.1 Frontend HTML Generation

The frontend generates the table HTML from live in-memory data (matching exactly what the user sees on screen). This is intentional: it avoids a second API call and ensures email content is identical to UI content.

```javascript
// client/src/components/ReleaseVersionTab.js
function generateTableHTMLForEmail(items, checkpointHistory, columnsConfig) {
  // Only include columns with includeInEmail: true
  const emailColumns = columnsConfig.columnOrder.filter(
    col => columnsConfig.columns[col].includeInEmail
  );

  const rows = items.map(item =>
    emailColumns.map(colKey => renderCellForEmail(colKey, item, checkpointHistory[item.key]))
  );

  return buildHTMLTable(emailColumns, rows);
}
```

Column rendering in email mirrors UI rendering exactly: same date formatting, same color logic, same extension label highlighting.

### 6.2 Server Wrapping

```
POST /api/email/send-release-versions
{
  "tableHTML": "<table>...</table>",
  "selectedVersion": "NDB-2.12",
  "highlights": "HTML",
  "lowlights": "HTML",
  "callToAction": "HTML",
  "emailRecipients": "...",
  "ganttSvg": "<svg>...</svg>"
}

Server assembles final HTML (in order):
  1. Version header: "Release Status: NDB-2.12 — {date}"
  2. Highlights section (if provided)
  3. Lowlights section (if provided)
  4. Call to Action section (if provided)
  5. tableHTML (verbatim from frontend)
  6. Gantt SVG (inline)
  7. Legend section (always included)
```

### 6.3 Legend Content (Always Included)

```
Color coding:
  Green date  = on time (current value)
  Red date    = delayed (current value)
  Strikethrough = historical value
  Colored background = Code Complete extension received

Delay format:
  "N days late"      when delay ≤ 3 days
  "N.5 weeks late"   when delay > 3 days
```

---

## 7. Generic Emailer

```
POST /api/email/send-generic-reminder
{
  "jql": "project = ERA AND fixVersion = NDB-2.12 AND ...",
  "columns": ["key", "summary", "status", "assignee"],
  "emailRecipients": "...",
  "subject": "Reminder: open items for NDB-2.12",
  "message": "optional preamble paragraph"
}

1. Execute JQL via jiraConnector.searchAll() (paginated)
2. Extract only requested columns per ticket
3. Build HTML table (key columns are clickable → correct JIRA URL)
4. Assemble email: preamble + table
5. Send via SMTP
6. Write audit record
```

Permission required: `email_send_generic` (Super Admin only).

---

## 8. Email History

- Every outbound email writes an audit record: `{ id, timestamp, type, recipients, cc, subject, username, status }`
- Records are appended to `server/data/emailHistory.json`
- `GET /api/email/history` returns sorted records (newest first), capped at 100
- Email History page (`/email-history`) displays the log with basic filtering

---

## 9. Error Handling

| Scenario | Behavior |
|---|---|
| SMTP connection refused (off-VPN) | 503 returned; user sees "Email send failed: connection refused" |
| SMTP timeout | 503 returned; form stays populated (user can retry) |
| Invalid recipient format | 400 returned before any SMTP attempt |
| Missing required field (`executiveSummary`) | 400 with field name in error |
| Rate limit exceeded (>20 sends / 15 min) | 429; user must wait |

Email sends never fail silently. Every failure surfaces a user-visible error message.
