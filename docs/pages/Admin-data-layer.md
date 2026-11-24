# Team Management — Data Layer & Middleware Contract

**Route**: `/team-management` (`/admin` redirects here)  
**Server routes used**: `server/routes/admin.js`, `server/routes/releaseDataset.js` (cache endpoints)  
**Config files modified**: `server/config/allowedUsers.json` (permission groups only), `server/config/teamBoardConfig.json`, `server/config/kpiConfig.json` (new team entry)

---

## API Calls (client → server)

### 1. Fetch current permissions / user list

```
GET /api/admin/users
Headers: x-jira-token, x-username
```

**Server flow**: `admin.js → reads allowedUsers.json` → returns structured permission map  
**Returns**:
```json
{
  "users": {
    "namratha.singh": ["allowedUsers", "kpiTabAllowedUsers", "adminUsers"],
    "john.doe": ["allowedUsers"]
  },
  "groups": {
    "allowedUsers": ["namratha.singh", "john.doe"],
    "kpiTabAllowedUsers": ["namratha.singh"],
    "adminUsers": ["namratha.singh"]
  }
}
```

---

### 2. Add user to permission group

```
POST /api/admin/users/add
Headers: x-jira-token, x-username
Body: { username, group }
```

**Server flow**: `admin.js → reads allowedUsers.json → adds user to specified group → writes file`  
**Returns**: `{ success: true, users: { ...updated } }`

---

### 3. Remove user from permission group

```
DELETE /api/admin/users/remove
Headers: x-jira-token, x-username
Body: { username, group }
```

**Server flow**: same as add but removes from array  
**Guard**: server prevents removing the last admin from `adminUsers`

---

Client hooks: `useTeamAdmin` (list / save / test) and `useTeamDetect` (detect / board calendar), both via `authenticatedGet` / `authenticatedPost` / `authenticatedPut` (request gate). Full contracts: `docs/api/admin.md`.

### 4. Team form — JQL generated from structured inputs (filter/sprint/people, 2026-11-24) + legacy Detect

> **SoT:** client `TeamForm.js:buildPreview` + server `teamAdminService.js:buildBaseJqlFromTeam` (parity via `shared/src/services/teamBaseJqlService.ts:buildInnerOr`). Teams Config no longer requires pasting `filter=NDB-All-Base-Filter` — JQL is generated from `is_shared_project` + `custom_project_key` + `components` + `leader_outlook_dls[3]` + 8 contacts rows + `issuetype`. Sprint = `boardId` + `sprintCalendar:{s1StartIso,sprintDays}` (21d default, recent-10 median).

#### 4a. Primary path — structured inputs → preview → Save (no JIRA Detect needed)

```
POST /api/admin/teams            (create)
PUT  /api/admin/teams/:teamId    (edit)
Body: { name, is_shared_project, custom_project_key, components, leader_outlook_dls[3], contacts{8×{entries,isDL}}, baseFilter/base_jql (derived preview), boardId, sprintCalendar:{s1StartIso,sprintDays} }
```

- **Filter shape (shared 10):** `ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR` SoT `SHARED_PROJECTS_ALL` (10, `LEGACY=[]`). NDB private `ERA,NDBECO` → `(project in (ERA, NDBECO) OR (project in (shared 10) AND (component in (…) OR "primary component" in (…) OR assignee in (membersOf(PM) OR membersOf(Dev) OR membersOf(QA) OR membersOf(contact DLs) OR handles) OR issuetype in ("Era Oncall","ERA Oncall"))))`. `components` ≥1 validated across ENG+10.
- **People → assignee inner OR:** `leader_outlook_dls` (PM/Dev/QA 3 distinct inputs, `ChipInput` blur-add, deduped → `membersOf` ) + 8 contact rows (`team`/`serv_team`/`doc_team`/`security_team`/`legal`/`documentation`/`trade_compliance`/`others` each `{entries[],isDL}`) → single `assignee in (…)` inner-ORed with `component`/`"primary component"`/`issuetype`. Client `buildPreview` and server `buildInnerOr` must agree — regression if preview JQL ≠ saved `base_jql`.
- **Sprint board/calendar:** trio `boardId` (number from Jira Agility URL, `inputMode=numeric`) + `sprintDays` (1–90, default 21, placeholder `21 days`) + `s1StartIso` (`YYYY-MM-DD` date input). **Load Calendar** → `POST /api/admin/board-calendar` {boardId} → `collectSprintCalendarFromBoard` paginates `GET /rest/agile/1.0/board/{id}/sprint` (50/page, max 4 pages) → `inferSprintCalendarFromSprints` uses **recent 10** median snapped `snapSprintDays` (6–9→7,13–16→14,19–22→21 else round, fallback 21) — fixes old 14d bias where 15×14d + 8×21d incorrectly kept 14d. **Auto-detect from project** → `POST /api/admin/project-scope` {projectKey} → best board. `parseSprintCalendar` validates ISO + 1–90; `sprintCalendar` now optional on Save (manual override allowed).
- **Preview UX:** `previewJql = buildPreview(...)` live indented via `formatJql` (2-space per `(`/`OR`/`AND`, `<pre>` 240px, word-break) with **Copy** (clipboard) + `baseFilter` textarea defaulting to preview (`baseFilterTouched` guard preserves manual override; **Reset to preview** restores). Saved as both `base_jql` + `baseFilter` for compat.

