# Email History — Requirements

**Route**: `/email-history`  
**Component**: `EmailHistoryTab`  
**Permission**: `EMAIL_HISTORY_VIEW`  
**Audience**: RM, TPM — audit trail for sent emails

---

## Purpose

Email History is the audit log of every email sent through the app (from both Email Sender and JIRA Emailer). It lets users verify that an email was sent, see who sent it, view the exact content, and re-send if needed.

---

## User Stories

| ID | Story |
|----|-------|
| EH-01 | As an RM, I can see a chronological list of all emails sent through the app so I have an audit trail. |
| EH-02 | As an RM, I can filter the history by sender, release, date range, and subject keyword. |
| EH-03 | As an RM, I can click an email record to preview the exact HTML content that was sent. |
| EH-04 | As an RM, I can re-send a previous email to the same or updated recipient list. |
| EH-05 | As an admin, I can see the JQL query associated with each JIRA Emailer send for audit. |

---

## UI Behaviour

1. **History list** — table with columns: Date, Sender, Subject, Release, Recipients count, Source (Email Sender vs JIRA Emailer)
2. **Filter bar** — date range picker, sender name search, subject keyword search, release dropdown
3. **Detail panel** — clicking a row expands or opens a side panel showing: full recipient list, email body preview, source JQL (if JIRA Emailer), metadata
4. **Re-send button** — in detail panel; opens the corresponding send page pre-filled with the historical data
5. **Pagination** — 25 records per page; infinite scroll or explicit pagination

---

## Permissions

- Requires `EMAIL_HISTORY_VIEW`
- Users can only see emails sent by themselves unless they have `ADMIN_PANEL_ACCESS` (admins see all)

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| No emails sent yet | Show "No email history yet" empty state |
| Email body was very large (>500 KB) | Preview truncated with "Full email not stored — body exceeded size limit" notice |
| Re-send of an old email to a now-invalid recipient | Client-side validation warns "Invalid email address" before submit |
| History log file corrupted | Show "History unavailable — log file error" with admin contact note |

---

## Acceptance Criteria

- [ ] History loads within 3 seconds for up to 500 records
- [ ] Email body preview renders faithfully (same as received in email client)
- [ ] Re-send pre-fills subject, body, and recipients from the history record
- [ ] Admin users see all emails; non-admin users see only their own
- [ ] JQL field is visible (not blank) for all JIRA Emailer sends
