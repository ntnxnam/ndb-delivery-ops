# Workflow: Release cascade rename

Safely rename a JIRA `fixVersion` across every place it appears (tickets,
saved filters, dashboards, automation rules). One of the highest-blast-radius
operations in NDB-Ops — this workflow exists so it's never a one-shot rename.

## Trigger

User says: "rename release", "cascade rename", "change NDB-2.x to NDB-2.x.1
everywhere".

## Inputs

| Input | Required | Notes |
|---|---|---|
| `oldName` | yes | Exact JIRA fixVersion string. |
| `newName` | yes | Target string. |
| `confirmDryRun` | yes | The user must view the dry-run summary before proceeding. |
| `confirmApply` | yes | Second explicit confirmation before writing. |

## Owner agent

`rm-assistant`.

## Steps

1. **Discover scope (read-only)**
   - Query JIRA tickets: `fixVersion = "<oldName>"` → count, list of issue
     types, list of teams (`customfield_10301` if mapped).
   - Query saved filters: scan filters whose JQL contains `"<oldName>"`
     (use the existing `apps/delivery-ops/server/routes/jira/index.js`
     filter search endpoint).
   - Query dashboards / automation rules referencing the version (if access
     allows).
   - Output a dry-run table:
     ```
     | Surface          | Count | Examples                       |
     |------------------|------:|--------------------------------|
     | Tickets          |   147 | FEAT-123, ERA-456, NDB-789     |
     | Saved filters    |     9 | "NDB 2.11 hot list", ...       |
     | Dashboards       |     2 | "NDB exec dashboard"           |
     | Automation rules |     1 | "Auto-set risk to red on miss" |
     ```

2. **First confirmation gate**
   - Show the table to the user.
   - Block until the user types the equivalent of "yes proceed to apply".

3. **Apply phase A — JIRA tickets**
   - Call `move_jira_dates` ... NOT a date change here, sorry: this needs a
     dedicated `rename_fix_version` MCP tool. For the v0 of this workflow we
     fall back to the in-app endpoint
     `POST /api/jira/rename-version-cascade` in `apps/delivery-ops/server`.
   - Pass `dryRun: false` only after step 2 was confirmed.

4. **Apply phase B — saved filters**
   - For each filter touched in step 1, fetch its JQL, replace
     `"<oldName>"` with `"<newName>"`, PUT back.
   - Verify each round-trip: GET, assert old name is gone.

5. **Apply phase C — dashboards / automation rules**
   - These often need manual JIRA-admin help. List them at the end with
     direct admin-console links so the user can finish them.

6. **Second confirmation gate before phase C**
   - The user has a chance to abort after phase A + B if anything looks off.

7. **Audit log**
   - Write a `reports/CascadeRename-<oldName>-to-<newName>-<YYYY-MM-DD>.md`
     with every surface touched, before/after, and any phase-C TODOs.

## Outputs

- `reports/CascadeRename-<oldName>-to-<newName>-<YYYY-MM-DD>.md`
- All matching tickets re-tagged.
- All matching saved filters updated.
- Phase-C admin TODOs listed for the user.

## Failure handling

| Failure | Recover |
|---|---|
| Any phase-A ticket update fails | Halt. List succeeded vs failed tickets; do not start phase B until the user decides. |
| Any phase-B filter update fails | Halt. Record which filters still have the old name. |
| User aborts at gate 1 or gate 2 | Save the dry-run report; no changes made; exit cleanly. |

## Validation checklist

- [ ] Dry-run shown before any write.
- [ ] User typed an explicit "proceed" between dry-run and apply.
- [ ] Audit log saved before declaring success.
- [ ] Phase-C TODOs surfaced — never silently dropped.
- [ ] Old name no longer appears in any updated filter's JQL.
