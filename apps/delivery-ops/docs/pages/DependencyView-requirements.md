# Dependency View — Requirements

**Route**: `/dependency-view`  
**Component**: `DependencyViewPage`  
**Permission**: `release_versions_view`  
**Audience**: `tpm`, `rm`, `portfolio_mgr`, `feat`  
**Mode**: **read-only** (MVP)

---

## Purpose

Read-only NDB-first view of cross-team dependencies for a selected release:
partnership links (`blocks` / `is blocked by`), companion hierarchy outside NDB
eng ownership, train-aligned label callouts, and ask-vs-committed badges —
with NDB gates side-by-side with the aligned partner train (Janus / Kronos / Leto).

---

## Audiences

| Audience | Use |
|----------|-----|
| TPM / Portfolio Manager | Release dependency inventory, partner asks, train alignment |
| RM | Gate-adjacent dependency risk |
| Feature manager | Companion / partnership drilldown for a root |

---

## User Stories

| ID | Story |
|----|-------|
| DV-01 | As a TPM, I open Dependency View scoped by sidebar team (`useTeam`) and pick an NDB release. |
| DV-02 | As a TPM, I see partnership counts for “I wait on them” and “they wait on me” with JIRA click-through. |
| DV-03 | As a TPM, I see companion (external) hierarchy counts for configured root keys with JIRA click-through. |
| DV-04 | As a TPM, I see train label callouts (`ndb-*-dependency` / `ndb-*-asks`) as the same dependency kind. |
| DV-05 | As a TPM, each row shows ask vs committed from real fixVersion or Release Commit. |
| DV-06 | As a TPM, I see NDB gate dates next to the aligned train metadata from config. |
| DV-07 | As a user, I cannot create/edit/delete JIRA links or Parent Links from this page. |

---

## UI Behaviour

```
Header (title · read-only badge · Pull from JIRA · as-of)

Filters (release · mode: all/partnership/companion/labels · direction · span)

Aligned train panel (NDB gates | train codename + partner versions + Confluence SoT link)

Metric cards (clickable counts → JIRA)

Issue tables (key, summary, status, project, assignee, span, commit badge)
```

- Team from sidebar `useTeam()`; NDB-first default.
- Filters apply client-side where possible; Pull reloads live JIRA.
- Every count links to the exact JQL that produced it.

---

## Permissions

- View: `release_versions_view`
- No edit / mutate permissions for MVP

---

## Edge Cases

- Missing aligned train for a release → show “unaligned / reassess” note (e.g. NDB-2.12).
- Empty JIRA results → zero counts with still-valid JIRA links.
- Non-NDB team selected → page still loads but config may be NDB-centric; show team banner.

---

## Acceptance Criteria

- [ ] Route `/dependency-view` in nav with `release_versions_view`
- [ ] GET-only API; no POST/PUT/DELETE dependency mutates
- [ ] Q1–Q5 JQL only (approved); every metric clickable
- [ ] Ask vs committed badges from fixVersion / customfield_11061
- [ ] Aligned trains from `dependencyViewConfig.json`
- [ ] Page + API docs present
