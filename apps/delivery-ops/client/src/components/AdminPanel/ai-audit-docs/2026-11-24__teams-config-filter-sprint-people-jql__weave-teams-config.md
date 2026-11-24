---
page: AdminPanel
route: /team-management
source: apps/delivery-ops/client/src/components/AdminPanel
weave: weave-teams-config
date: 2026-11-24
author: namratha.singh (human) + loom-builder (AI)
models: [internal-model]
goal: "Teams Config filter/sprint/people JQL — PM/Dev/QA 3 DLs auto-included, shared 10, sprint 21d (recent-10 median)"
audience: admin
---

# 2026-11-24 — Team Management — teams-config-filter-sprint-people-jql

## Prompt (verbatim)
> Teams Config filter/sprint/people JQL with PM/Dev/QA 3 DLs auto-included, shared 10, sprint 21d. Ensure AI audit trail for AdminPanel page per aiAudit.config.json via scripts/loom/ai-audit/new-entry.sh, fill Mistakes & Corrections, update docs/ai-audit/LEARNINGS.md if cross-page, regenerate INDEX.md + timeline.md, run node scripts/lighthouse/docs/docs-build.js and bash scripts/lighthouse/docs/docs-verify.sh.

## Goal → Done When
- Filter: `is_shared_project` + `custom_project_key` (NDB `ERA,NDBECO` private) + `components` validated across ENG+10 horizontals `ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR` generates JQL matching agreed NDB sample `(project in (ERA,NDBECO) OR (project in (shared 10) AND (component OR "primary component" OR assignee in (membersOf(PM/Dev/QA+DLs/handles) OR issuetype)))`; `teamBoardConfig.json` NDB entry matches sample.
- People: 3 Leadership DL inputs PM/Dev/QA (`pmDL`/`devDL`/`qaDL` → `leader_outlook_dls[3]`) auto → `assignee in (membersOf(PM) OR membersOf(Dev) OR membersOf(QA))` inner OR with 8 contact rows (`team`/`serv_team`/`doc_team`/`security_team`/`legal`/`documentation`/`trade_compliance`/`others` each `{entries,isDL}`), no re-typing; preview updates live.
- Sprint: full-team `boardId` + `sprintDays` (21d default) + `s1StartIso` via Load/Auto-detect; inference uses recent-10 median snapped 7/14/21 (15×14d old + 8×21d recent → 21d); manual override allowed.
- Docs 5 surfaces updated: Known Issues (lastUpdated 2026-11-24), Release Notes (Unreleased weave/teams-config), User Guide + HTML, Admin Guide + HTML, Tech Guide, plus `docs/api/admin.md` + `docs/pages/Admin-*` per page-docs-required/api-docs-required.
- AI audit trail: this entry via `new-entry.sh --page AdminPanel --slug teams-config-filter-sprint-people-jql --weave teams-config`, Mistakes & Corrections filled, LEARNINGS.md updated if cross-page, INDEX.md + timeline.md regenerated, `docs-build.js` and `docs-verify.sh` pass.

## AI Config Snapshot
- `aiConfig.json` — NAI Enterprise gateway `beam-1-501b`, `maxTokens 8192`, key via `NAI_API_KEY` env (no `AI_*` fallback)
- `aiAudit.config.json` v1 — naming `YYYY-MM-DD__kebab-slug__weave-<slug>.md`, `pages.AdminPanel` → `apps/delivery-ops/client/src/components/AdminPanel/ai-audit-docs`
- Models used: `internal-model` (loom-builder for TeamForm JQL + sprint recent-10 + docs)
- Connectors touched: JIRA Agile (`GET /rest/agile/1.0/board/{id}/sprint`), JIRA Components (`GET /rest/api/2/project/{key}/components`)