#### 4b. Legacy path — detect settings from a hand-pasted base filter (still supported for older teams)

```
POST /api/admin/inspect-base-filter
Headers: Authorization Bearer, X-Username
Body: { baseFilter, name?, boardId? }
```

**Server flow**: `admin.js → teamInspectService.inspectBaseFilter` →
- `GET /rest/gadget/1.0/stats/generate?statType=project` (every project in the base filter; search pagination is the fallback) → main project by count
- `getProjectVersions(project)` → total + unreleased names
- `GET /rest/agile/1.0/board?projectKeyOrId=&type=scrum` → board pick → `collectSprintCalendarFromBoard` (recent-10 → 21d)
- `GET /rest/api/2/project/{projectKey}/components` → component names for the selected project

**Returns**: `{ baseFilter, sprintScope, issueCount, projects, projectKey, versions, board, feature }`

Changing the JIRA project dropdown, or typing a project key, calls `POST /api/admin/project-scope` with `{ projectKey, name }` and replaces versions, boards, and components. A typed key does not have to be one of the projects Detect listed.

#### 4c. Team form — calendar for a manually chosen board

```
POST /api/admin/board-calendar
Body: { boardId }
```

**Returns**: `{ boardId, boardName, sprintCalendar, inferredFrom, sprintCount }` (or `sprintCalendar: null` + `calendarError`). `inferredFrom: {sprintCount, namedS1, namedS1Name}`; `sprintDays` reflects recent-10 median (e.g. 15×14d old + 8×21d recent → 21).

---

### 5. Team form — save team (Teams Config 2026-11-24 — structured filter/sprint/people → generated JQL)

```
POST /api/admin/teams            (create)
PUT  /api/admin/teams/:teamId    (edit)
Headers: x-jira-token, x-username
Body: { id? (create only), name, is_shared_project, custom_project_key, components, leader_outlook_dls[3], contacts{8×{entries,isDL}}, base_jql/baseFilter (generated preview || edited), projectKey (derived), boardId, sprintCalendar: { s1StartIso, sprintDays }, featureComponents? }
```

**Client payload (TeamForm.js:handleSave):** `payload = { name: name.trim(), is_shared_project: isShared, custom_project_key: isShared? null : customKey.trim().toUpperCase(), components, leader_outlook_dls: leaderDLs[0..3] (pmDL/devDL/qaDL), contacts: {team,serv_team,doc_team,security_team,legal,documentation,trade_compliance,others} each {entries,isDL}, boardId: Number(boardId)||null, sprintCalendar, baseFilter: baseFilter.trim()||previewJql, base_jql: baseFilter.trim()||previewJql, projectKey: isShared? "ENG" : customKey.split(",")[0].toUpperCase() }`

**Server flow**: `admin.js → teamAdminService.createTeam / updateTeam` → normalize `components`/`custom_project_key`/`leader_outlook_dls`/`contacts` via `dedupeTrim`/`parseCommaList`/`normalizeContacts` → **generate** `base_jql`/`baseFilter` via `buildBaseJqlFromTeam` (`teamBaseJqlService.buildInnerOr` parity with client: `component in (…) OR "primary component" in (…) OR assignee in (membersOf(PM/Dev/QA+DLs)+handles) OR issuetype`) unless caller supplied `baseFilter` → validate `is_shared_project=false` requires `custom_project_key` valid `PROJECT_KEY_PATTERN`, `components` ≥1 (else `400 components is required`), `sprintCalendar` via `parseSprintCalendar` if present (now optional, ISO `YYYY-MM-DD` + 1–90, default 21) → strip legacy fields (`projectType`,`versionPatterns`,`sprintBaseFilter`) → `saveTeamBoardConfig` (create also adds empty KPI list in `kpiConfig.json`). `allowedUsers.json` is not written.
**Returns**: `{ success: true, team: { id, name, is_shared_project, custom_project_key, components, leader_outlook_dls, contacts, base_jql, baseFilter, projectKey, boardId, sprintCalendar } , message }`
**Side effect**: `saveTeamBoardConfig` invalidates the mtime cache so Project Status / version lists see the new team on the next request without a restart. The Admin UI also `upsertTeam`s / `updateTeam`s into `TeamContext`. The new team is **not** auto-applied; the admin clicks **Fetch**. D43: this file is a multi-team registry — Save must persist to disk, not only the browser dropdown.

