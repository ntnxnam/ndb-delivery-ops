# Retrospective — Data Layer & Middleware Contract

**Route**: `/release/retrospective`  
**Server routes used**: `server/routes/releaseDataset.js` (retrospective sub-routes)  
**Hooks**: `useRetrospective` (`release/hooks/useRetrospective.js`)  
**Services**: `release/services/retrospectiveService.js`  
**Contexts consumed**: `SelectedReleaseContext`, `ReleaseDataContext`

---

## API Calls (client → server) — 4-step waterfall

The hook loads data in a defined sequence to avoid hitting JIRA unnecessarily when the bundle cache is warm.

### Step 1 — Bootstrap (gate dates + summary counts)

```
GET /api/release-dataset/retrospective/bootstrap?release=NDB-2.11&productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → retroService.getBootstrap(release, productId)`  
**Source**: reads from disk bundle first (`shared/.cache/release-dataset/ndb/per_release/{release}.json`); falls back to live JIRA if bundle stale  
**Returns**:
```json
{
  "gateDates": { "ccm": "...", "cg": "...", "pg": "...", "ga": "..." },
  "gateChecks": {
    "ccm": { "openAtGate": 12, "closedPct": 88, "rag": "amber", "links": { "openAtGate": "<jql>", "total": "<jql>" } },
    "cg":  { "p0p1OpenAtGate": 3, "p0p1FoundAfter": 1, "ragOpen": "red", "ragAfter": "amber", "links": { ... } },
    "pg":  { "openAtGate": 5, "deferredCount": 8, "rag": "green", "links": { ... } },
    "ga":  { "p0p1OpenAtGa": 0, "rag": "green", "links": { ... } }
  }
}
```

---

### Step 2 — Projects list (naughty list source)

```
GET /api/release-dataset/retrospective/projects?release=NDB-2.11&productId=ndb&page=1&limit=10
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → retroService.getProjects(release, productId, page, limit)`  
**Source**: bundle if available; otherwise live JIRA aggregation  
**Returns**:
```json
{
  "projects": [
    {
      "key": "ERA-100",
      "name": "Storage",
      "ccmViolations": 4,
      "cgViolations": 2,
      "pgViolations": 0,
      "totalViolations": 6,
      "rag": "red"
    }
  ],
  "total": 42,
  "page": 1
}
```

---

### Step 3 — Project detail (expanded naughty list row)

```
GET /api/release-dataset/retrospective/project-detail?release=NDB-2.11&productId=ndb&projectKey=ERA-100
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → retroService.getProjectDetail(release, productId, projectKey)`  
**Triggered**: on-demand when user expands a project row  
**Returns**: array of specific ticket keys + violation type per ticket

---

### Step 4 — Full retro fallback (if bundle missing)

```
GET /api/release-dataset/retrospective?release=NDB-2.11&productId=ndb&topN=10
Headers: x-jira-token, x-username
```

**Used only when**: `retroFallback` state is set (bootstrap fails or returns empty)  
**Server flow**: fires all gate-check JQL queries live against JIRA  
**Returns**: full retro shape (same as bootstrap + projects combined)

---

## Bundle-to-Live Fallback Logic (in `useRetrospective`)

```
1. Try bootstrap from bundle   → success: use it, skip live
2. Try projects from bundle    → success: use it
3. Either fails or is empty    → trigger fallback live fetch
4. Fallback also fails         → show error state with retry
```

---

## RAG Thresholds (server-computed, not client)

| Gate | Metric | Green | Amber | Red |
|------|--------|-------|-------|-----|
| CCM | closed % | ≥ 95% | 80–94% | < 80% |
| CG | P0/P1 open | 0 | 1–2 | ≥ 3 |
| CG | P0/P1 found after | 0 | 1 | ≥ 2 |
| PG | open at gate | 0 | 1–5 | ≥ 6 |
| GA | P0/P1 open | 0 | — | ≥ 1 |

---

## JIRA Queries Underlying Gate Checks

All JQL strings are constructed server-side by `retroService` using `productService.getCustomFields(productId)` — never hardcoded field IDs.

| Check | JQL pattern |
|-------|------------|
| CCM open | `project=ERA AND fixVersion={release} AND issueType in (Task,"Unit Test") AND status != Done AND resolutiondate > "{ccmDate}"` |
| CG P0/P1 open | `project=ERA AND fixVersion={release} AND issueType=Bug AND priority in ("Blocker - P0","Critical - P1") AND status != Done AND resolutiondate > "{cgDate}"` |
| PG open | `project=ERA AND fixVersion={release} AND status not in (Done,Closed) AND resolutiondate > "{pgDate}"` |

---

## Caching

| Data | Cache | TTL |
|------|-------|-----|
| Bootstrap gate checks | Disk bundle | 24 h; refresh via Sync Hub |
| Projects list | Disk bundle | 24 h |
| Project detail | No cache — on-demand live | — |
| Full retro fallback | No cache | — |
