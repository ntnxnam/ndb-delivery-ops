# Release Outstanding Work — Requirements

## Purpose
Post-PG release page with two jobs: (1) **Deferral process** — Dev DRI moves fixVersion, QA DRI adds deferred label, Must-fix chase; (2) **Outstanding work** — not-Closed buckets (To Be Resolved, Dev, QA, disciplines, Must-fix) plus exec email to `ndb-exec-updates@`.

Nav title: **Release Outstanding Work**. Path: `/release-outstanding-work` (legacy `/deferral-workbench` redirects here).

## Process order (canonical)

Tab / process order (fixed):

1. **Justification** — **Dev**
2. **Move** — **Dev DRI**
3. **Deferral Label** — **QA DRI** (`{release}-deferred`)
4. **Must-fix** — **Dev DRI / QA DRI / QA** (when `{release}-mustfix` is added)

**Move `fixVersion` before applying deferred / mustfix labels.** See `.cursor/rules/release-outstanding-work-order.mdc`.

## Audiences
TPM, RM, Dev, Dev DRI, QA DRI, QA team, Serv/PM

## User Stories
1. As Dev, I fill Deferral Justification on tickets that left the release.
2. As Dev DRI, I click **Move** so fixVersion follows P0/P1 → next dot, >P2 → next major.
3. If the target version is not in JIRA, the row is highlighted and Move is disabled until someone creates the version.
4. As QA DRI, I add the **Deferral Label** on tickets that left the release (`{release}-deferred`).
5. If someone other than Dev DRI moved fixVersion, Deferral Label still works; the row is highlighted with who moved it.
6. As Dev DRI, QA DRI, or QA, I work Must-fix tickets once the mustfix label is added.
7. Dev / QA DRIs are set on **Release Config** (`releaseGateDates.devDRIs` / `qaDRIs`); email `versionDRIs` stays in sync from Dev DRIs.

## UI Behaviour
- Page advice: **Typically used after Promotion Gate (PG).**
- **Deferral process** strip: four live step cards (Justification → Move → Deferral Label | Must-fix) with queue counts; click selects the queue. No static process PNG.
- **Outstanding work** section below queues: hero story + tiles (count → in-app drill; separate Open in JIRA ↗).
- Outstanding heroes — **headline strip**: **Dev open** (of which Y must-fix) · **Must-fix**. Below: three wrap panels (**Dev** · **Test** · **KPI**). Dev/Test exclude companions (TECHPUBS/SDL/LEG/SR/NDBQUAL/OSS) **and** deferred labels. Must-fix = mustfix label **and** `fixVersion = release`.
  - **Dev**: Task/UT · Bug/Imp · CVE · Dev other (each with of-which must-fix when present).
  - **Test**: **Awaiting Verification** · **Test open**.
  - **KPI** (open = `statusCategory != Done`, each with of-which must-fix when present): **Regression – Product** (`ndb-product-regressions`) · **Regression – Test** (`ndb-test-regressions`) · **System-Test** (`NDB-System-Test`) · **CFI / CFD**. Count → in-app drill; of-which must-fix → must-fix drill; separate Open in JIRA ↗ opens the exact JQL. Panels wrap (Dev | Test | KPI when wide; stack when narrow).
- Every outstanding drill table (tiles, of-which must-fix, CFI/CFD, companion, hygiene) shows **Component · Due Date · Created** after Assignee; overdue open tickets show Due Date in red. The CFD/CFI page drill and the outstanding email tables carry the same three columns.
- **Companion / cross functional teams** chips = non-ERA/non-FEAT projects with `(All OR fixVersion) AND statusCategory != Done` (page only; not in email).
- **Hygiene** strip (cleanup, not capacity; page only): deferred-still-on-FV · on master · deferred-wrong-target · mustfix-FV≠release.
- **Send outstanding report**: preview + send; To `ndb-exec-updates@`; CC current-release DRIs + `ndb-tech-leads@` + `ndb-managers@`; subject `{release} - outstanding work - post PG gate report - {date}`; email body = headline (Dev open · Must-fix) + labeled Dev / Test / KPI hero rows (with of-which must-fix) + ticket tables for MUST FIX · CVE · REGRESSION (Product, Test) · SYSTEM TEST · CFI/CFD (no companion chips, no hygiene). Each section header shows the count, an Open in JIRA ↗ link, and "Showing N of M" when the sample is capped. CVE / Regression / System-Test tables list must-fix tickets first with a Must-fix chip.
- Release picker from SelectedReleaseContext.
- Four deferral queues in fixed order:
  1. **Justification** (Dev) — in `{release}-All` · `fixVersion != release` · need deferred label · empty/default justification
  2. **Move** (Dev DRI) — in `{release}-All` · still on this fixVersion · no mustfix/deferred
  3. **Deferral Label** (QA DRI) — in `{release}-All` · not on this fixVersion · justification filled · still need deferred label
  4. **Must-fix** (Dev DRI / QA DRI / QA) — when mustfix label is present · **no** deferral justification chase
- All / Defer / Move membership starts from `getReleaseBaseFilter` (`filter={version}-All`), not bare `fixVersion was`.
- Left-release tickets with empty/default justification never appear on QA Defer.
- Panel **Open in JIRA ↗** links to JQL. Justification proof = All ≠ FV pool (same as Defer base); in-app tab is unanswered/default Deferral Justification only (`cf[42660]` always has a schema default — never use `is EMPTY`).
- Full justification text; **Tag for justification** + **Last nudge** age on Justification queue only.
- Must-fix cards hide justification; show **Last activity**; **Ask for status update** when silent ≥ `mustFixStatusStaleHours` (default 12h). Posts a status-ask comment (not justification).
- Cards show **Pri**, **Age** (since created), **Affected**, **Assignee**, **QA**, **Moved off by** (changelog author).
- Justify / Move / Defer / Must-fix cards show **Must-fix** / **Allowed deferral** chips next to the key when `{release}-mustfix` / `{release}-deferred` is present (same chips as outstanding drill).
- Justify / Move / Defer / Must-fix cards show **Last comment** (author · age · body) directly above the JIRA comment box.
- Comments open with `Hi [~assignee],` and always `cc` Dev/QA DRIs for the release plus `commentAlwaysCc` (`namratha.singh`).

## Permissions
`release_versions_view` / `releaseVersions`

## Edge Cases
- Missing target version → highlight, no auto-create.
- Must-fix author unmapped → chip **Other** (configure `releaseOutstandingWorkConfig.json`).

## Acceptance Criteria
- [ ] Nav shows **Release Outstanding Work**; page shows post-PG advice
- [ ] `/release-outstanding-work` loads candidates, awaiting-deferral, must-fix
- [ ] Move blocked + highlighted when target missing
- [ ] Defer adds deferred label; Must-fix adds mustfix and clears **that release’s** deferred only
- [ ] Must-fix chips QA/Serv/PM/Other; filter chips work
- [ ] Tag for justification appears when justification empty; comments mention assignee + manager
- [ ] Deferral Justification (`customfield_42660`) shown under ticket summary on Justify / Move / Defer — not on Must-fix
- [ ] Must-fix shows **Ask for status update** when last activity ≥ 12h; never asks for deferral justification
- [ ] Last JIRA comment preview appears above the comment box on Justify / Move / Defer / Must-fix cards
- [ ] Outstanding tiles load for selected release; count opens drill; Open in JIRA opens exact JQL
- [ ] Preview/send outstanding report defaults To to ndb-exec-updates@
