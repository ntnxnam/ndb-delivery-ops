# Dependency View — Requirements

**Route**: `/dependency-view`  
**Component**: `DependencyViewPage`  
**Permission**: `release_versions_view`  
**Audience**: `tpm`, `rm`, `portfolio_mgr`, `feat`  
**Mode**: **read-only** (MVP)

---

## Purpose

Read-only NDB-first view of cross-team dependencies for a selected release:

- **Show** (plain language): everything / waiting on them / they wait on me /
  our labeled asks / wishlist / work under our epics
- **Partner type**: EW only (`global-ew` / `nutanix-ew` / `ndb-ew` / team);
  never train-dep / asks
- Wishlist / train-aligned label callouts and ask-vs-committed badges
- NDB gates side-by-side with the aligned partner train (Janus / Kronos / Leto)

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
| DV-04 | As a TPM, I pick **Show** → Our labeled asks for train-label callouts on our tickets (`ndb-*-dependency` / `ndb-*-asks`) — never mixed with Partner type (*-ew*). |
| DV-05 | As a TPM, each row shows ask vs committed from real fixVersion or Release Commit, with which signal applied (fixVersion vs field) and the JIRA link type name. |
| DV-06 | As a TPM, I see NDB gate dates next to the aligned train metadata from config. |
| DV-07 | As a user, I cannot create/edit/delete JIRA links or Parent Links from this page. |
| DV-08 | As a TPM, I see wishlist / pre-commit items (`ndb-*-wishlist`) and partner orphans (`ndb-*-dependency` without a wishlist link), including issues linked from wishlist regardless of link type. |
| DV-09 | As a TPM, I can change wishlist link-type filter (and related suffixes) at the top of the page; Save writes `dependencyViewConfig.json` and reloads Q7 until I change it again. |
| DV-10 | As a TPM, I see a swimlane flowchart as the primary visual (who waits on whom + hygiene); chips open JIRA. |
| DV-11 | As a TPM, I can optionally expand a timeline Gantt (bars + link arrows); bars/labels open JIRA. |
| DV-12 | As a TPM, ticket tables are collapsed by default and expand on demand. |
| DV-13 | As a TPM, Show has a one-line caption; the page surfaces a Next actions chase list. |
| DV-14 | As a TPM, I use **Show** (plain-language: everything / waiting on them / they wait on me / labeled asks / wishlist / under our epics) and **Partner type** (*-ew only). |

---

## UI Behaviour

```
Header (title · read-only badge · Pull from JIRA · as-of)
Outcome one-liner (chase list framing)

Wishlist settings bar (link type · partner suffixes · wishlist suffix · Save → config file)

Filters (release · Fetch · Show · Partner type)
Show caption (one line under Show)

Next actions (derived chase bullets from current filters)

Gates & aligned train (collapsed by default)

Metric cards (clickable counts → JIRA)

Swimlane map (primary) — lanes: I wait / wishlist / partners / they wait / hygiene
Timeline Gantt (collapsed by default)

Ticket lists (collapsed by default) — expand to drill into full tables
```

- Team from sidebar `useTeam()`; NDB-first default.
- Filters apply client-side where possible; Pull reloads live JIRA.
- Every count links to the exact JQL that produced it.
- Tables must not dominate the first viewport; swimlanes + next actions are the action surface.

---

## Permissions

- View: `release_versions_view`
- Wishlist config Save uses same permission (local config file only; no JIRA write)
- No JIRA issue-link / Parent Link mutates for MVP

---

## Edge Cases

- Missing aligned train for a release → show “unaligned / reassess” note (e.g. NDB-2.12).
- Empty JIRA results → zero counts with still-valid JIRA links.
- Non-NDB team selected → page still loads but config may be NDB-centric; show team banner.

---

## Acceptance Criteria

- [ ] Route `/dependency-view` in nav with `release_versions_view`
- [ ] No JIRA mutates; PUT wishlist-config allowed (local JSON only)
- [ ] Q1–Q5 + Q7 JQL only (approved); every metric clickable
- [ ] Wishlist section: Q7a–Q7d; link type editable in UI and persisted to config
- [ ] Ask vs committed badges from fixVersion / customfield_11061
- [ ] Aligned trains from `dependencyViewConfig.json`
- [ ] Page + API docs present
