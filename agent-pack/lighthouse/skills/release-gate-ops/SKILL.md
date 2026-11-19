---
name: release-gate-ops
description: Manage all release gate date mutations — JIRA FEAT ticket fields (Code Complete, Commit Gate, Promotion Gate with Confluence audit) and local release config (GA/CCM/CG/PG slip pattern with sprint extension). Use when any gate date needs to move, whether on a ticket or in the release version config. Routes automatically by target.
audience: rm, tpm, portfolio_mgr
---

# Release Gate Ops — Unified Gate Date Management (D30, D31)

Single skill for **all** gate-date mutations. Implements **D30** (mandatory reason + Confluence audit for JIRA) and the release-config slip pattern. The orchestrator delegates here whenever a date gate needs to move — the skill routes by target.

## When to Use This Skill

- User says "move CC to ...", "push the commit gate", "slip the PG", "move GA to ..." — any gate date change
- User says "update release date", "date slipped to ...", "changed release date", "/update-release-date"
- RM/TPM requests a single FEAT-tier ticket field change (`customfield_11067`, `customfield_35863`, `customfield_35864`)
- RM/TPM requests a release-level config change in `releaseVersionsEmailConfig.json` (GA, CCM, CG, PG)
- Any request that previously went to `move-gate-date` or `update-release-date` — this skill replaces both

If the user is asking *what* the dates are (read-only), this is the wrong skill — use `ticket-insights` or `releaseDatasetService` instead.

## Quick Start

**Step 0 — Route by target.** Inspect the user's request:

| Signal | Route | Handler |
|---|---|---|
| Contains a ticket key (`FEAT-123`, `X-FEAT-456`, Capability) | **Route J: JIRA** | JIRA FEAT field + Confluence audit |
| Contains a release key (`NDB-2.11`, `NDB-2.12`) without a ticket key | **Route C: Config** | Local JSON slip pattern |
| Contains both | Ask which target, or do both sequentially | — |
| Ambiguous ("move code complete to June 15") | Ask: "Is this for a ticket (FEAT-NNNN) or the release config (NDB-X.XX)?" | — |

Gather **all** inputs before mutating. Ask for anything missing.

### Route J inputs (JIRA)

1. **ticketKey** — e.g. `FEAT-1001`
2. **fieldId** — `customfield_11067` (CC), `customfield_35863` (CG), `customfield_35864` (PG)
3. **newDate** — `YYYY-MM-DD`
4. **reason** — non-empty, trimmed — **mandatory** — `n/a` rejected

### Route C inputs (Config)

1. **release** — e.g. `NDB-2.11`
2. **gate** — GA, Code Complete, Commit Gate, Promotion Gate
3. **newDate** — `YYYY-MM-DD`
4. **reason** — slip rationale (stored on new entry)

## Core Rules

### Universal

1. **Reason is mandatory.** Never call a tool without a non-empty trimmed reason. Ask if missing. Applies to both routes (D30).
2. **Confirm before mutating.** Echo back (a) target, (b) field/gate, (c) old→new date, (d) reason. Wait for explicit "yes" even if all fields were in the initial message.
3. **Authorisation enforced server-side (Route J).** RM + TPM only. Surface 403 verbatim.
4. **Authorisation enforced via config ownership (Route C).** RM/TPM via same `authService.dateMover` feature gate.

### Route J — JIRA FEAT fields only

5. **Three fields only.** `customfield_11067` (Code Complete), `customfield_35863` (Commit Gate), `customfield_35864` (Promotion Gate). Decline Epic `duedate` or sprint dates — different audit paths.
6. **Confluence audit is transactional.** JIRA write + Confluence `appendStructuredRow` in same operation. On `confluence_audit_failed`, JIRA is rolled back — tell user "no change applied, please retry".
7. **On `inconsistent_state`, escalate loudly.** JIRA changed but Confluence failed AND rollback failed. Report in capitals, ask for manual audit row. Do not downplay — this is why D30 exists.

### Route C — Release config slip pattern

8. **Never overwrite — always add a new numbered entry.** Find highest-numbered key for the gate (`ga2`, `commitGate2`), set its `style` from `solid` → `dotted` (keep its `reason`), add next number (`ga3`) with `style: solid` and new date + reason.

   **Gate → JSON key prefix:**

   | Gate | Key prefix | Color |
   |---|---|---|
   | General Availability | `ga` | `#28a745` |
   | Code Complete | `ccm` + number + `Gate` | `#de350b` |
   | Commit Gate | `commitGate` | `#ff9800` |
   | Promotion Gate | `promotionGate` | `#9c27b0` |

   Use labels like `"GA 3"`, `"Commit Gate 3"`. Never rotate keys or push into `gaOverflow`/`promotionGateOverflow`.
