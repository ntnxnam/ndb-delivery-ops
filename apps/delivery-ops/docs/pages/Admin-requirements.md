# Team Management — Requirements

**Route**: `/team-management` (`/admin` redirects here)  
**Component**: `AdminPanel`  
**Permission**: `ADMIN_PANEL_ACCESS`  
**Audience**: app admin only (currently: namratha.singh + designated ops leads)

---

## Purpose

The Admin Panel provides app configuration and team onboarding management without requiring server restarts or file edits. It covers user permission management, team management (adding and editing teams, starting from each team's JIRA base filter), and app-level diagnostics.

---

## User Stories

| ID | Story |
|----|-------|
| AP-01 | As an admin, I can add or remove users from permission groups without editing JSON files by hand. |
| AP-02 | As an admin, I can add a team by typing only its name and base filter; everything else is detected from the base filter and I confirm it. |
| AP-07 | As an admin, the team's main JIRA project, release versions, scrum board and sprint calendar are detected from the base filter, and I can pick a different board if the guess is wrong. |
| AP-08 | As an admin, I can see the team's FEAT components (from `(<baseFilter>) AND project = FEAT`) and their primary components, and choose which components belong to the team (a team can own several). |
| AP-09 | As an admin, the team code is generated from the team name; I can override it on create, and it never changes after. |
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

### Team list (`TeamList`)
- One card per team: code, project, KPI count, sprint board + calendar, base filter, derived sprint scope, components.
- **Test** runs project / versions / base filter / sprint scope checks against JIRA.

### Team form (`TeamForm` + `DetectedConfig`)
- Inputs: **Team name** (fills **Team code** until the code is edited; code is read-only when editing) and **Base filter**.
- **Detect** (`POST /api/admin/inspect-base-filter`) shows:
  - Main project (most common project in the filter's tickets, with its share) — selectable if the filter spans several.
  - Release versions in that project (unreleased first). No version patterns.
  - Sprint scope = base filter without ORDER BY and its trailing `statusCategory != Done`.
  - Scrum board + sprint calendar; picking another board re-reads the calendar.
  - FEAT components with their primary components (CF "Primary Component"); all checked by default.
- Save is disabled until the current base filter has been detected and a project + sprint calendar are known. Editing a team without changing its base filter does not require Detect.
- Saved fields: `name`, `baseFilter`, `projectKey`, `boardId`, `sprintCalendar`, `featureComponents`. Legacy `projectType`, `versionPatterns`, `sprintBaseFilter` are removed on save; per-team `allowedUsers.json` lists are no longer written.

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
- Non-admin users attempting to reach `/team-management` see a "Permission denied" wall

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Adding a user already in a group | Show "User already in this group" inline; no duplicate added |
| Base filter is invalid JQL or matches no tickets | Detect shows the JIRA message; nothing is saved |
| Base filter spans several projects | Most common project is preselected; the dropdown lists the others with their share |
| Project has no scrum board, or the board has no dated sprints | Board section shows the reason; admin enters a board ID to read its calendar. Save stays disabled without a calendar |
| No FEAT tickets match the base filter | Components section says none were found; team saves without `featureComponents` |
| Versions or FEAT lookup fails | That section shows its error; the rest of Detect still works |
| Team code already exists | Create returns 409 and the form shows "Team already exists" |
| Team is missing `sprintCalendar` | Team list flags it; create/update is rejected until a calendar is detected |
| Cache clear while sync is running | Server returns 409 Conflict; show "Sync in progress — wait until complete" |
| `teamBoardConfig.json` write fails (disk full) | Show "Config save failed — check server disk" |
| New team saved | Team dropdown updates immediately (not auto-applied). Admin shows a short confirmation telling the admin to click Fetch. Opening Admin also syncs any teams that were added earlier in the session. |

---

## Acceptance Criteria

- [ ] Permission changes take effect within one browser refresh (no server restart required)
- [ ] Adding a team needs only a name and a base filter; project, board, calendar and components come from Detect
- [ ] Save is blocked until the current base filter has been detected
- [ ] Creating a team without `sprintCalendar` is rejected
- [ ] Saved teams contain no `projectType`, `versionPatterns` or `sprintBaseFilter`
- [ ] Sprint reports and KPIs use the sprint scope derived from the base filter
- [ ] Cache metadata shows accurate last-sync timestamp
- [ ] All destructive actions (delete user, clear cache) require two-step confirmation
- [ ] Admin panel is completely inaccessible to non-admin users (route guard + server validation)
- [ ] Creating or editing a team updates the global Team dropdown in the same session