## Changes
| File | Change |
|------|--------|
| `apps/delivery-ops/client/src/components/AdminPanel/TeamForm.js` | Split single `leaderDLs` ChipInput → 3 inputs `pmDL`/`devDL`/`qaDL` → `leaderDLs=[pmDL,devDL,qaDL].filter(Boolean)`; `buildPreview({leaderDLs})` adds `leaderDLParts=membersOf(PM/Dev/QA)` to `assignee in (…)` inner OR with 8 contact rows; `ChipInput:onBlurAdd` commits on blur; `formatJql` indented preview; sprint row `Board # + sprintDays(21) + S1 date` + Load/Auto-detect |
| `apps/delivery-ops/server/services/teamAdminService.js` | `SHARED_PROJECTS_ALL=['ENG','FEAT','ONCALL','TH','SDL','TECHPUBS','SR','LEG','ACP','LBDR']`; `buildBaseJqlFromTeam` collects `leader_outlook_dls` + contacts DLs/handles → `assignee in (…)` via shared `buildInnerOr` parity; `leader_outlook_dls` persist + normalize; private NDB `(project in (ERA,NDBECO) OR (project in (shared 10) AND (…)))` |
| `shared/src/services/teamBaseJqlService.ts` | Add `leaderOutlookDLs?: string[]` to `BuildBaseJqlParams`; `buildInnerOr` merges `leaderOutlookDLs` + `assigneeDLs` → `membersOf`; `HORIZONTAL_PROJECTS=['FEAT','ONCALL','TH','SDL','TECHPUBS','SR','LEG','ACP','LBDR']` + `SHARED_PROJECTS_ALL` SoT; private/shared JQL shapes per D1 |
| `apps/delivery-ops/server/utils/sprintCalendar.js` | `inferSprintCalendarFromSprints`: use `recent=dated.length>10 ? dated.slice(-10) : dated` median → `snapSprintDays` (6–9→7,13–16→14,19–22→21 else round, fallback 21); `collectSprintCalendarFromBoard` paginates 50/page max 4 pages; caps history to avoid timeout |
| `apps/delivery-ops/server/config/teamBoardConfig.json` | NDB entry: `is_shared_project:false`, `custom_project_key:"ERA,NDBECO"`, `components:["NDB","Era","NDB Databases","NDB Service"]`, `leader_outlook_dls:["Team-Ashish-Mohindroo-Org"]` (now 3 DLs shape), `base_jql`/`baseFilter` matching agreed `(project in (ERA,NDBECO) OR (project in (shared 10) AND (component OR "primary component" OR assignee in (membersOf(…)) OR issuetype)))`, `sprintCalendar:{s1StartIso:"2022-12-06",sprintDays:21}` |
| `agent-pack/lighthouse/context/pages/admin.md` | Update Leadership DLs: email-only → auto `assignee in (membersOf(PM/Dev/QA))` inner OR (fix stale note); keep UX rule + sprint recent-10 note |
| `docs/known-issues/KNOWN_ISSUES.md` | Bump `lastUpdated: 2026-05-19 → 2026-11-24`; update `Last verified` with Teams Config note; no new ticket |
| `docs/release-notes/RELEASE_NOTES.md` | Add `Unreleased — weave/teams-config` section: filter shared 10/private, people 8+3 DLs inner OR, sprint recent-10 21d, docs + verification |
| `docs/guides/USER_GUIDE.md` | Add `Team Management — Teams Config (Admin)` section: filter project type, components, PM/Dev/QA 3 DLs, 8 role rows, preview copy, sprint Board+Sprint duration+S1 21d |
| `docs/guides/ADMIN_GUIDE.md` | Update Config table Teams Config row (shared 10 + people 3+8 + sprint 21d recent-10 SoT) + new `Teams Config — filter/project + people/roles + sprint/board` section with JQL shapes table + people inner OR code block + sprint table (boardId/s1StartIso/sprintDays 21) + collection notes |
| `docs/technical/TECH_DESIGN.md` | Expand `10.1 Configuration Files` with `teamBoardConfig.json`/`kpiConfig.json`/`jiraFieldsConfig.json` + Teams Config SoT callout |
| `docs/api/admin.md` | Rewrite `POST /api/admin/teams` + `PUT /api/admin/teams/:teamId` + `GET /api/admin/teams` to document `is_shared_project`/`custom_project_key`/`components`/`leader_outlook_dls[3]`/`contacts{8×{entries,isDL}}`/`base_jql`/`sprintCalendar:{s1StartIso,sprintDays:21}` + JQL shapes (shared 10 vs private) + recent-10 sprint |
| `docs/pages/Admin-requirements.md` | Rewrite Purpose + AP-02/AP-07/AP-08/AP-09/AP-10 + Team form (`TeamForm — filter/sprint/people`) with shared 10/private, Leadership 3 DLs, 8 rows, sprint board+21d+S1 recent-10, preview indented, save/guard; update Edge Cases (components/DL blur/private/shared) + Acceptance Criteria |
| `docs/pages/Admin-data-layer.md` | Add §4 primary path (structured inputs → preview → Save) with filter/people→assignee inner OR + sprint board/calendar recent-10; keep §4b legacy Detect as fallback; rewrite §5 save payload + server flow (`buildBaseJqlFromTeam` + `buildInnerOr` parity); update `teamBoardConfig.json` example to new shape + sprint 21d; add 400 error for `components`/`custom_project_key` |