9. **Check sprintDates.** After reading `apps/delivery-ops/server/config/releaseVersionsEmailConfig.json`, if new date falls after last `sprintDates` entry, offer to extend with additional 21-day Wednesday-anchored boundaries (per `sprint-system.mdc`).
10. **Apply with targeted edit.** Use `StrReplace` on the single release entry — do not rewrite the whole file.

## Tool Contract

### Route J — JIRA + Confluence (DateMoverService)

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

Resolve `audit.confluencePageId` from product config. MCP equivalent: `move_jira_dates`.

**Success:**

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

**Errors (Route J):**

| `code` | Meaning | Action |
|---|---|---|
| `invalid_field` | Non-gate field | Re-explain 3 allowed fields |
| `invalid_date` | Not ISO YYYY-MM-DD | Ask for valid date |
| `empty_reason` | Missing reason | Ask for reason |
| `ticket_not_found` | JIRA 404 | Verify ticket key; offer search |
| `jira_update_failed` | Permission/server | Surface message; no silent retry |
| `confluence_audit_failed` | Confluence write failed; JIRA rolled back | "No change applied, please retry" |
| `inconsistent_state` | JIRA changed, Confluence + rollback failed | **Escalate — Core Rule 7** |

### Route C — Local config (file edit)

Read `apps/delivery-ops/server/config/releaseVersionsEmailConfig.json`, locate `releaseGateDates[release]`, apply slip pattern (Core Rule 8), optionally extend `sprintDates`.

**Example — GA slipping June 15 → July 14 on NDB-2.11:**

Before:
```json
"ga2": { "label": "General Availability 2", "date": "2026-06-15", "color": "#28a745", "style": "solid" }
```

After:
```json
"ga2": { "label": "General Availability 2", "date": "2026-06-15", "color": "#28a745", "style": "dotted" },
"ga3": { "label": "General Availability 3", "date": "2026-07-14", "color": "#28a745", "style": "solid", "reason": "Customer X requested 4-week extension for compliance review" }
```

## Output Format

### Confirmation-required (both routes, before mutating)

```markdown
I'm about to move:

- **Target:** [FEAT-1001]({jiraUrl}) | NDB-2.11 release config
- **Gate:** {fieldLabel / gateLabel} ({fieldId / jsonKey})
- **From:** {previousValue} → **To:** {newValue}
- **Reason:** "{reason}"

This will be audited to {Confluence Date Change Log | config history}. Reply "yes" to proceed.
```

### Success — Route J

```markdown
Moved **{fieldLabel}** on [{ticketKey}]({jiraUrl}) from `{previousValue}` to `{newValue}`.

Reason logged: "{reason}"

Audit row added to the Date Change Log ([Confluence page #{pageId}, v{confluenceVersion}]({confluenceUrl})).
```

### Success — Route C

```markdown
Updated **{gate}** for **{release}** from `{previousValue}` to `{newValue}`.

- Previous entry `{jsonKeyPrev}` → `dotted` (kept reason: "{oldReason}")
- New entry `{jsonKeyNew}` → `solid` with reason: "{reason}"
- Config: `apps/delivery-ops/server/config/releaseVersionsEmailConfig.json`

Sprint check: {within range | extended with N new sprints to {lastDate}}.
```

### Inconsistent-state escalation (Route J only)

```markdown
**⚠️ INCONSISTENT STATE — manual remediation required.**

JIRA was updated ({ticketKey}.{fieldId} = {newValue}) but the Confluence audit row could not be written, AND the rollback also failed. As of now:

- JIRA shows: {newValue}
- Previous value: {previousValue}
- Reason: "{reason}"

Please manually add a row to the Date Change Log page so the audit trail remains complete. The platform will not retry automatically.
```

## Quality Validation

Before declaring any gate move done:

- [ ] Reason was non-empty after trim (both routes)
- [ ] User explicitly confirmed before mutation
- [ ] Route J: field was one of 3 gate-date fields; service returned `ok: true` with `confluenceVersion > 1`; reply includes JIRA + Confluence links
- [ ] Route C: previous solid entry set to `dotted`; new entry is next number with `solid` + reason; file edited via targeted `StrReplace`; `sprintDates` checked
- [ ] Routing was correct (ticketKey → J, releaseKey → C, ambiguous → asked)
- [ ] On any error, underlying `code` and `message` surfaced (not swallowed)
- [ ] References decision IDs D30 (JIRA audit) and D31 (release config) where applicable

## Delegation

Owner: `rm-specialist`. Triggered by `ops-assistant` via `loadAgentPack('lighthouse')`.
