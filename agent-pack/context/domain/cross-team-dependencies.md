---
name: cross-team-dependencies
area: domain
---

# Cross-team dependencies

Canonical agent brief for partnership / companion dependencies and the
Dependency View page. **MVP is read-only** — no issue-link or Parent Link
mutates from the app.

Cross-references: D18, `skills/dependency-walk`, `dependency-tracker-specialist`,
UI page `pages/dependency-view.md`.

## Two modes

| Mode | Meaning | Discovery |
|---|---|---|
| **Partnership** | Formal `blocks` / `is blocked by` links | `linkedIssuesOf` on release fixVersion |
| **Companion** | Work under a root project ticket owned (or assigned) outside NDB eng | Parent Link hierarchy + external filter |

UI language (preferred on Dependency View):

| UI | D18 / skill term | Link direction |
|---|---|---|
| I wait on them | upstream | `is blocked by` |
| They wait on me | downstream | `blocks` |

## Aligned release trains

AOS-family **train codenames** (Janus, Kronos, Leto, …) group partner version
numbers that ship together. NDB releases align to those trains. Config SoT:
`apps/delivery-ops/server/config/dependencyViewConfig.json` → `alignedTrains`.

| NDB release | Aligned train | Notes |
|---|---|---|
| NDB-2.11 | Janus | Historical |
| NDB-2.12 | was Kronos | Kronos slipped — alignment broken / reassess |
| NDB-3.0 | Kronos.1 | Current intended align |
| NDB-3.1 | Leto | Planned |

Dependency View trains panel = **NDB gates** side-by-side with the **aligned
partner train**, not a generic partner list alone.

## Labels vs commitment

`ndb-{trainSlug}-dependency` and `ndb-{trainSlug}-asks` are the **same kind of
callout** — both mark a train-aligned dependency. Naming differs; relationship
type does not.

| State | How you know |
|---|---|
| Ask / not yet committed | Dependency callout, partner has not accepted |
| Committed | Real `fixVersion` (not denylisted) **or** Release Commit (`customfield_11061`) = Commit |

Field id lives only in `jiraFieldsConfig.json` / productService.

## Canonical JQL (approved for Dependency View MVP)

Placeholders: `{rootKey}`, `{release}`, `{trainSlug}`.

### Q1 — Companion hierarchy

```jql
key = {rootKey}
OR "Parent Link" = {rootKey}
OR issueFunction in issuesInEpics("\"Parent Link\" = {rootKey} and type = Epic")
```

### Q2 — External / non-NDB-owned slice

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

### Q3 — Partnership: I wait on them

```jql
issueFunction in linkedIssuesOf("fixVersion = {release}", "is blocked by")
```

### Q4 — Partnership: they wait on me

```jql
issueFunction in linkedIssuesOf("fixVersion = {release}", "blocks")
```

### Q5 — Train label discovery

```jql
labels in ("ndb-{trainSlug}-dependency", "ndb-{trainSlug}-asks")
```

### Q6 — Commit signal

Classification on fetched issues (not a discovery JQL): committed if real
fixVersion or `customfield_11061` = Commit.

## Spans

Spans 1–4 describe dependency distance / criticality for filtering in the UI.
Partner project catalog (ENG+component, NCM, NCN, ERA/`NDB-*` unarchived) and
Confluence train SoT URLs live in `dependencyViewConfig.json`.

## Future write APIs (document only — not wired in MVP)

| Mode | Future API |
|---|---|
| Partnership link | `POST /rest/api/2/issueLink` after `GET /issueLinkType` |
| Remove link | `DELETE /rest/api/2/issueLink/{id}` |
| Companion parent | `PUT` Parent Link (same as Feature Dashboard) |
| Create ask ticket | `POST /rest/api/2/issue` then link/parent |

HITL / D26 when writes are added. D18: never auto-create from inferred
Confluence/Slack.
