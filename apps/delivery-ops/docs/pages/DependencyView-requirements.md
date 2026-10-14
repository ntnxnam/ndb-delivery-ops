# Dependency View — Requirements

**Route**: `/dependency-view`  
**Component**: `DependencyViewPage` (rebuild in progress)  
**Permission**: `release_versions_view`  
**Audience**: `tpm`, `rm`, `portfolio_mgr`, `feat`  
**Mode**: **read-only** (MVP)

**Rules SoT:** `agent-pack/context/domain/dependency_rule.md`  
**Page brief:** `agent-pack/context/pages/dependency-view.md`

---

## Purpose

Read-only NDB-first view of the **3-axis** dependency matrix for a selected release:

1. Project type (`global-ew` / `nutanix-ew` / `ndb-ew`; team-internal FYI only)
2. Mode — **Dependency** (JIRA links) or **Partnership** (hierarchy)
3. Aligned release (NDB ↔ train)

Plus wishlist / train-ask discovery and hygiene chase (us vs them).

Companionship is **retired**.

---

## Audiences

| Audience | Use |
|----------|-----|
| TPM / Portfolio Manager | Release dependency inventory, partner asks, train alignment |
| RM | Gate-adjacent dependency risk |
| Feature manager | Drilldown for a root / partnership hierarchy |

---

## User Stories

| ID | Story |
|----|-------|
| DV-01 | As a TPM, I open Dependency View scoped by sidebar team and pick an NDB release (aligned train shown). |
| DV-02 | As a TPM, I see **I wait on them** and **They wait on me** clearly demarcated, including NDB↔NDB (`ndb-ew`). |
| DV-03 | As a TPM, I filter by project type 1–3; team-internal is FYI only. |
| DV-04 | As a TPM, I see Mode Dependency (links) vs Mode Partnership (hierarchy) without mixed glossary. |
| DV-05 | As a TPM, I see Release Commit **nature** (Commit / Stretch / blank) with real fixVersion hygiene. |
| DV-06 | As a TPM, NDB hygiene: Dependency link without wishlist is highlighted. |
| DV-07 | As a TPM, their hygiene: Commit/Stretch without real fixVersion, or valid fixVersion with blank Release Commit, is highlighted. |
| DV-08 | As a TPM, they-wait-on-me with missing ask/train labels is highlighted (no standard yet). |
| DV-09 | As a TPM, ask without Mode Dependency link is highlighted (missing-link hygiene). |
| DV-10 | As a user, I cannot create/edit/delete JIRA links from this page (MVP). |
| DV-11 | As a TPM, every count links to the exact JQL that produced it. |

---

## UI Behaviour (target after rebuild)

```
Header (title · read-only · Pull from JIRA · as-of · aligned train)
Filters (release · Show · Project type)
Next actions / hygiene chase (NDB vs them)
Matrix / columns: I wait | They wait  (demarcated)
Partnership hierarchy (when Show includes it)
Ticket drill-in (collapsed by default)
```

---

## Permissions

- View: `release_versions_view`
- Wishlist config Save (local JSON only) if retained after rebuild
- No JIRA issue-link / Parent Link mutates for MVP

---

## Edge Cases

- Missing aligned train → show unaligned / reassess note
- Empty JIRA results → zero counts with still-valid JIRA links
- Team-internal → FYI only, not matrix Dependency cells

---

## Acceptance Criteria

- [ ] Docs and UI language match `dependency_rule.md` (no Companionship; Dependency ≠ Partnership swap)
- [ ] Directions demarcated; project types 1–3; team-internal FYI
- [ ] Hygiene rules from `dependency_rule.md` §6 surfaced
- [ ] Q1–Q5 + Q7 only (approved); every metric clickable
- [ ] No JIRA mutates from this page
