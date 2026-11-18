# Release Outstanding Work — Data Layer

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/release-outstanding-work/workbench?teamId=&release=` | Candidates, awaiting deferral, must-fix |
| GET | `/api/release-outstanding-work/outstanding?teamId=&release=` | Outstanding buckets (not Closed / TBV / Dev / QA / disciplines / must-fix) |
| POST | `/api/release-outstanding-work/outstanding-report` | Preview or send outstanding exec email |
| POST | `/api/release-outstanding-work/move` | Dev DRI: set fixVersion to rulebook target |
| POST | `/api/release-outstanding-work/defer` | QA DRI: add `{release}-deferred` |
| POST | `/api/release-outstanding-work/mustfix` | Add `{release}-mustfix`; remove same-release `{release}-deferred` only |
| POST | `/api/release-outstanding-work/chase-justification` | Justification queue: tag assignee + manager when justification empty |
| POST | `/api/release-outstanding-work/chase-status-update` | Must-fix: ask for status-update comment when silent ≥ `mustFixStatusStaleHours` (default 12) |

## Server flow
Route `releaseOutstandingWork.js` → `releaseOutstandingDeferralService` / `outstandingWorkbenchService` → `getJira` / `emailService`.

## Outstanding JQL (approved)

### Actionable (heroes)
- Universe base: `({release}-All)`
- **Awaiting Verification** (`toBeResolved`): `(All) AND status = Resolved`
- **Dev open** (deferred excluded): `(All) AND status not in (Resolved, Closed) AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability, Test) AND project not in (TECHPUBS, SDL, LEG, SR, NDBQUAL, OSS) AND (labels is EMPTY OR labels not in ("…-deferred", "NDB-…-deferred"))`
  - Groups (same bar): **Task / Unit Test** · **Bug / Improvement** · **CVE** (`issuetype = CVE`) · **Dev other**
- **Test open**: same companions + deferred exclusion; `issuetype = Test`
- **Regression – Product**: `(All) AND filter=ndb-product-regressions AND statusCategory != Done`
- **Regression – Test**: `(All) AND filter=ndb-test-regressions AND statusCategory != Done`
- **System-Test**: `(All) AND filter=NDB-System-Test AND statusCategory != Done`
  - Of-which must-fix for each: `{group JQL} AND labels = "{slug}-mustfix" AND fixVersion = "{release}"` (`mustFixRegressionProduct`, `mustFixRegressionTest`, `mustFixSystemTest`)
- **Must-fix** (actionable): `(All) AND labels = "{slug}-mustfix" AND fixVersion = "{release}" AND statusCategory != Done`
- Story: `X Dev open (Y must-fix) · … · N hygiene`

### Companion / cross functional teams (page only)
- `((All) OR fixVersion = "{release}") AND statusCategory != Done AND project not in ({team.projectKey}, FEAT)` — chips by project key (FEAT excluded)

### Hygiene strip (page only; cleanup, not capacity; companions excluded)
- **Deferred, still on this FV**: deferred ∧ `fixVersion = "{release}"` ∧ not Done
- **On master**: `(All) ∧ fixVersion = master` ∧ not Done
- **Deferred, wrong target FV**: deferred ∧ `fixVersion` not in (`{release}`, next-dot, next-major, `master`) ∧ not Done
- **Must-fix, FV ≠ release**: mustfix ∧ `fixVersion != "{release}"` ∧ not Done

### Email
- Layout: root wrapper `width:99%` / `max-width:99%` of the body (centered); hero + ticket tables wrap in `overflow-x:auto` so narrow clients can scroll horizontally.
- Hero cards (always rendered, same as UI): headline Dev open · Must-fix; then labeled groups Dev (Task/UT · Bug/Imp · CVE · Dev other), Test (Awaiting Verification · Test open), KPI (Regression – Product · Regression – Test · System-Test · CFI/CFD) — each with count, of-which must-fix when present, Open in JIRA.
- Ticket tables (omitted when count is 0): MUST FIX · CVE · REGRESSION (Product, Test) · SYSTEM TEST · CFI/CFD. Columns: Key (+ Must-fix / Allowed deferral / CFI-CFD category chips), Summary, Status, Affected Version, Fix Version, Assignee, QA Contact, Priority, Issue Type, Component, Due Date, Created, Updated. Rows sort must-fix → deferred → CFI/CFD. Header: count + Open in JIRA ↗; "Showing N of M" when the sample (80) is capped. No companion chips or hygiene in mail.
- Sample row shape: `key, summary, status, issueType, priority, assignee, qaContact, affectedVersions[], fixVersions[], labels[], isMustFix, isDeferred, updated, components[], dueDate, created` (last three from `server/utils/ticketRowFields.js`). `isMustFix` = labels include `{slug}-mustfix` (either casing variant) — chip is label-based so hygiene “Must-fix, FV ≠ release” still shows it. `isDeferred` = labels include `{slug}-deferred` (either casing variant); shown as the Allowed deferral chip. Fields fetched: `summary,status,issuetype,priority,fixVersions,versions,labels,assignee,{qaContact},updated,components,duedate,created`.

## JQL + runtime partition
- Outer scope: `getReleaseBaseFilter(release)` → `filter={version}-All` (not bare `fixVersion was`).
- Fetch builders, then **partition “not on this fixVersion” by justification**:
  - `candidates` (Move) ← All ∧ `fixVersion = release` (justification optional)
  - `needsJustification` ← All ∧ `fixVersion != release` ∧ missing/empty/default preset
  - `awaitingDeferral` (Defer) ← All ∧ `fixVersion != release` ∧ justification filled
- Labels gate: `(labels is EMPTY OR labels not in ("…-mustfix", "…-deferred"))` — empty labels must be included.
- Proof JQL `needsJustification`: same as awaiting (`filter=…-All` ∧ `fixVersion != release` ∧ …). Deferral Justification always has a schema default, so `cf[42660] is EMPTY` is useless; unanswered/default preset is filtered in-app only.
- Must-fix (actionable): All ∧ `labels = "{slug}-mustfix"` ∧ `fixVersion = "{release}"` ∧ `statusCategory != Done`

## Fields fetched
Standard issue fields (`priority`, `fixVersions`, `versions`/affected, `assignee`, `created`, `updated`) plus **QA Contact** (`customfield_10860`), **Deferral Justification** (`customfield_42660`), and **Assignee Manager** (`customfield_19262`). Mapped to `priority`, `created` / `createdAge`, `affectedVersions`, `assignee`, `qaContact`, `deferralJustification`, `assigneeManager`, `missingJustification`, `canChaseJustification` on each row. All posted comments open with `Hi [~assignee],`.

## Comment enrichment
After queue partition, `enrichIssueComments` fetches `/rest/api/2/issue/{key}/comment` for Justify / Move / Defer / Must-fix rows (cap 80, concurrency 8) and sets:
- `lastComment`: `{ author, body, created, age }` — most recent comment (body truncated ~320 chars)
- `lastNudgeAt` / `lastNudgeAge` — Justification queue when `missingJustification` (`[deferral-nudge]`)
- Must-fix rows: `lastActivityAt` / `lastActivityAge` / `needsStatusUpdate` / `canChaseStatusUpdate` / `statusStaleHours` from max(last comment, `updated`, `created`) vs `mustFixStatusStaleHours`; `lastStatusNudgeAt` when `[mustfix-status-nudge]` present. Justification chase flags cleared on Must-fix.

## Caching
None — live JIRA each load. Must-fix author enrichment fetches changelog (capped).

## Errors
| Code | When |
|---|---|
| 400 | missing release / issueKey |
| 409 `TARGET_VERSION_MISSING` | rulebook target not in project versions |
| 403 | auth |
