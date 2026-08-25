---
name: move-gate-date
description: Move a release gate date (Code Complete, Commit Gate, Promotion Gate) on a FEAT/X-FEAT/Capability ticket with a mandatory reason that is audited to Confluence. Use when an RM or TPM says "move CC to ...", "push the commit gate to ...", "slip the PG date", or anywhere a gate-date mutation is requested. NEVER attempt to move a date without confirming the reason first.
audience: rm, tpm, portfolio_mgr
---

# Move Gate Date with Confluence Audit (D30)

This is the canonical workflow for moving a release gate date through
the consolidated app. It implements **D30** in `DECISIONS.md`: every
gate-date move requires a reason and is audited to Confluence in the
same transaction.

## When to Use This Skill

The orchestrator (`ops-assistant`) should hand off to this skill when
the user says any of:

- "move CC to ..."
- "push the commit gate to ..."
- "slip the PG to ..."
- "move the gate date on FEAT-NNNN"
- "the code complete date needs to change"
- Any explicit request to change `customfield_11067`, `customfield_35863`,
  or `customfield_35864` on a FEAT-tier ticket

If the user is asking about *what* the dates are (read-only), this is
the wrong skill — use `fetch-project-tickets` or the trunk's
`releaseDatasetService` instead.

## Core Rules

1. **Three fields only.** Code Complete (`customfield_11067`), Commit
   Gate (`customfield_35863`), Promotion Gate (`customfield_35864`).
   No other date fields are in scope for this skill. If asked to move
   Epic `duedate` or sprint dates, decline and explain that those
   follow different audit paths.
2. **Reason is mandatory.** Never call the tool without a non-empty,
   trimmed reason. If the user hasn't supplied one, ASK before
   proceeding. Empty / "n/a" / "no reason" are rejected by the service.
3. **Confirm before mutating.** Always echo back to the user: (a) which
   ticket, (b) which field, (c) old date, (d) new date, (e) the reason.
   Wait for explicit confirmation. This applies even when the user has
   given all five fields in their initial message.
4. **Authorisation is enforced server-side.** RM + TPM only (D30). If
   the API returns 403, surface the message verbatim — do not try to
   work around it.
5. **Cite the Confluence audit row.** When the move succeeds, link to
   the updated audit page in the reply so the user can verify.
6. **On `inconsistent_state` error, escalate.** This means JIRA was
   updated but the Confluence audit could not be written AND the
   rollback failed. Tell the user immediately, in capitals, what state
   the system is in and ask them to manually write the audit row.
   Don't downplay this — it's the entire reason D30 exists.

## Tool Contract

The orchestrator calls the API endpoint (or the equivalent MCP tool
once registered):

```
POST /api/date-mover/move-gate-date
Authorization: Bearer <user JIRA PAT>
Content-Type: application/json

{
  "ticketKey": "FEAT-1001",
  "fieldId": "customfield_11067",
  "newDate": "2026-06-15",
  "reason": "Vendor X delivered 2 weeks late; reallocated capacity to CVE-2026-1234",
  "audit": {
    "confluencePageId": "<from product config>",
    "tableAnchorId": "DateChangeLog"
  }
}
```

Resolve `audit.confluencePageId` from the product config or ask the
Portfolio Manager. Per D31 (open), the exact page is deferred until
the implementation lands against the real execution page format.

### Success response

```json
{
  "success": true,
  "data": {
    "ok": true,
    "ticketKey": "FEAT-1001",
    "fieldId": "customfield_11067",
    "fieldLabel": "Code Complete Date",
    "previousValue": "2026-06-01",
    "newValue": "2026-06-15",
    "audit": { "pageId": "...", "confluenceVersion": 17 }
  }
}
```

### Error responses worth handling specially

| `code` | What it means | What to do |
|---|---|---|
| `invalid_field` | Caller passed a non-gate field | Re-explain the 3 allowed fields, ask which one |
| `invalid_date` | Date isn't ISO YYYY-MM-DD or isn't a real calendar day | Ask the user for a valid date |
| `empty_reason` | Reason was missing / whitespace | Ask the user for the reason |
| `ticket_not_found` | JIRA returned 404 | Ask the user to verify the ticket key; offer to search |
| `jira_update_failed` | JIRA permission / server issue | Surface the underlying message; do not retry silently |
| `confluence_audit_failed` | Confluence write failed; JIRA was rolled back | Tell the user "no change applied, please retry" |
| `inconsistent_state` | JIRA changed, Confluence failed, rollback failed | **Escalate loudly** — see Core Rule #6 |

## Output Format

### Success reply (Portfolio Manager / RM / TPM)

```markdown
Moved **{fieldLabel}** on [{ticketKey}]({jiraUrl}) from
`{previousValue}` to `{newValue}`.

Reason logged: "{reason}"

Audit row added to the Date Change Log
([Confluence page #{pageId}, v{confluenceVersion}]({confluenceUrl})).
```

### Confirmation-required reply (before mutating)

```markdown
I'm about to move:

- **Ticket:** [{ticketKey}]({jiraUrl})
- **Field:** {fieldLabel}
- **From:** {previousValue} → **To:** {newValue}
- **Reason:** "{reason}"

The change will be audited to Confluence. Reply "yes" to proceed.
```

### Inconsistent-state reply (escalation)

```markdown
**⚠️ INCONSISTENT STATE — manual remediation required.**

JIRA was updated ({ticketKey}.{fieldId} = {newValue}) but the
Confluence audit row could not be written, AND the rollback also
failed. As of now:

- JIRA shows: {newValue}
- Previous value: {previousValue}
- Reason: "{reason}"

Please manually add a row to the Date Change Log page so the audit
trail remains complete. The platform will not retry automatically.
```

## Quality Validation

Before declaring the move done:

- [ ] Reason was non-empty after trim
- [ ] User explicitly confirmed before the mutation went out
- [ ] Field was one of the 3 gate-date fields
- [ ] Service returned `ok: true` with a Confluence version > 1
- [ ] Reply includes both the JIRA ticket link and the Confluence audit
      link
- [ ] On any error, the underlying `code` and `message` are visible to
      the user (not swallowed)
