# Team Management — Requirements

**Route**: `/team-management` (`/admin` redirects here)  
**Component**: `AdminPanel`  
**Permission**: `ADMIN_PANEL_ACCESS`  
**Audience**: app admin only (currently: namratha.singh + designated ops leads)

---

## Purpose

The Admin Panel provides app configuration and team onboarding management without requiring server restarts or file edits. It covers user permission management, team management (adding and editing teams via structured filter/sprint/people inputs that auto-generate the team's JIRA base JQL), and app-level diagnostics. D43 multi-team registry lives in `server/config/teamBoardConfig.json`; NDB (`ERA,NDBECO` private) is the default tenant.

---

## User Stories

| ID | Story |
|----|-------|
| AP-01 | As an admin, I can add or remove users from permission groups without editing JSON files by hand. |
| AP-02 | As an admin, I can add a team by choosing its project type (Shared vs `ERA,NDBECO` private), picking ≥1 components (validated across ENG + 10 horizontals), and entering Leadership DLs (PM/Dev/QA 3) + 8 role contacts — the Base JQL is auto-generated and previewed, not hand-pasted. |
| AP-07 | As an admin, I can set the team's sprint board + 21-day calendar + S1 base date (auto-detect from project or `Load Calendar` by board number, recent-10 median → 21d). |
| AP-08 | As an admin, I pick ≥1 components via chips (Atlas suggestions, blur-add, paste comma-separated); the preview shows `component in (…) OR "primary component" in (…)` for that team. |
| AP-09 | As an admin, the team code is generated from the team name; I can override it on create, and it never changes after. |
| AP-10 | As an admin, the 3 Leadership Outlook DLs (PM, Dev, QA) are auto-included in JQL `assignee in (membersOf(PM) OR membersOf(Dev) OR membersOf(QA))` inner OR — no re-typing in Contacts — and also drive email distribution. |
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

### Team form (`TeamForm` — filter/sprint/people, no manual `filter=` paste)

> JQL SoT: `shared/src/services/teamBaseJqlService.ts` (`SHARED_PROJECTS_ALL` = `ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR` = 10, `LEGACY=[]`) + `server/services/teamAdminService.js:buildBaseJqlFromTeam` server parity + `TeamForm.js:buildPreview`/`formatJql` client parity. Sprint SoT: `server/utils/sprintCalendar.js:collectSprintCalendarFromBoard` → `inferSprintCalendarFromSprints` recent-10 median snapped 7/14/21 default 21d.

- **Inputs — identity:** **Team Name** (fills **Team code** slug until code is edited; code read-only when editing; `id` = slug lower/dash max 40) + **Project Type** radio: *Shared Project* (`is_shared_project:true`, `custom_project_key:null`) vs *Not Shared / Custom* (`is_shared_project:false`, `custom_project_key: "ERA,NDBECO"` comma-separated, uppercased, `^[A-Z][A-Z0-9_]+$` per key; e.g. `ERA,NDBECO` for NDB). NDB private sample: `(project in (ERA, NDBECO) OR (project in (ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR) AND (inner OR)))`.
- **Inputs — filter (components):** **Components** chips `*` (≥1 required, validated across ENG + 10 horizontals via `GET /rest/api/2/project/{key}/components` + `KNOWN_COMPONENTS` Atlas suggestions) → `component in (…) OR "primary component" in (…)` . `ChipInput` adds on `Enter` / `,` / `paste` comma-separated / `blur` (typing without commit still saved), `×` 24px remove, suggestion dropdown.
- **Inputs — people (Leadership 3 DLs → assignee):** **Leadership DLs — PM / Dev / QA (3)** dedicated inputs (`pmDL`/`devDL`/`qaDL` → `leader_outlook_dls:string[0..3]` trimmed/deduped) auto → `assignee in (membersOf("PM") OR membersOf("Dev") OR membersOf("QA"))` inner OR — no re-typing in Contacts, also for email distribution. Shows `Auto → assignee in (membersOf("PM") OR …)` note.
- **Inputs — people (8 role rows → assignee):** **Role / Function Contacts** 8 rows `team`/`serv_team`/`doc_team`/`security_team`/`legal`/`documentation`/`trade_compliance`/`others` each `{entries:string[], isDL:boolean}` via `ChipInput` + `DL` checkbox (`→ membersOf` vs `→ handle` label) → combined via `dedupeTrim` into `assignee in (membersOf(DLs) OR handles)` inner-ORed with `component`/`"primary component"`/`issuetype in ("Era Oncall","ERA Oncall")` by `buildInnerOr`. Save translates every visible chip/DL — chip appearing but JQL not updating is a bug (weave.mdc 2026-11-24 learning).
- **Preview — auto-generated Base JQL:** live preview `buildPreview({isShared,customKey,components,contactRows,leaderDLs})` formatted via `formatJql` (indented 2-space per `(`/`OR`/`AND`, `<pre>` with **Copy**); editable **Base Filter** textarea defaults to preview (`baseFilterTouched` guard preserves manual edit; **Reset to preview** restores). Saved as both `base_jql` + `baseFilter` (compat); if omitted, server regenerates via `buildBaseJqlFromTeam`. Shared shape: `project in (shared 10) AND (component OR "primary component" OR assignee OR issuetype)`; Private shape: `(project in (ERA,NDBECO) OR (project in (shared 10) AND (component OR "primary component" OR assignee OR issuetype)))`.
- **Inputs — sprint (board + duration + base date):** **Sprint Board — for full team** row: **Board #** (numeric, from Jira Agility board URL) + **Sprint duration** (number 1–90, placeholder `21 days`, default 21) + **Base date S1** (date `YYYY-MM-DD`) → **Load Calendar** (`POST /api/admin/board-calendar` {boardId} → `collectSprintCalendarFromBoard` paginates `GET /rest/agile/1.0/board/{id}/sprint` 50/page max 4 pages) and **Auto-detect from project** (`POST /api/admin/project-scope` {projectKey} → best board by `projectKeyOrId`) → `inferSprintCalendarFromSprints` uses **recent 10** sprints median `daysBetween(start,end)+1` snapped via `snapSprintDays` (6–9→7, 13–16→14, 19–22→21 else rounded, fallback 21) — so 15×14d old + 8×21d recent → 21d correctly. Named `S1`/`Sprint 1` preferred else earliest dated sprint; undated boards return `calendarError` → manual fallback shown (`Could not detect calendar — fill manually`). Success shows `S1 2022-12-06 · 21 days` pill; `parseSprintCalendar` validates ISO + 1–90; now optional on Save (auto-detect on first fetch).
- **Save:** disabled until `name` + `teamId` + `components ≥1` + (`isShared` or `customKey`) valid; `handleSave` builds `payload {name,is_shared_project,custom_project_key,components,leader_outlook_dls,contacts,boardId,sprintCalendar,baseFilter,base_jql,projectKey}` → `POST /api/admin/teams` (create) / `PUT /api/admin/teams/:id` (edit, `id` ignored) → success upserts into `TeamContext` + shows `Team is now in dropdown. Click Fetch.` notice. Legacy `projectType`/`versionPatterns`/`sprintBaseFilter` stripped on save; `teamBoardConfig.json` mtime cache invalidated.
- **Legacy Detect flow still available:** `POST /api/admin/inspect-base-filter` / `project-scope` / `board-calendar` remain for diagnostics and for older `filter=…` teams, but the primary add/edit path is now component/people/sprint-driven generation (no manual `filter=` paste).

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
| Components empty (`components` <1) | Save blocked; inline `Add at least one component`; server rejects `400 components is required` |
| `is_shared_project=false` but `custom_project_key` empty/invalid | Save blocked; inline `Custom project key is required`; server `400 custom_project_key is required …` / bad pattern |
| Leadership DL typed but not in preview | Bug — Leader DLs must appear as `membersOf` inner OR immediately; fix `leaderDLs` → `buildPreview` parity (2026-11-24 fix) |
| Chip typed but not committed (no Enter) | Fixed 2026-11-24: `ChipInput:onBlurAdd` commits on blur — Save translates every visible token; preview updates live |
| Base filter is invalid JQL or matches no tickets (legacy Detect) | Detect shows the JIRA message; nothing is saved |
| Base filter spans several projects (legacy Detect) | Most common project is preselected; the dropdown lists the others with their share. Choosing another project, or typing a project key, reloads that project's versions, boards, and components |
| Project has no scrum board, or the board has no dated sprints | Board section shows `calendarError` then asks for S1 start date and sprint length; Save allowed (calendar optional — auto-detect on first board fetch), but list flags missing calendar |
| Project board list is mostly other teams (shared project such as ERA) | Dropdown shows boards whose names match the team. “Show other boards” reveals the rest (legacy Detect) |
| Selected project has no components | Components section says none were found; legacy flow would save without `featureComponents`; new flow requires ≥1 component via chips |
| Versions or FEAT lookup fails | That section shows its error; the rest of Detect still works |
| Team code already exists | Create returns 409 and the form shows "Team already exists" |
| Team is missing `sprintCalendar` | Team list shows `no sprint calendar`; create no longer rejected (now optional — will auto-detect), but sprint features use fallback 21d |
| Cache clear while sync is running | Server returns 409 Conflict; show "Sync in progress — wait until complete" |
| `teamBoardConfig.json` write fails (disk full) | Show "Config save failed — check server disk" |
| New team saved | Team dropdown updates immediately (not auto-applied). Admin shows a short confirmation telling the admin to click Fetch. Opening Admin also syncs any teams that were added earlier in the session. |

---

## Acceptance Criteria

- [ ] Permission changes take effect within one browser refresh (no server restart required)
- [ ] Adding a team generates Base JQL from `is_shared_project` + `custom_project_key` (e.g. `ERA,NDBECO`) + `components` (≥1 validated across ENG+10 horizontals) + `leader_outlook_dls[3]` PM/Dev/QA + 8 contacts rows → `component OR "primary component" OR assignee in (membersOf(PM/Dev/QA+DLs)+handles) OR issuetype` inner OR (shared 10 = `ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR`); NDB `(project in (ERA,NDBECO) OR (project in (shared 10) AND (…)))` matches agreed sample
- [ ] Leadership DLs (PM/Dev/QA 3) auto-appear in preview `assignee in (membersOf(…))` without re-typing in Contacts; ChipInput commits on blur
- [ ] Sprint inferred from recent 10 sprints median snapped 7/14/21 default 21d (not full-history 14d bias); `boardId` + `sprintDays` + `s1StartIso` via Load/Auto-detect or manual 21-day input
- [ ] Preview indented (`formatJql` 2-space per `(`/`OR`/`AND` in `<pre>` with Copy/Reset); manual Base Filter override preserved via `baseFilterTouched` but defaults to preview
- [ ] Saved teams contain `is_shared_project`/`custom_project_key`/`components`/`leader_outlook_dls`/`contacts`/`base_jql`+`baseFilter`/`boardId`/`sprintCalendar`; no `projectType`/`versionPatterns`/`sprintBaseFilter`
- [ ] Sprint reports and KPIs use the sprint scope derived from `baseFilter` (strip `ORDER BY` + trailing `statusCategory != Done`) and `sprintCalendar` 21d cadence
- [ ] Cache metadata shows accurate last-sync timestamp
- [ ] All destructive actions (delete user, clear cache) require two-step confirmation
- [ ] Admin panel is completely inaccessible to non-admin users (route guard + server validation)
- [ ] Creating or editing a team updates the global Team dropdown in the same session
