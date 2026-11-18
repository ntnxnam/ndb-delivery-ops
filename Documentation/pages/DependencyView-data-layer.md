# Post EC dependency view — Data Layer

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
  → filters: EW scope · Component (wait tabs, client-side)
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
| `components` | `string[]` — JIRA component names (`DEPENDENCY_EXTRA_FIELDS` includes `components`) |
| `commitState` | `clean` \| `ask` |
| `commitNature` | `Commit` \| `Stretch` \| null |
| `commitHygiene` | `partner_missing_fixversion` \| `partner_missing_release_commit` \| null |
| `releaseCommit` | Raw field value |

### Component filter (client)

1. After EW scope, collect unique `components` from the partner ticket list for the active wait tab.
2. Keep issues where `components` includes the selected name (any project).
3. Display proof JQL / URL appends `AND component = "<name>"` — fetch JQL for Q3/Q4 is unchanged.

---

## Previously linked (post-fetch)

After Q1–Q7 + chain context, `fetchPreviouslyLinked` (`server/utils/previouslyLinkedDeps.js`):

1. **Seeds** (cap ~80): home wait-roots / wishlist / Q3–Q4 home keys, then live-chain partners (Q3/Q4 non-home + `blockerHops`) so “their dependency removed” is visible.
2. **Changelog**: `expand=changelog` Link field add/remove for `blocks` / `is blocked by` wording.
3. **Lookback**: on/after release EC date, else last 90 days.
4. **Exclude** pairs still present in live `issuelinks`.
5. Response top-level `previouslyLinked: { count, jql, jiraUrl, pairs[] }` — `jql` is `key in (...)` only (no invented historical-link JQL). Q1–Q7 strings unchanged.

UI: flat pairs under wait tabs (`PreviouslyLinkedBlock`) — muted “previously linked” connector, **no** `WaitArrow`.

## Caching

No long-lived cache — Pull reloads live.
