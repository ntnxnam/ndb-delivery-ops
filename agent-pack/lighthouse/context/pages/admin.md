---
name: admin
route: /team-management
audience: admin
---

# Team Management

**Route**: `/team-management`  
**Audience**: `admin`

## Job

Add/edit teams, RBAC surfaces — auto-generates `baseFilter`/`base_jql` JQL for `teamBoardConfig.json` via `teamBaseJqlService.ts` / `teamAdminService.js` (no manual `filter=NDB-All-Base-Filter` paste).

## JQL Generation (People → assignee)

- **Components** → `component in (...)` + `"primary component" in (...)` (both required)
- **Contacts 8 rows** (`Team/Serv/Doc/Security/Legal/Documentation/Trade Compliance/Others` each `{entries[],isDL}`) → `assignee in (membersOf("DL") OR handle)` **inner OR** inside `(project in (shared) AND (... OR assignee ... OR issuetype))` — private teams ` (project in (ERA,NDBECO) OR (shared AND (...)))` (`shared=ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR` 10, `LEGACY=[]`, `NDBECO` private not shared)
- **Leadership Outlook DLs** → email distribution only, **not in JQL** (`teamAdminService.js:129`)
- **UX rule:** Chip must be obvious — `ChipInput` adds on `Enter`/`,`/`paste`, shows chip `×` 24px, `DL` toggle `→ membersOf` vs `→ handle` label must be next to field; never silently ignore typed-but-not-committed input on Save (Blocking UX if Save ignores visible chip/input)

## Prompts

- _(none — deterministic UI)_

## Engineering docs

`Documentation/pages/` → Admin-requirements.md, Admin-data-layer.md

## Agent notes (UX Lead)

- Save must translate every visible chip/DL to JQL (`assignee`) or email (`leader_outlook_dls`) — if chip appeared but JQL didn't update, it's a bug, not user training issue (`weave.mdc` 2026-11-24 learning).
- Preview JQL (`TeamForm.js:436` `formatJql`) indented for readability — 2-space per `(`/`OR`/`AND` level, `<pre>` not `break-all`.
- Sprint: `board number + sprint duration + base date (S1 start) for full team` accepted; inference uses recent 10 sprints median → 21d for latest 3-week cadence (`sprintCalendar.js:104`).
- Filter: NDB private `ERA,NDBECO` + shared 10 must not be clobbered on Edit without migration — `baseFilterTouched` guard.
