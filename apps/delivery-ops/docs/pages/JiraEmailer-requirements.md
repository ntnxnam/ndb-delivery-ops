# JIRA Emailer (Generic Emailer) — Requirements

**Route**: `/generic-emailer`  
**Component**: `GenericEmailer`  
**Permission**: `EMAIL_SEND_GENERIC`  
**Audience**: RM, TPM — ad-hoc JIRA query → email

---

## Purpose

The JIRA Emailer lets a user write or select a JQL query, preview the resulting issue list, configure the email layout and recipients, and send a formatted email — without needing a Confluence page as the source. It's the generic, query-driven complement to the Confluence-based Email Sender.

---

## User Stories

| ID | Story |
|----|-------|
| JE-01 | As an RM, I can enter a JQL query and preview the matching issues before sending. |
| JE-02 | As an RM, I can pick from saved query templates (e.g., "Open P0/P1 for NDB-2.11") to speed up common sends. |
| JE-03 | As an RM, I can configure column layout — which fields to show in the table — for the email. |
| JE-04 | As an RM, I can configure the email subject, recipients (To / CC), and a header paragraph. |
| JE-05 | As an RM, I can send the email and receive a success or failure notification. |
| JE-06 | As an RM, the sent email appears in Email History for audit purposes. |

---

## UI Behaviour

1. **JQL input** — textarea with syntax highlighting (basic); run query button
2. **Query results preview** — table of issues with configured columns; shows count + "View in JIRA" link
3. **Template selector** — dropdown of saved JQL templates from `emailSenderFeatures.js` config
4. **Column configurator** — drag-reorder list of available JIRA fields to include in email table
5. **Email compose section** — subject, To, CC, introductory paragraph (plain text)
6. **Send button** — disabled while query running; success/failure toast
7. **Preview toggle** — renders the HTML email preview before send

---

## Permissions

- Requires `EMAIL_SEND_GENERIC`
- JQL queries are proxied through the server — user's JIRA token limits what they can see

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| JQL syntax error | JIRA returns 400; show "JQL error: [message from JIRA]" inline |
| Query returns 0 results | Show "No issues match — email will be empty" warning before send |
| Query returns >500 issues | Cap preview at 500; show "First 500 of X shown" note |
| No recipients entered | Disable Send; show "Add at least one recipient" |
| Template references a deleted release | Query still runs; user sees 0 results; expected behaviour |

---

## Acceptance Criteria

- [ ] JQL query results appear within 5 seconds for queries returning ≤200 issues
- [ ] Column configuration is persisted to `localStorage` so it survives refresh
- [ ] Sent email contains the same columns and rows shown in the preview
- [ ] Email appears in Email History with the JQL query stored for audit
- [ ] Invalid JQL surfaces the JIRA error message verbatim (never a generic "query failed")
