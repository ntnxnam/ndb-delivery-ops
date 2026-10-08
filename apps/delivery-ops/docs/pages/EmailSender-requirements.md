# Email Sender — Requirements

**Route**: `/`  
**Component**: `EmailSender`  
**Permission**: none (all authenticated users)  
**Audience**: RM, TPM, team leads who send release-status emails

---

## Purpose

The Email Sender is the original and primary feature of the app. It lets an authenticated user extract a Confluence page's content, compose a status-update email pre-populated from JIRA data (release versions, project health, gate dates), and send it via SMTP to a configurable recipient list.

---

## User Stories

| ID | Story |
|----|-------|
| ES-01 | As an RM, I can paste a Confluence page URL and have its content extracted automatically so I don't have to copy-paste manually. |
| ES-02 | As an RM, I can select a release version and see relevant JIRA data pre-populated in the email body. |
| ES-03 | As an RM, I can edit the email subject, body (rich text), and recipient list before sending. |
| ES-04 | As an RM, I can preview the email in a rendered format before sending it. |
| ES-05 | As an RM, I can send the email and get immediate confirmation (or failure message) from the server. |
| ES-06 | As a user, I can see my previously sent emails in the Email History tab without needing to leave and navigate. |
| ES-07 | As an admin, I can configure allowed sender domains and SMTP settings without redeploying the app. |

---

## UI Behaviour

**UI is the reverse of the email body** — pulled data on top, typed entry above Send.

| UI (top → bottom) | Email body (top → bottom) |
|---|---|
| Ticket strip + pulled details (incl. sprint Gantt) | Highlights / Lowlights / Support |
| Gates chart | AI risk summary |
| Risk row | Risk context |
| Subject (header only) · Highlights · AI · Recipients · **Send** | Gates vs dates → JIRA ticket / epics / breakdown → Sprint timeline |

1. **JIRA key + Fetch** — Feature / Initiative / X-FEAT / Capability.
2. **Pulled** — strip, collapsed ticket data, sprint Gantt, gates (EC→…→PG), risk (Indicator / Assessment / Path to Green).
3. **Entry** — Subject (email header only), Highlights (required sections), **AI risk summary (required — emailed)**, Recipients.
4. **Send** + Outlook copy fallback (preview includes AI + sprint timeline).

---

## Permissions

- Accessible to **all authenticated users** (no RBAC permission required beyond valid JIRA token).
- Server validates the JIRA token before allowing the Confluence extraction call.

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Invalid Confluence URL | Show inline error "Could not reach Confluence page — check URL and your access" |
| Confluence page requires specific permissions the user lacks | Return 403-style error message from server |
| JIRA token expired between login and send | Return 401; prompt user to re-authenticate |
| No recipients entered | Validate client-side; disable Send button |
| SMTP relay down | Server returns 503; show "Email delivery failed — try again" |
| Empty extracted content | Allow send with warning: "Extracted content is empty — are you sure?" |

---

## Acceptance Criteria

- [ ] Confluence URL produces extracted HTML within 5 seconds on a standard internal page
- [ ] JIRA release data appears in the body within 3 seconds of release selection
- [ ] Send action confirms delivery with a success toast or surfaces the SMTP error message verbatim
- [ ] Email appears in Email History within 30 seconds of send
- [ ] Page is fully usable at 1280px viewport width without horizontal scroll