## Decisions & Alternatives Considered
- **Generated JQL over hand-pasted `filter=`:** Deterministic `teamBaseJqlService` parity (client `buildPreview` ↔ server `buildBaseJqlFromTeam` via `buildInnerOr`) eliminates filter-drift; legacy `POST /inspect-base-filter` kept for diagnostics but not primary path — alternative (keep old Detect) rejected because NDB sample required explicit `ERA,NDBECO` private + 10 shared split.
- **3 distinct PM/Dev/QA inputs over single ChipInput:** Separate `pmDL`/`devDL`/`qaDL` state → `leader_outlook_dls[3]` ordered array avoids delimiter confusion and clarifies ownership; single ChipInput (previous) blurred PM/Dev/QA distinction and hid ordering.
- **Recent-10 median over full-history median:** Old 15×14d + 8×21d history medianed to 14d (stale cadence); recent-10 correctly yields 21d for latest 3-week sprints — capped 4 pages to avoid board-timeout; fallback 21d when no durations.
- **Leadership DLs in `assignee` vs email-only:** Originally email-only (not in JQL), but agreed sample put `Team-Ashish-Mohindroo-Org` in `assignee in (membersOf(…))`; now 3 DLs auto-included inner OR — no re-typing in Contacts, also for email; rejected alternative (keep email-only) broke sample.
- **Shared 10 SoT in `teamBaseJqlService.ts`:** `SHARED_PROJECTS_ALL=[ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR]` (LEGACY=[]) mirrors server CJS constant via CONSOLIDATION B1 — single source, D1 product-agnostic.

## Mistakes & Corrections
### 1) ChipInput typed-but-not-committed ignored on Save (ux — cross-page)
- **What:** `ChipInput` required `Enter`/`,` to commit; typing `Team-Ashish-Mohindroo-Org` without committing left `inputVal` stale — Save read `value` array only, so `assignee in (…)` missed the visible text. User saw chip-like text but JQL didn't update.
- **Fix:** Added `onBlurAdd` — `onBlur` commits `inputVal.trim()` via `addChip`; also `onPaste` handles comma-separated. Preview now reflects every visible token immediately.
- **Prevention:** Every `ChipInput` → `assignee`/JQL mapping must have blur-commit + live preview; CI guard: if `ChipInput` exists, verify `onBlurAdd` present (weave.mdc 2026-11-24 UX learning).
- **Cross-page:** Yes — same `ChipInput` pattern used in onboarding elsewhere; logged below in `LEARNINGS.md`.

### 2) Leadership DLs email-only, not in `assignee` — JQL missed sample (jql)
- **What:** Initial fix added `leader_outlook_dls` for display/email only (`teamAdminService.js:129` “not in JQL” note) — NDB sample `assignee in (membersOf("Team-Ashish-Mohindroo-Org"))` then failed verification.
- **Fix:** `teamBaseJqlService.ts:leaderOutlookDLs` merged into `buildInnerOr` `dlParts=[leaderDLs,assigneeDLs]`; `TeamForm.js:leaderDLParts` added to `assignee in (…)`; server `buildBaseJqlFromTeam` collects `leader_outlook_dls` + contacts DLs → `membersOf`; context doc corrected.
- **Prevention:** Any `leader_outlook_dls` change must assert `buildPreview` ∩ `buildBaseJqlFromTeam` parity + sample JQL match; doc SoT check: `context/pages/admin.md` must mention `membersOf(PM/Dev/QA)` not “email only”.

### 3) Sprint inferred from full history bias → 14d not 21d (config)
- **What:** `inferSprintCalendarFromSprints` median over all dated sprints kept old 14-day cadence (15×14d) when recent switched to 21d (8×21d) — inferred 14d, breaking NDB 3-week cadence.
- **Fix:** Slice `recent = dated.length>10 ? dated.slice(-10) : dated` then median; added test `15x14d old + 8x21d recent => 21` + `snapSprintDays` snap 19–22→21.
- **Prevention:** Sprint inference must use recent-10; test matrix includes mixed 14d/21d history; doc `ADMIN_GUIDE` sprints table documents recent-10.
- **Cross-page:** Yes — sprint logic reused across products; logged below in `LEARNINGS.md`.

