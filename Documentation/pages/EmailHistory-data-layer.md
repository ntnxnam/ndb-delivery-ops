# Email History — Data Layer & Middleware Contract

**Route**: `/email-history`  
**Server routes used**: `server/routes/email/` (history sub-routes)  
**Storage**: append-only JSON log file on server disk

---

## API Calls (client → server)

### 1. Fetch history list

```
GET /api/email/history?page=1&limit=25&sender=&release=&from=&to=
Headers: x-jira-token, x-username
```

**Server flow**: reads email history log file → filters by query params → paginates → returns  
**Non-admin**: automatically scoped to `username` from the auth header  
**Admin**: returns all records when `x-username` matches an admin entry in `allowedUsers.json`  
**Returns**:
```json
{
  "records": [
    {
      "id": "uuid",
      "sentAt": "2026-06-15T08:30:00Z",
      "sender": "namratha.singh",
      "subject": "NDB-2.11 Status Update",
      "to": ["team-dl@nutanix.com"],
      "cc": [],
      "release": "NDB-2.11",
      "source": "email-sender",
      "jql": null,
      "bodyRef": "2026-06-15-uuid.html"
    }
  ],
  "total": 142,
  "page": 1,
  "limit": 25
}
```

---

### 2. Fetch email body (detail panel)

```
GET /api/email/history/:id/body
Headers: x-jira-token, x-username
```

**Server flow**: reads the body file referenced by `bodyRef` from `server/email-history/` directory  
**Returns**: `{ html: "<html>...</html>" }`  
**Size limit**: bodies > 500 KB are not stored; endpoint returns `{ html: null, truncated: true }`

---

### 3. Re-send

Re-send does NOT have its own endpoint. The client navigates to the originating send page (Email Sender or JIRA Emailer) pre-filled with the history record's data. The actual send follows the normal send path.

---

## Write Path (how records are created)

On every successful send via `POST /api/email/send` or `POST /api/email/send-generic`:

1. `sendEmailHandler.js` appends a record to `server/email-history/log.json`
2. If body size ≤ 500 KB: saves the HTML body to `server/email-history/{date}-{uuid}.html`
3. Returns `{ success: true, messageId, historyId: uuid }`

`log.json` is append-only. Deletions are not supported by design (audit requirement).

---

## Storage Layout

```
server/
  email-history/
    log.json                          ← array of history record metadata
    2026-06-15-<uuid>.html            ← stored body files
    2026-06-14-<uuid>.html
```

`log.json` is read entirely into memory on each history request (acceptable for current volume; if > 10,000 records consider SQLite migration).

---

## Data Shape — history record

```json
{
  "id": "c7f2a9d1-...",
  "sentAt": "2026-06-15T08:30:00.000Z",
  "sender": "namratha.singh",
  "subject": "NDB-2.11 Status Update — 2026-06-15",
  "to": ["team@nutanix.com"],
  "cc": ["manager@nutanix.com"],
  "release": "NDB-2.11",
  "productId": "ndb",
  "source": "email-sender",
  "jql": null,
  "bodyRef": "2026-06-15-c7f2a9d1.html",
  "messageId": "<abc@mailrelay>"
}
```

For JIRA Emailer records, `source = "jira-emailer"` and `jql` contains the query string.

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Log file missing | 500 | Show "History unavailable" message |
| Body file missing (deleted externally) | 404 | Show "Email body not available" in detail panel |
| Non-admin requesting another user's records | 403 | Server silently filters; client shows empty results (not an error) |
| Log too large (>50 MB) | — | Server-side rotation: archive `log.json` to `log-YYYY-MM.json` monthly |
