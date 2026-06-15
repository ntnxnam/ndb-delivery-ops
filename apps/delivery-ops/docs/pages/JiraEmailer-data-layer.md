# JIRA Emailer (Generic Emailer) — Data Layer & Middleware Contract

**Route**: `/generic-emailer`  
**Server routes used**: `server/routes/jira/proxy.js`, `server/routes/email/`  
**Config**: `client/src/config/emailSenderFeatures.js` (templates)  
**Hook**: `useGenericEmailerConfig`

---

## API Calls (client → server)

### 1. Run JQL query (preview)

```
POST /api/jira/proxy/search
Headers: x-jira-token, x-username
Body: { jql, fields, maxResults, startAt }
```

**Server flow**: `jira/proxy.js → jiraConnector.search(jql, fields, pagination)`  
**JIRA endpoint**: `POST /rest/api/2/search`  
**Fields requested**: configurable per column layout; always includes `summary, status, priority, assignee, issuetype, fixVersions, key`  
**Returns**: `{ issues: [...], total, startAt, maxResults }`  
**Pagination**: server fetches up to 500 issues in batches of 100; returns all to client

> **JQL approval rule applies**: any change to the JQL constructed or passed here requires explicit approval per `jql-edit-approval.mdc`.

---

### 2. Send email

```
POST /api/email/send
Headers: x-jira-token, x-username
Body: { to, cc, subject, htmlBody, jql, productId }
```

**Server flow**: same as Email Sender — `sendEmailHandler.js → sanitize.js → emailService → SMTP`  
**Additional field vs Email Sender**: `jql` is stored in the email history record for audit  
**Returns**: `{ success: true, messageId }` or `{ success: false, error }`

---

## Template Config (`emailSenderFeatures.js`)

Templates are static config in the client — not fetched from the server:

```javascript
// client/src/config/emailSenderFeatures.js
export const QUERY_TEMPLATES = [
  {
    id: 'open-p0p1',
    label: 'Open P0/P1 — active release',
    jql: 'project=ERA AND priority in ("Blocker - P0","Critical - P1") AND status != Done AND fixVersion in unreleasedVersions()',
  },
  // ...
];
```

Templates reference un-parameterised JQL — user edits after loading template if they need a specific release.

---

## Column Configuration

Stored in `localStorage` under key `genericEmailerColumns`. Shape:

```json
["key", "summary", "status", "priority", "assignee", "fixVersions"]
```

Available columns map to JIRA fields. Custom fields are resolved through `jiraFields.js`:

| Display name | JIRA field |
|---|---|
| Key | `key` |
| Summary | `summary` |
| Status | `status` |
| Priority | `priority` |
| Assignee | `assignee` |
| Fix Version | `fixVersions` |
| Component | `components` |
| CC Date | `customfield_11067` |

---

## Email HTML Generation

The HTML table is generated client-side in `emailTableGenerator.js` before the send request:

1. Maps `issues[]` × `selectedColumns[]` → `<table>` rows
2. Linkifies the `key` column to `jiraBaseUrl/browse/{key}`
3. Colour-codes `priority` and `status` cells using CSS classes inlined by `emailTableGenerator`
4. Passes the resulting HTML as `htmlBody` to the send endpoint

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| JQL syntax error | 400 | Show JIRA error message inline under JQL field |
| JIRA token expired | 401 | Prompt re-auth |
| Query timeout (>30 s) | 504 | Show "Query timed out — try a narrower JQL" |
| 0 results | 200 | Show warning before allowing send |
| SMTP failure | 503 | Show verbatim SMTP error |
