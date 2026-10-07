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

1. **JIRA key + Fetch** — user enters a Feature/Initiative/X-FEAT/Capability key and fetches ticket data.
2. **Subject field** — auto-populated as `{issue type} - {summary} - {fix version} - Weekly Update - {dd/Mmm/yyyy}`. Fix version is omitted when the ticket has none.
3. **Highlights and Lowlights** (ReactQuill) — required sections: Highlights, Lowlights, Support needed from leaders. Risk reason / Path to green are **not** in this editor.
4. **AI summary draft** — “Generate Fresh AI Summary” calls `POST /api/ai/exec-summary` (same NAI path as Project Status). Scratch pad only; not saved, not emailed.
5. **Risk context boxes** (below Highlights) — Risk Indicator (`customfield_23560`), Risk Assessment (`customfield_47780`), Path to Green (`customfield_55664`), read-only from JIRA.
6. **Gates vs dates chart** — horizontal bars of FS/DS, Test Plan, Code Complete, Commit Gate, Promotion Gate vs days from today. Mirrored in outbound email as an HTML bar table.
7. **Recipient fields** — Additional Recipients text input; comma-separated usernames/emails.
8. **Send button** — disabled while loading; on success shows toast, on failure shows error message.
9. **Outlook fallback** — copy-to-clipboard for HTML body when the client strips rich text.

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