## Verification
- Review: `npm run lint` (if present) + `git diff --stat` shows 6 code files + 9 docs — no `apps/delivery-ops/docs` stale paths
- QA: `POST /api/admin/teams` → NDB `base_jql` matches sample `(project in (ERA,NDBECO) OR (project in (ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR) AND (… assignee in (membersOf(Team-Ashish-Mohindroo-Org)…))))`; `GET /api/admin/teams` returns `is_shared_project/custom_project_key/leader_outlook_dls/contacts/sprintCalendar:{21d}`; `sprintCalendar.test.js` mixed 14d/21d → 21d passes
- docs-verify: `bash scripts/lighthouse/docs/docs-verify.sh` — PASS (no stale writers, hub + guides, ai-audit naming/frontmatter/registry sync — see Verification below); `node scripts/lighthouse/docs/docs-build.js` — rebuilds `docs/guides/*.html` + `docs/ai-audit/INDEX.md` + `timeline.md`
- Manual: TeamForm preview Copy/Reset + `baseFilterTouched` guard preserves edit; Load Calendar + Auto-detect populate `S1 … · 21 days`

## Links
- Plan: `~/.opencode/plan/weave-teams-config.md` (filter/sprint/people — PM/Dev/QA 3 DLs, shared 10, sprint 21d)
- PR: `weave/teams-config` → `main` (commits 4a1b626 shared 10/recent-10, 3222648/1d80382 leadership→JQL, c4eade8 ux/people→JQL + sprint 3-field, 5d5646f/89438d9 PM/Dev/QA split)
- Docs: `docs/pages/Admin-requirements.md` + `docs/pages/Admin-data-layer.md` + `docs/api/admin.md#post-apiteams` + `ADMIN_GUIDE.md#teams-config--filterproject--peopleroles--sprintboard` + `TECH_DESIGN.md#10.1`
- Source: `apps/delivery-ops/client/src/components/AdminPanel/` (TeamForm/AdminPanel/TeamList/DetectedConfig), `shared/src/services/teamBaseJqlService.ts`, `apps/delivery-ops/server/services/teamAdminService.js`, `apps/delivery-ops/server/utils/sprintCalendar.js`
- Registry: `apps/delivery-ops/server/config/aiAudit.config.json#pages.AdminPanel`

## Config Delta
```json
{
  "teamBoardConfig.json": { "ndb.is_shared_project": false, "ndb.custom_project_key": "ERA,NDBECO", "ndb.components": ["NDB","Era","NDB Databases","NDB Service"], "ndb.leader_outlook_dls": ["Team-Ashish-Mohindroo-Org"], "ndb.base_jql": "(project in (ERA,NDBECO) OR (project in (ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR) AND (…assignee in (membersOf(3 DLs)…))))", "ndb.sprintCalendar": {"s1StartIso":"2022-12-06","sprintDays":21} },
  "teamBaseJqlService": { "SHARED_PROJECTS_ALL": ["ENG","FEAT","ONCALL","TH","SDL","TECHPUBS","SR","LEG","ACP","LBDR"], "leaderOutlookDLs": "assignee membersOf inner OR" },
  "sprintCalendar": { "recent": "slice(-10) median", "snap": "7/14/21 fallback 21d", "cap": "4 pages ×50" },
  "aiAudit.config.json": { "pages.AdminPanel.auditPath": "apps/delivery-ops/client/src/components/AdminPanel/ai-audit-docs" }
}
```

## Follow-ups / Waivers
- Legacy `filter=NDB-All-Base-Filter` teams still load via fallback; migration to generated `base_jql` on next Edit (no forced rewrite).
- `sprintCalendar` now optional on Save — teams saved without calendar will auto-detect on first `board-calendar`/`project-scope` fetch; list still shows `no sprint calendar` until then.
- NDB `leader_outlook_dls` currently single DL `Team-Ashish-Mohindroo-Org`; split to explicit PM/Dev/QA 3 DLs pending org DL provisioning.

## Page Details
- **Component:** `apps/delivery-ops/client/src/components/AdminPanel/` (`TeamForm.js` + `AdminPanel.js` + `TeamList.js` + `DetectedConfig.js` + `hooks/useTeamAdmin`/`useTeamDetect`)
- **Route:** `/team-management` (`/admin` redirect)
- **Description:** Add/edit teams — filter (shared 10/private), people (PM/Dev/QA 3 DLs + 8 contacts → assignee inner OR), sprint (board+21d+S1 recent-10).
- **Kind:** folder-page
