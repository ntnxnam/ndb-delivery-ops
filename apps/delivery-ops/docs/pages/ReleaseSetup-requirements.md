# Release Setup — Requirements

**Route**: `/release-setup`  
**Component**: `ReleaseSetup`  
**Permission**: `RELEASE_SETUP_MANAGE`  
**Audience**: RM only — destructive/admin operations

---

## Purpose

Release Setup provides RM-only tools for managing JIRA release versions: creating new releases, renaming or cascading a rename across all related versions, and cleaning up stale filter configurations. These are operations that would otherwise require direct JIRA admin access or tedious manual work.

---

## User Stories

| ID | Story |
|----|-------|
| RS-01 | As an RM, I can create a new release version in JIRA so that the team can start tagging issues. |
| RS-02 | As an RM, I can rename an existing release version (e.g., NDB-2.11 → NDB-2.12) and have all downstream config updated in one action. |
| RS-03 | As an RM, I can cascade a rename so that companion releases (NDB-2.11.1, NDB-2.11.2) are updated to match the new parent name pattern. |
| RS-04 | As an RM, I can run a cleanup pass on stale JIRA filter configurations that reference deleted or renamed releases. |
| RS-05 | As an RM, I can preview what a rename or cleanup will affect before committing the change. |

---

## UI Behaviour

1. **Create release form** — name, description, release date picker; validation before submit
2. **Rename panel** — select existing release, enter new name; "Preview" button shows affected items; "Confirm" executes
3. **Cascade rename** — checkbox on rename panel; lists companion versions that will also be renamed
4. **Cleanup filters panel** (`CleanupFilters`) — lists JIRA saved filters with stale release references; checkboxes to select which to update; "Apply" button
5. **Confirmation dialogs** — every destructive action (create, rename, cleanup) requires a modal confirmation

---

## Permissions

- Requires `RELEASE_SETUP_MANAGE` — this is a restricted permission; only RM accounts in `allowedUsers.json`
- Non-RM users who somehow reach this route see a "You don't have permission" wall (not a redirect, so the URL is preserved)

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| New release name already exists | Inline error "Release already exists in JIRA" |
| Rename conflicts with existing version | Block and show conflicting version name |
| Cascade rename has partial failures | Show per-companion status; roll back fully or show partial success clearly |
| Cleanup finds 0 stale filters | Show "No stale filter references found" |
| JIRA API rate-limited mid-cascade | Pause, show progress, retry automatically up to 3 times |

---

## Acceptance Criteria

- [ ] Create action reflects in JIRA within 5 seconds and appears in the release picker immediately
- [ ] Rename preview accurately lists all affected JIRA versions and config files
- [ ] Cascade rename completes all companion versions or clearly shows which failed
- [ ] Cleanup runs without false positives — it never modifies filters that reference valid releases
- [ ] Every destructive action requires two-step confirmation (preview then confirm)
