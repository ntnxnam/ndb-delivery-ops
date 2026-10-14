---
name: cross-team-dependencies
area: domain
---

# Cross-team dependencies (JQL & discovery)

**Rules SoT:** `domain/dependency_rule.md` — matrix, modes, labels, hygiene.  
This file holds **approved JQL / discovery** for Dependency View and agents.  
**MVP is read-only** — no issue-link or Parent Link mutates from the app.

Cross-references: D18, `skills/dependency-walk`, `dependency-tracker-specialist`,
`pages/dependency-view.md`.

Companionship is **retired**. Do not use that term.

---

## Naming (must match dependency_rule.md)

| Correct term | Meaning | Legacy (wrong) |
|--------------|---------|----------------|
| **Dependency** (Mode) | JIRA issue links `blocks` / `blocked by` | Was called “Partnership” |
| **Partnership** (Mode) | Hierarchy FEAT / Initiative → Epic → work | Was called “Companionship” |
| **Project type** | `global-ew` / `nutanix-ew` / `ndb-ew` / team-internal (FYI) | Was “Span” / Partner type |
| **Aligned release** | NDB release ↔ train (e.g. NDB-3.1 ↔ Leto) | — |

Mode applies only to project types **1–3**. Team-internal = FYI only.

UI wait direction (orthogonal to mode):

| UI | Skill / D18 | Link direction |
|---|---|---|
| I wait on them | upstream | `is blocked by` |
| They wait on me | downstream | `blocks` |

---

## Aligned release trains

Config SoT: `apps/delivery-ops/server/config/dependencyViewConfig.json` → `alignedTrains`.

| NDB release | Aligned train |
|---|---|
| NDB-2.12 | Kronos |
| NDB-3.0 | Kronos.1 |
| NDB-3.1 | Leto |

---

## Labels (discovery — not Mode, not Project type)

See `dependency_rule.md` §§2–6. Summary:

| Label | Sits on | Meaning |
|-------|---------|---------|
| `ndb-{releaseSlug}-wishlist` | **NDB** tickets | Wish project into NDB release |
| `ndb-{trainSlug}-ask` / `-asks` / `-dependency` | **Their** tickets | Ask other team for work in that train |

Happy path (I depend on them): ask on them → Mode Dependency link on me → wishlist on NDB project.

---

## Canonical JQL (approved for Dependency View MVP)

Placeholders: `{rootKey}`, `{release}`, `{trainSlug}`, `{releaseSlug}`.

**JQL strings below are approved.** Do not change without explicit user approval
(`jql-edit-approval`). Section **names** in code may still say partnership/companion
until the UI rebuild renames them — map mentally:

| Code / section key (legacy) | Correct Mode |
|-----------------------------|--------------|
| partnershipBlockedBy / partnershipBlocks (Q3/Q4) | **Dependency** |
| companionHierarchy / companionExternal (Q1/Q2) | **Partnership** |

### Q1 — Partnership hierarchy (under root)

```jql
key = {rootKey}
OR "Parent Link" = {rootKey}
OR issueFunction in issuesInEpics("\"Parent Link\" = {rootKey} and type = Epic")
```

### Q2 — Partnership external / non-NDB-owned slice

```jql
(
  key = {rootKey}
  OR "Parent Link" = {rootKey}
  OR issueFunction in issuesInEpics("\"Parent Link\" = {rootKey} and type = Epic")
)
AND (
  project != ERA
  OR assignee not in (
    membersOf("Team-BharatKumar-Beedu-Org"),
    membersOf("Team-Ashish-Kumar-Org")
  )
)
```

### Q3 — Dependency: I wait on them

```jql
issueFunction in linkedIssuesOf("fixVersion = {release}", "is blocked by")
```

### Q4 — Dependency: they wait on me

```jql
issueFunction in linkedIssuesOf("fixVersion = {release}", "blocks")
```

### Q5 — Train ask labels (on their tickets)

Approved discovery form (do not change without approval):

```jql
labels in ("ndb-{trainSlug}-dependency", "ndb-{trainSlug}-asks")
```

Conceptually `-ask` is the same callout family (`dependency_rule.md`); include in JQL only after explicit approval.

### Q6 — Commitment nature (classification, not discovery JQL)

Post-fetch on partner tickets:

- Release Commit ∈ {Commit, Stretch} **and** real `fixVersion` (not denylist) → clean  
- Commit/Stretch without real fixVersion → **their** hygiene  
- Valid fixVersion with blank Release Commit → **their** hygiene  
- Release Commit field = nature of their commitment (show as-is)

Field id: `jiraFieldsConfig.json` / productService (`customfield_11061`).

### Q7 — Wishlist / pre-commit (NDB ↔ partner train)

#### Q7a — Wishlist (NDB side)

```jql
labels = "ndb-{releaseSlug}-wishlist"
```

#### Q7b — Linked from wishlist (any link type when filter unset)

```jql
issueFunction in linkedIssuesOf("labels = \"ndb-{releaseSlug}-wishlist\"")
```

#### Q7c — Wishlist with no links (forgotten link — missing-link hygiene)

```jql
labels = "ndb-{releaseSlug}-wishlist" AND issueFunction not in hasLinks()
```

#### Q7d — Partner train-dep not linked to wishlist (orphan ask)

```jql
labels in ("ndb-{trainSlug}-dependency") AND issueFunction not in linkedIssuesOf("labels = \"ndb-{releaseSlug}-wishlist\"")
```

---

## Project type (runtime classification)

Widest EW label wins: `global-ew` > `nutanix-ew` > `ndb-ew`; else `team_internal` (FYI).  
Partner project catalog and Confluence train URLs: `dependencyViewConfig.json`.

---

## Future write APIs (document only — not wired in MVP)

| Mode | Future API |
|---|---|
| Dependency link | `POST /rest/api/2/issueLink` after `GET /issueLinkType` |
| Remove link | `DELETE /rest/api/2/issueLink/{id}` |
| Partnership parent | `PUT` Parent Link (same as Feature Dashboard) |
| Create ask ticket | `POST /rest/api/2/issue` then link |

HITL / D26 when writes are added. D18: never auto-create from inferred Confluence/Slack.
