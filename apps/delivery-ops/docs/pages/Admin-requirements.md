# Admin Panel — Requirements

**Route**: `/admin`  
**Component**: `AdminPanel`  
**Permission**: `ADMIN_PANEL_ACCESS`  
**Audience**: app admin only (currently: namratha.singh + designated ops leads)

---

## Purpose

The Admin Panel provides app configuration and team onboarding management without requiring server restarts or file edits. It covers user permission management, team onboarding (adding new teams to the config), and app-level diagnostics.

---

## User Stories

| ID | Story |
|----|-------|
| AP-01 | As an admin, I can add or remove users from permission groups without editing JSON files by hand. |
| AP-02 | As an admin, I can onboard a new team — providing their JIRA sprint board ID, sprint calendar (S1 start + length), base filter, and display name — through a wizard. |
| AP-07 | As an admin, I can detect sprint calendar (`s1StartIso`, `sprintDays`) from a team's JIRA sprint board so velocity/forecast/sync never fail with a missing calendar. |
| AP-03 | As an admin, I can test JIRA connectivity and see which endpoints are reachable. |
| AP-04 | As an admin, I can view and clear the server-side release dataset cache. |
| AP-05 | As an admin, I can see the current permission assignments for all users in one view. |
| AP-06 | As an admin, a team I just created or edited appears in the global Team dropdown without a browser refresh. |

---

## Sub-components

### Permission Management
- List all users and their current permission groups
- Add user to a permission group
- Remove user from a permission group
- Shows which `allowedUsers.json` list each permission maps to

### Team Onboarding Wizard (`TeamOnboardingWizard`)
- Step 1: Team name + JIRA project + **sprint board** (board ID, S1 start date, sprint length). **Detect from board** reads the Agile board's sprints and fills the calendar.
- Step 2: Version patterns (parent projects)
- Step 3: User / permission lists
- Step 4: Base filters
- Step 5: Test + save → writes to `teamBoardConfig.json` via server API, including `sprintCalendar`

### JIRA Connection Test
- Tests JIRA auth for the current admin user
- Shows which JIRA endpoints are reachable
- Returns JIRA API version and rate limit status

### Cache Management
- Shows bundle file metadata: last sync date, size, release count
- "Clear bundle" button (mode=bundle)
- "Clear full cache" button (mode=full) with extra confirmation
- "Trigger sync" button — runs `releaseDataset/sync` for the default product

---

## Permissions

- Requires `ADMIN_PANEL_ACCESS` — only accounts listed in `allowedUsers.json::adminUsers`
- Sub-actions within Admin (e.g., delete user) have an additional confirm modal
- Non-admin users attempting to reach `/admin` see a "Permission denied" wall

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Version pattern is a glob like `msp*` or `*msp*` | Treat `*` as a wildcard; never throw (`Nothing to repeat`); Admin Test and version dropdowns keep working |
| Adding a user already in a group | Show "User already in this group" inline; no duplicate added |
| Onboarding wizard — JIRA board ID doesn't exist | Detect from board fails with "Board not found" |
| Team is missing `sprintCalendar` | Team list shows "Missing — Edit team and detect from the sprint board"; create/update is rejected until calendar is collected |
| Cache clear while sync is running | Server returns 409 Conflict; show "Sync in progress — wait until complete" |
| `teamBoardConfig.json` write fails (disk full) | Show "Config save failed — check server disk" |
| New team saved | Team dropdown updates immediately (not auto-applied). Admin shows a short confirmation telling the admin to click Fetch. Opening Admin also syncs any teams that were added earlier in the session. |

---

## Acceptance Criteria

- [ ] Permission changes take effect within one browser refresh (no server restart required)
- [ ] Team onboarding wizard validates JIRA board ID before saving
- [ ] Team onboarding wizard collects `sprintCalendar` (detect from board or manual entry) and persists it on the team
- [ ] Creating a team without `sprintCalendar` is rejected
- [ ] Cache metadata shows accurate last-sync timestamp
- [ ] All destructive actions (delete user, clear cache) require two-step confirmation
- [ ] Admin panel is completely inaccessible to non-admin users (route guard + server validation)
- [ ] Creating or editing a team updates the global Team dropdown in the same session
