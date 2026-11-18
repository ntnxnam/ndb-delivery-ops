# Email API

Route file: `server/routes/email/` (composed via `index.js`).

---

### POST /api/email/send

**Purpose**: Build a sanitized weekly status email from Highlights/Lowlights + pulled JIRA data and send via corporate SMTP.

**Auth**: required — `emailLimiter` + `validateJiraTokenMiddleware` (valid JIRA Bearer token; all authenticated users per Email Sender AC).

**Request**
- Method + path: `POST /api/email/send`
- Headers: `Authorization: Bearer <jira-pat>`, `x-username`
- Body params:
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `additionalDetails` | string (HTML) | yes | Highlights / Lowlights / Support sections (Quill HTML) |
  | `aiSummary` | string | yes (product) | AI risk brief text included in body |
  | `emailRecipients` | string | no | Extra To recipients (`user@nutanix.com` or username; `;`-separated) |
  | `selectedCCRecipients` | string[] | no | Opt-in leadership CC (intersected with allowlist) |
  | `emailSubject` | string | no | Subject; default includes weekly-update date |
  | `jiraKey` | string | yes (product) | Feature / Initiative key |
  | `jiraData` | object | no | Fetched ticket fields for tables |
  | `epics` | array | no | Epic hierarchy rows |
  | `workItems` | array | no | For Gates vs Actuals |
  | `issueBreakdown` | object | no | Issue-type × status table |
  | `sprintGanttData` | object | no | Sprint timeline section |
  | `attachPdf` | boolean | no | Reserved (not implemented) |
  | `isTest` | boolean | no | Send only to authenticated sender |
  | `dryRun` | boolean | no | Validate/build only; do not SMTP |

**Server flow**
`sendEmail.js` → `validateJiraTokenMiddleware` → `sendEmailHandler` → `statusEmailSendService.buildMailOptions` → `statusEmailHtmlService.buildStatusEmailHtml` (`emailHtmlSanitize`) → `emailService.sendEmailDirect` → Nodemailer SMTP → `emailHistoryDB.saveEmailHistory`.

**Response shape**
```json
{
  "success": true,
  "message": "Email sent successfully",
  "messageId": "<smtp-id>",
  "recipients": ["user@nutanix.com"],
  "isTestMode": false
}
```

**Error responses**
| HTTP | When | Client should |
|---|---|---|
| 400 | Missing JIRA email on token / missing Highlights sections | Fix input / re-auth |
| 401 | Invalid/missing JIRA token | Re-login |
| 429 | Rate limited | Wait and retry |
| 500 | SMTP reject / send failure (generic message; no secret leakage) | Retry or contact ops |

**Caching**: No.

**Security notes**
- HTML is allowlist-sanitized; `javascript:` / `data:` / `localhost` hrefs stripped.
- Client errors do not echo raw SMTP/password details.
- SMTP password is not logged; connector recreates on credential fingerprint change (password still used in-process by Nodemailer auth, never echoed to clients).

---

### POST /api/email/preview

**Purpose**: Same HTML/CC assembly as send, without SMTP — for Outlook clipboard copy.

**Auth**: required — same as `/send`.

**Request**: Same body as `/send` (no `isTest`/`dryRun` required).

**Server flow**
`preview.js` sets `req.previewOnly = true` → `sendEmailHandler` → returns built content.

**Response shape**
```json
{
  "success": true,
  "to": "…",
  "cc": "…",
  "subject": "…",
  "htmlBody": "<!DOCTYPE html>…",
  "textBody": "…"
}
```

**Error responses**: Same as `/send` for validation/auth.

**Caching**: No.

---

### Related routes (listed; see handlers for full contracts)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/email/send-release-versions` | JIRA token + release-versions email allowlist | Release-versions DL email |
| POST | `/api/email/send-generic-reminder` | JIRA token + `requireAuth('genericEmailer')` | Generic reminder |
| POST | `/api/email/send-sos` | JIRA token | SoS email |
| GET/POST/PUT/DELETE | `/api/email/schedules` | JIRA token | Scheduled emails |
| GET/DELETE | `/api/email/history` | JIRA token + email-history auth | History |

---

### SMTP config (ops)

- Host/port/from: `server/config/emailConfig.json` + `SMTP_*` env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
- Production relay is STARTTLS + service-account auth (not anonymous port 25). Do not log `SMTP_PASS`.