### 5b. Test a saved team

```
POST /api/admin/test-team-config
Body: { teamId }
```

**Returns**: `results.{ projectAccess, versionAccess, baseFilter, sprintScope }`, each `{ valid, ... }`.

---

### 6. Fetch cache metadata

```
GET /api/release-dataset/sync-status?productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → reads shared/.cache/release-dataset/ndb/bundle.meta.json`  
**Returns**:
```json
{
  "lastSync": "2026-06-15T06:00:00Z",
  "releaseCount": 18,
  "bundleSizeBytes": 4200000,
  "productId": "ndb"
}
```

---

### 7. Clear cache

```
DELETE /api/release-dataset/cache?mode=bundle&productId=ndb
Headers: x-jira-token, x-username
```

`mode=bundle` — deletes only the bundle JSON (per_release + bundle.json)  
`mode=full` — deletes entire product cache directory

---

### 8. Trigger sync

```
POST /api/release-dataset/sync?productId=ndb
Headers: x-jira-token, x-username
```

Returns a Server-Sent Events stream with progress updates. Admin UI shows live progress log.

---

## Config Files

### `server/config/allowedUsers.json`
```json
{
  "allowedUsers": ["namratha.singh", "john.doe"],
  "kpiTabAllowedUsers": ["namratha.singh"],
  "adminUsers": ["namratha.singh"],
  "releaseSetupUsers": ["namratha.singh"]
}
```

### `server/config/teamBoardConfig.json`
One entry per product/team. Written by the team form. Used by `teamConfig.js` and `productService`. D43 — `defaultTeamId` picks the landing team.

```json
{
  "id": "ndb",
  "name": "NDB",
  "is_shared_project": false,
  "custom_project_key": "ERA,NDBECO",
  "components": ["NDB","Era","NDB Databases","NDB Service"],
  "leader_outlook_dls": ["Team-PM-Org","Team-Dev-Org","Team-QA-Org"],
  "contacts": { "team": { "entries": ["Team-Ashish-Mohindroo-Org"], "isDL": true }, "serv_team": { "entries": [], "isDL": false } },
  "base_jql": "(project in (ERA, NDBECO) OR (project in (ENG, FEAT, ONCALL, TH, SDL, TECHPUBS, SR, LEG, ACP, LBDR) AND (component in (NDB) OR \"primary component\" in (\"NDB\") OR assignee in (membersOf(\"Team-PM-Org\")) OR issuetype in (\"Era Oncall\"))))",
  "baseFilter": "(project in (ERA, NDBECO) OR (...))",
  "projectKey": "ERA",
  "boardId": 2888,
  "sprintCalendar": { "s1StartIso": "2022-12-06", "sprintDays": 21 },
  "featureComponents": { "NDB": ["DB Migration","NDB-API-Infra"], "Era": ["Era-Platform"] },
  "homeProjects": ["NDB","ERA","FEAT"],
  "releasePrefixes": ["NDB-"],
  "labels": { "notPor": "ndb-not-por" }
}
```

Legacy shape `baseFilter: "filter=NDB-All-Base-Filter and statusCategory!=Done"` is still read as fallback but new teams store generated JQL in both `base_jql` + `baseFilter` (compat); `components`/`is_shared_project`/`custom_project_key`/`leader_outlook_dls`/`contacts` are the new SoT for regeneration. Shared 10 = `ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR` (`teamBaseJqlService.ts:SHARED_PROJECTS_ALL`, `LEGACY=[]`), private `ERA,NDBECO` per NDB sample. The sprint scope is never stored: `sprintScopeFromBaseFilter(baseFilter)` (server `utils/teamScope.js`, shared `utils/teamScope.ts`) removes ORDER BY and a trailing `statusCategory != Done`. Sprint calendar default is **21d** (snapped 7/14/21, recent-10 median, `sprintCalendar.js:107,110`).

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Non-admin calling admin endpoints | 403 | "Permission denied" |
| allowedUsers.json write fails | 500 | "Config save failed — manual edit required" |
| Removing last admin | 400 | "Cannot remove the last admin user" |
| `components` empty or `is_shared_project=false` with blank `custom_project_key` | 400 | Team form shows `Add at least one component` / `Custom project key is required` |
| Base filter invalid or matches no tickets (legacy Detect) | 400 | Team form shows the JIRA message |
| Board / versions / FEAT lookup fails during Detect | 200 (inline `error` / `calendarError`) | That section shows the error; a missing sprint calendar asks for S1 start date and sprint length (now optional — manual 21d fallback) |
| Team code already exists | 409 | Team form shows "Team already exists" |
| Cache clear while sync running | 409 | "Sync in progress — cannot clear cache now" |
| teamBoardConfig.json write fails | 500 | "Team config save failed" |
