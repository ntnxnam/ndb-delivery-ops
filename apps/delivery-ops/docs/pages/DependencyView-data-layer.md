# Dependency View — Data Layer

**Route**: `/dependency-view`  
**Hook**: `useDependencyView`  
**API**: `GET /api/dependency/overview`

**Rules SoT:** `agent-pack/context/domain/dependency_rule.md`  
**JQL SoT:** `agent-pack/context/domain/cross-team-dependencies.md`

---

## Client flow

```
DependencyViewPage
  → useTeam()
  → useDependencyView(teamId, release)
  → authenticatedGet('/api/dependency/overview')
  → filters: Show · Project type
  → Hygiene chase (client-derived from dependency_rule.md §6)
  → Direction columns: I wait | They wait
  → Wishlist / Train asks / Partnership hierarchy (details)
```

Files (lean rebuild):

| File | Role |
|------|------|
| `index.js` | Page shell + filters |
| `DirectionColumn.js` | One wait-direction column + chips |
| `hygiene.js` | Chase list builder |
| `DependencyView.css` | Compact layout |

---

## Server flow

```
GET /api/dependency/overview
  → dependencyViewService.getOverview
  → Q1–Q5 + Q7 via runSearchByJql (unchanged JQL)
  → classifyCommit (Q6): nature Commit|Stretch + hygiene flags
  → resolveOperationMode: partnership* → Dependency; companion* → Partnership
  → EW project type on issues
```

Legacy section keys (`partnershipBlockedBy`, `companions`, …) remain for API stability; UI labels use correct Mode names.

---

## Issue fields (post-fetch)

| Field | Meaning |
|-------|---------|
| `operationMode` | `{ id: dependency\|partnership\|wishlist\|train_ask, label, hint }` |
| `span` / `spanInfo` | Project type EW |
| `commitState` | `clean` \| `ask` |
| `commitNature` | `Commit` \| `Stretch` \| null |
| `commitHygiene` | `partner_missing_fixversion` \| `partner_missing_release_commit` \| null |
| `releaseCommit` | Raw field value |

---

## Caching

No long-lived cache — Pull reloads live.
