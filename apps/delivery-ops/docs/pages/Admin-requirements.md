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
| AP-08 | As an admin, I pick the team's project from the project codes in the base filter, then choose which of that project's component names belong to the team. |
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
  - Main project (most common project in the filter's tickets, with its share) — selectable if the filter spans several. The admin can also type a project key that is not in that list.
  - Release versions in that project (unreleased first). No version patterns.
  - Sprint scope = base filter without ORDER BY and its trailing `statusCategory != Done`.
  - Scrum board + sprint calendar. The dropdown lists boards whose names match the team, and the admin can type a board number directly. Other boards on that JIRA project stay behind “Show other boards”, because a shared project otherwise lists every team’s boards. Picking or typing a board re-reads the calendar. If the board has no dated sprints, the admin enters the S1 start date and sprint length.
  - Component names from the selected JIRA project (`GET /project/{key}/components`), shown in columns. A filter narrows the list. All are checked; uncheck individuals, or Unselect all.
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
| Base filter spans several projects | Most common project is preselected; the dropdown lists the others with their share. Choosing another project, or typing a project key, reloads that project's versions, boards, and components |
| Project has no scrum board, or the board has no dated sprints | Board section shows the reason and asks for an S1 start date and sprint length. Save stays disabled until both are valid |
| Project board list is mostly other teams (shared project such as ERA) | Dropdown shows boards whose names match the team. “Show other boards” reveals the rest |
| Selected project has no components | Components section says none were found; team saves without `featureComponents` |
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
