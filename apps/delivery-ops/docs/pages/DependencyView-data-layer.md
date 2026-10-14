# Dependency View — Data Layer

**Route**: `/dependency-view`  
**Hook**: `useDependencyView`  
**API**: `GET /api/dependency/overview`

---

## Client flow

```
DependencyViewPage
  → useTeam() (selectedTeamId)
  → useDependencyView(teamId, release)
  → authenticatedGet('/api/dependency/overview', { teamId, release })
  → WishlistSettingsBar (pre-filled from wishlistMeta)
      → Save → authenticatedPut('/api/dependency/wishlist-config')
      → reload overview
  → mode help + nextActions (client-derived chase list)
  → metrics · DependencyVisualMap → DependencySwimlanes (primary) + Gantt (collapsed)
  → CollapsibleIssueSection / IssueTable (ticket drill-in, collapsed)
  → client-side filters: mode, direction, span
```

No `axios`/`fetch` inside the page component (hook owns HTTP).

---

## Server flow

```
GET /api/dependency/overview
  → routes/dependency.js (validate token, auth)
  → dependencyViewService.getOverview({ token, teamId, release })
  → load dependencyViewConfig.json + releaseVersionsEmailConfig (NDB gates)
  → runSearchByJql for Q2–Q5 + Q7 sections (and optional Q1 roots)
  → classify commit state (Q6)
  → classify Mode (partnership|companionship|…) + Span (EW labels) per issue
  → return JSON with jql + jiraUrl per section + spans catalog
```

Classification is **post-fetch only** — Q1–Q7 JQL strings are unchanged.

### Mode + Span (runtime)

| Field | Source |
|-------|--------|
| `operationMode` | From section `source`: partnership* → Partnership; companion* → Companionship; wishlist*/labels → discovery |
| `span` / `spanInfo` | Widest EW label on the issue: `global-ew` > `nutanix-ew` > `ndb-ew`; else `team_internal` |

Config SoT: `dependencyViewConfig.json` → `spans`, `spanTaxonomy`, `modesOfOperation`.

---

## JQL sections (approved)

| Key | Query |
|-----|-------|
| companionHierarchy (Q1) | Parent Link hierarchy under `{rootKey}` |
| companionExternal (Q2) | Q1 + external (project != ERA OR assignee not in NDB orgs) |
| partnershipBlockedBy (Q3) | `linkedIssuesOf("fixVersion = {release}", "is blocked by")` |
| partnershipBlocks (Q4) | `linkedIssuesOf("fixVersion = {release}", "blocks")` |
| trainLabels (Q5) | `labels in ("ndb-{trainSlug}-dependency", "ndb-{trainSlug}-asks")` |
| wishlist (Q7a) | `labels = "ndb-{releaseSlug}-wishlist"` |
| wishlistLinked (Q7b) | `linkedIssuesOf("labels = \"ndb-{releaseSlug}-wishlist\"")` — all link types unless `wishlist.linkTypeFilter` set |
| wishlistUnlinked (Q7c) | Q7a + `issueFunction not in hasLinks()` |
| partnerOrphans (Q7d) | `labels in ("ndb-{trainSlug}-dependency")` not linked to wishlist |

Commit (Q6): runtime classification — real fixVersion or `customfield_11061` = Commit.
Issue payload includes `commitState`, `commitVia` (`fixVersion` | `release_commit_field` | `both`),
`commitFixVersions`, `releaseCommit`, plus `links[].typeName` for the Partnership link type in the UI.

Org groups: `Team-BharatKumar-Beedu-Org`, `Team-Ashish-Kumar-Org`.

Config SoT: `dependencyViewConfig.wishlist` — editable from UI Save
(`linkTypeFilter` null/empty = all types; `linkTypePresets` drive the dropdown).

---

## Response shape (minimal)

```json
{
  "success": true,
  "teamId": "ndb",
  "release": "NDB-3.0",
  "jiraBaseUrl": "https://jira.nutanix.com",
  "asOf": "2026-10-08T12:00:00.000Z",
  "alignedTrain": {
    "train": "Kronos.1",
    "trainSlug": "kronos.1",
    "status": "aligned",
    "partnerVersions": [],
    "confluenceUrl": null,
    "notes": "Current intended align"
  },
  "ndbGates": { "ecDate": "...", "commitGate2": {}, "promotionGate2": {}, "ga2": {} },
  "sections": {
    "partnershipBlockedBy": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "partnershipBlocks": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "trainLabels": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "wishlist": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "wishlistLinked": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "wishlistUnlinked": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "partnerOrphans": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "companions": [
      {
        "rootKey": "ERA-67841",
        "hierarchy": { "jql": "...", "count": 0, "issues": [], "jiraUrl": "..." },
        "external": { "jql": "...", "count": 0, "issues": [], "jiraUrl": "..." }
      }
    ]
  }
}
```

---

## Caching

None in MVP — live JIRA on each Pull / load. Timeout ~180s client-side.

---

## Error handling

| Case | Behaviour |
|------|-----------|
| 401 / missing token | Auth middleware → client shows login / reconnect |
| JIRA search failure | 502/500 with message; page shows error + retry |
| Unknown release | Still return train note + empty sections with valid JQL |
