# API Contract — `/api/release-dataset/*`

**Route file**: `server/routes/releaseDataset.js`  
**Auth**: all endpoints require `validateJiraTokenMiddleware` (header: `x-jira-token`, `x-username`)  
**Mounted at**: `/api/release-dataset`

---

### GET /api/release-dataset/releases

**Purpose**: List all release versions available for a product (from bundle or JIRA).

**Auth**: required

**Request**
- Query: `productId` (string, required) — e.g. `ndb`

**Server flow**  
`releaseDataset.js → productService.getVersions(productId) → jiraConnector.getVersions(projectKey)`

**Response**
```json
{ "success": true, "data": [{ "id": "10200", "name": "NDB-2.11", "released": false }] }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | productId missing | Show "Product ID required" |
| 502 | JIRA unreachable | Retry or show error |

**Caching**: In-memory, 5 min.

---

### GET /api/release-dataset/per-release/:release

**Purpose**: Fetch one release live from JIRA (`fetchReleaseData` wrapped with the team's `baseFilter`). Page reads do not write through to disk.

**Auth**: required

**Request**
- Path: `release` (string) — e.g. `NDB-2.11`
- Query: `productId` (string, required) — team id in `teamBoardConfig.json`

**Server flow**  
`releaseDataset.js` → `releaseLiveDatasetService.fetchLivePerRelease` → `productService.getProduct` (require `baseFilter`) → `fetchReleaseData` with `wrapTeamScope` on every Wave JQL → optional `cache.saveRelease`

**Response**
```json
{
  "success": true,
  "data": {
    "release": "NDB-2.11",
    "tickets": [{ "Issue Key": "ERA-1" }],
    "meta": { "fetchedAtIso": "2026-08-26T15:00:00.000Z", "source": "jira", "ticketCount": 1 }
  }
}
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | `productId` missing, unknown team, or team has no `baseFilter` | Show Admin / Fetch error |
| 401 | JIRA token missing | Redirect to login |
| 502/500 | JIRA fetch failed | Retry |

**Caching**: 5-minute in-memory TTL on the client (`ReleaseDataContext`). Server hits JIRA on each uncached request. No disk write-through on this path.

> ⚠️ Breaking change in 2026-08-26: this endpoint is no longer disk-only. Empty disk does **not** return `404 not_cached`. It hits JIRA. `reason: not_cached` is gone.

---

### GET /api/release-dataset/synopsis

**Purpose**: Return 5-bucket engineering payload counts for a release (cheap — count-only queries).

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required)

**Server flow**  
`releaseDataset.js → shared/services/releaseDatasetService → jiraConnector.searchCount × 6 JQL calls (maxResults=0)`

**Response**
```json
{
  "success": true,
  "data": {
    "topLevelProjects": 12,
    "portfolioChildren": 340,
    "epicChildren": 1820,
    "standaloneEpics": 5,
    "directTickets": 88,
    "total": 2265
  }
}
```

**Caching**: No cache — counts are cheap and must be fresh.

---

### GET /api/release-dataset/velocity

**Purpose**: Return 3-stream sprint velocity (Dev / QA-Verification ×0.33 / QA-Test) for recent sprints.

**Auth**: required

**Request**
- Query params:
  - `productId` (string, required) — product registry id
  - `release` (string, optional) — when set, scope to that fixVersion / trunk cache. Omit for whole-team live JIRA velocity.
  - `sprintsBack` (number, optional, default 3, max 12)

**Server flow**
Route → `productService` (projectKey, sprintCalendar) → if `release` and trunk has tickets: `computeRecentSprintVelocityFromTickets` (no JIRA count). Else `JiraConnector.searchCount` via `computeRecentSprintVelocity`.

**Response shape**
```json
{
  "success": true,
  "data": {
    "productId": "ndb",
    "release": "NDB-2.11",
    "projectKey": "ERA",
    "source": "cache",
    "sprints": [
      {
        "sprintNumber": 22,
        "sprintLabel": "S22",
        "window": { "startIso": "2026-01-07", "endIso": "2026-01-27" },
        "isCurrent": true,
        "dev": { "count": 47, "jql": "project = ERA AND ..." },
        "qaVerification": { "count": 18, "adjustedCount": 5.94, "jql": "..." },
        "qaTestTasks": { "count": 12, "jql": "..." }
      }
    ]
  }
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | Unknown `productId` | Show product-picker error |
| 401 | Missing JIRA Bearer token | Re-auth |
| 5xx | Live JIRA count failed (cache miss only) | Retry or show error |

**Caching**: Yes — prefers the release-dataset trunk (`shared/.cache/release-dataset`). `source` is `"cache"` or `"live"`. Invalidation = dataset sync.

---

### GET /api/release-dataset/forecast

**Purpose**: Return the MVP landing forecast (predicted GA sprint, gap, verdict, confidence, one-liner) for a release.

**Auth**: required

**Request**
- Query params:
  - `productId` (string, required)
  - `release` (string, required)
  - `plannedGaIso` (string, optional, `YYYY-MM-DD`) — without it, verdict is `unknown` / `not_started`, never `on_time` by default

**Server flow**
Route → `productService` (projectKey, sprintCalendar, labelPrefix) → if trunk has tickets: `computeLandingForecastFromTickets`. Else live `computeLandingForecast` (`searchCount` + recent velocity). Assemble math is shared (`assembleLandingForecast`).

**Response shape**
```json
{
  "success": true,
  "data": {
    "productId": "ndb",
    "release": "NDB-2.11",
    "projectKey": "ERA",
    "source": "cache",
    "forecast": {
      "verdict": "slipping",
      "confidence": "medium",
      "forecastGaDate": "2026-08-12",
      "forecastGaSprint": 24,
      "gapSprints": 1,
      "unresolved": 40,
      "weightedOutstanding": 42.3,
      "recentVelocity": 18.5,
      "oneLiner": "NDB-2.11 is forecast to land 3 weeks late (1 sprint) ...",
      "dataSource": "cache",
      "forecastMethod": "fallback_running"
    }
  }
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | Missing `release` or unknown `productId` | Prompt for release / product |
| 401 | Missing JIRA Bearer token | Re-auth |
| 5xx | Live JIRA count failed (cache miss only) | Retry or show error |

**Caching**: Yes — prefers the release-dataset trunk. `source` / `forecast.dataSource` is `"cache"` or `"live"`. Invalidation = dataset sync.

---

### GET /api/release-dataset/gates

**Purpose**: Return gate dates (EC, CCM, CG, PG, GA) for a release from config.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, optional, default `ndb`)

**Server flow**  
Reads `server/config/releaseVersionsEmailConfig.json` — no JIRA call.

**Response**
```json
{ "success": true, "data": { "ec": "2026-02-01", "ccm": "2026-04-15", "cg": "2026-06-01", "pg": "2026-07-15", "ga": "2026-08-20" } }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 200 (empty data) | Release not in config | Show "Gate dates not configured" |

**Caching**: Config file read on each request (cheap).

---

### GET /api/release-dataset/outstanding

**Purpose**: Return outstanding (open) issues for a release bucketed by severity.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required), `teamId` (string, optional)

**Response**
```json
{ "success": true, "data": { "p0": [...], "p1": [...], "p2AndBelow": [...] } }
```

---

### GET /api/release-dataset/project-status

**Purpose**: Return per-project issue-type-group breakdown matrix for a release (powers ProjectBreakdownMatrix). Reads from the on-disk bundle — zero JIRA API calls. Bundle must be synced first via `POST /sync`.

**Auth**: required (JIRA token not used — bundle is read from disk)

**Request**
- Query: `release` (string, required), `productId` (string, optional, default `ndb`)

**Server flow**
Route handler → `ReleaseDatasetCache.loadReleaseLenient(release)` → disk read → in-memory derivation

**Response shape**
```json
{
  "success": true,
  "data": {
    "productId": "ndb",
    "release": "NDB-2.11",
    "projects": [
      {
        "projectKey": "FEAT-123",
        "projectName": "Storage Write Path",
        "issueType": "Feature",
        "plannedCcDate": "2026-03-01",
        "total": 42,
        "outstanding": 8,
        "closed": 34,
        "issueTypeGroups": [
          { "label": "Bug", "outstanding": 3, "toVerify": 1, "closed": 12, "total": 16 }
        ]
      }
    ],
    "standaloneEpics": [],
    "standaloneTickets": { "projectKey": "standalone-tickets", "projectName": "Standalone Tickets (no epic)", "issueTypeGroups": [] },
    "_source": "bundle",
    "_bundleSyncedAt": "2026-06-16T10:00:00Z"
  }
}
```

**Error responses**
| HTTP code | When | Client should |
|---|---|---|
| 404 | No bundle found for this release | Prompt user to run a sync |
| 400 | `release` param missing | Fix request |
| 500 | Unexpected error | Show error message |

**Caching**: Yes — served from disk bundle. Stale until next sync.

> ⚠️ Breaking change 2026-06-16: renamed from `/project-breakdown`. Old path redirects (HTTP 307) to this endpoint for back-compat.

---

### GET /api/release-dataset/project-breakdown *(deprecated)*

**Purpose**: Deprecated alias for `/project-status`. Returns HTTP 307 redirect.

> Use `/project-status` instead.

---

### GET /api/release-dataset/burndown

**Purpose**: Return cumulative closed-issue burndown data over time for a release.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required)

**Response**
```json
{ "success": true, "data": { "points": [{ "date": "2026-04-01", "closed": 120 }] } }
```

---

### GET /api/release-dataset/retrospective

**Purpose**: Full retrospective — gate compliance, naughty list, quality metrics. Used as fallback when bootstrap/projects endpoints fail.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required), `topN` (number, optional, default 10)

**Server flow**  
`releaseDataset.js → shared/services/retroService.getRetro` — fires all gate-check JQL queries live.

**Response**
```json
{ "success": true, "data": { "gateChecks": { ... }, "projects": [...] } }
```

**Caching**: No cache — always live.

---

### GET /api/release-dataset/retrospective/bootstrap

**Purpose**: Fast gate-checks summary from bundle (first call on Retrospective page load).

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required)

**Response**
```json
{
  "success": true,
  "data": {
    "gateDates": { "ccm": "...", "cg": "...", "pg": "...", "ga": "..." },
    "gateChecks": {
      "ccm": { "openAtGate": 12, "closedPct": 88, "rag": "amber", "links": { "openAtGate": "<jql>", "total": "<jql>" } },
      "cg":  { "p0p1OpenAtGate": 3, "p0p1FoundAfter": 1, "ragOpen": "red", "ragAfter": "amber", "links": { ... } },
      "pg":  { "openAtGate": 5, "deferredCount": 8, "rag": "green", "links": { ... } },
      "ga":  { "p0p1OpenAtGa": 0, "rag": "green", "links": { ... } }
    }
  }
}
```

**Caching**: Bundle (24 h).

---

### GET /api/release-dataset/retrospective/projects

**Purpose**: Paginated naughty list — projects ranked by gate violation count.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required), `page` (number, default 1), `limit` (number, default 10)

**Response**
```json
{ "success": true, "data": { "projects": [...], "total": 42, "page": 1 } }
```

**Caching**: Bundle (24 h).

---

### GET /api/release-dataset/retrospective/project/:key

**Purpose**: Per-project violation detail — specific ticket keys that caused violations.

**Auth**: required

**Request**
- Path: `key` (string) — JIRA project/parent key
- Query: `release` (string, required), `productId` (string, required)

**Caching**: No cache — on-demand live.

---

### GET /api/release-dataset/sync-status

**Purpose**: Return bundle metadata plus a version grid. **Unused by the UI** after Sync Hub was removed. Version names come from `listFixVersionsForTeam` (tickets in `baseFilter`). Missing `productId` is 400 — never a silent default of another team.

**Auth**: required

**Request**
- Query: `productId` (string, required)

**Server flow**
`releaseDataset.js` → disk `ReleaseDatasetCache` meta → `listLiveFixVersions` / `listFixVersionsForTeam` (merged into `cachedReleases`) → scheduler status

**Response**
```json
{
  "success": true,
  "data": {
    "productId": "ndb",
    "bundleMeta": { "lastSyncIso": "2026-06-15T06:00:00Z", "numTickets": 36355, "numReleases": 13, "schemaVersion": "v2-node-2026-06" },
    "hasBundleOnDisk": true,
    "cachedReleases": ["NDB-2.11", "NDB-2.12"],
    "releaseStates": { "NDB-2.11": "active", "NDB-2.12": "future" },
    "releaseMeta": {
      "NDB-2.11": { "fetchedAtIso": "2026-06-16T13:44:24Z", "ticketCount": 1253, "loadableStrict": true, "schemaDiff": false, "jqlDiff": false }
    },
    "isSyncInProgress": false,
    "scheduler": {
      "enabled": true,
      "running": false,
      "intervalMs": 900000,
      "nextRunAtIso": "2026-08-17T15:45:00Z",
      "lastSuccessAtIso": "2026-08-17T15:30:01Z"
    }
  }
}
```

> ⚠️ Breaking change 2026-06-16: added `releaseMeta` map with per-release fetch timestamps, ticket counts, and cache validity flags. Added `hasBundleOnDisk` and `isSyncInProgress` fields.
> ⚠️ Breaking change 2026-06-17: `releaseMeta[rel]` now includes `buckets: Record<string, { count: number, fetchedAtIso: string }> | null` — per-bucket ticket counts and last-fetch timestamps for the 7-column SyncHub UI.
> ⚠️ Behaviour change 2026-08-25: cell sync (`saveRelease` with `stampBuckets`) updates only the fetched bucket's `fetchedAtIso`. Sibling bucket ages and release-level `fetchedAtIso` (History column) stay as they were. Empty Group-1 buckets persist as `count: 0` instead of being omitted.

**Caching**: Disk meta from `bundle.meta.json` and `per_release/*.meta.json`. Version names are live (`listFixVersionsForTeam`, ~10 min per team) merged with disk.

---

### DELETE /api/release-dataset/cache

**Purpose**: Wipe the bundle cache for a product.

**Auth**: required

**Request**
- Query: `mode` (string, required) — `bundle` (wipes per_release + bundle.json) or `full` (entire product dir), `productId` (string, required)

**Response**
```json
{ "success": true, "deleted": ["bundle.json", "per_release/NDB-2.11.json", ...] }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 409 | Sync is currently running | Show "Sync in progress — wait" |

---

### POST /api/release-dataset/sync

**Purpose**: Trigger a full or scoped release dataset sync for a product. Returns a Server-Sent Events stream with progress.

**Auth**: required

**Request**
- Query: `productId` (string, required)
- Query: `forceAll` (boolean, optional) — re-fetch every current (non-past) release
- Query: `forceReleases` (comma-separated names, optional) — scoped refetch
- Query: `skipChangelog` (`true`/`false`, optional) — skip Closed Date / gate-history enrichment. Sync Hub sends `true` unless the user checks Include changelog.

**Server flow**  
`releaseDataset.js` → lock → `syncReleaseDataset` → `fetchReleaseData` → optional changelog → `saveRelease` → `processMaster` → `saveBundle`

SSE comments (`: ping`) are written every 15s so nginx `proxy_read_timeout 300s` does not abort a quiet wait. `queued` events are emitted only for releases in the force list.

**Response**: SSE stream  
```
data: {"type":"preflight","message":"Authenticated — fetching JIRA release list…"}
data: {"release":"NDB-2.11","status":"queued","detail":"active"}
data: {"release":"NDB-2.11","status":"fetching","detail":"work_toward_project: 412 tickets"}
data: {"type":"done","releases":["NDB-2.11"],"numTickets":1253,"timingMs":45000}
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 409 | Sync already running | Show "Already syncing" |

> ⚠️ Behaviour change 2026-06-17: when `forceAll=true`, past releases are now excluded from the force list. Only active/future releases are re-fetched. Use `POST /sync/bucket` for targeted past-release cell updates.
> ⚠️ Behaviour change 2026-08-25: `queued` SSE is limited to `forceReleases`. Failed buckets keep prior cache tickets instead of saving an empty slice. `moved_out` uses a 120s page timeout with one retry.
> ⚠️ Behaviour change 2026-08-25: fetch no longer executes ScriptRunner `portfolioChildrenOf` / `issuesInEpics`. Epics and work are loaded via indexed `"Parent Link"` / `"Epic Link"` IN-clauses (chunked 75). Direct Tickets dropped `fixVersion was` (Group 2 already owns that history); counts for that cell will go down. Click-through JQL in the UI may still use ScriptRunner.
> ⚠️ Behaviour change 2026-08-25: JIRA `/search` and changelog fetches run one at a time (no parallel fan-out) to avoid HTTP 429. `forceAll` still excludes past releases. Sync Hub labels this **Sync current & upcoming**.

---

### POST /api/release-dataset/refresh-now

**Purpose**: Trigger an immediate scheduler-backed live refresh of the release dataset cache (JSON response, no SSE stream). **Not used by the UI.** Pages Refresh by busting in-memory TTL and re-hitting live endpoints.

**Auth**: required

**Request**
- Query: `productId` (string, optional, default `ndb`)
- No body

**Server flow**  
`releaseDataset.js → syncScheduler.runNow('manual-refresh') → syncReleaseDataset(...)`

**Response**
```json
{
  "success": true,
  "data": {
    "ndb": {
      "success": true,
      "result": { "releases": 14, "changelogEnriched": 932, "gateHistoryEnriched": 410 }
    }
  },
  "scheduler": {
    "enabled": true,
    "running": false,
    "intervalMs": 900000,
    "lastRunAtIso": "2026-08-17T15:30:00Z",
    "lastSuccessAtIso": "2026-08-17T15:30:01Z"
  }
}
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 503 | Scheduler run failed / skipped due to lock | Show "refresh busy, retry shortly" |
| 500 | Unexpected server failure | Show error, keep cached data visible |

**Caching**
No response cache; operation refreshes on-disk cache.

---

### POST /api/release-dataset/sync/bucket

**Purpose**: Cell-level sync — re-fetch a single bucket's JQL for one release and merge fresh tickets into the existing per-release cache. Allowed for both current and past releases.

**Auth**: required

**Request**
- Query: `productId` (string, optional, default `ndb`)
- Query: `release` (string, required) — e.g. `NDB-2.11`
- Query: `bucket` (string, required) — one of: `top_level_projects`, `epics_of_projects`, `work_toward_project`, `standalone_epics`, `work_toward_standalone_epic`, `direct_tickets`, `moved_out`

**Server flow**  
`releaseDataset.js → syncReleaseBucket() → fetchReleaseData(bucketFilter=[bucket]) → on fetch error return without merge → else merge into per-release cache → saveRelease({ stampBuckets: [bucket] }) → loadAllReleases → processMaster → saveBundle`

**Response**: SSE stream  
```
data: {"type":"preflight","release":"NDB-2.11","bucket":"top_level_projects","message":"Cell sync: NDB-2.11 / top_level_projects"}
data: {"release":"NDB-2.11","status":"fetching","detail":"cell sync: fetching top_level_projects…"}
data: {"release":"NDB-2.11","status":"done","detail":"cell sync top_level_projects: 47 tickets"}
data: {"type":"done","release":"NDB-2.11","bucket":"top_level_projects","count":47,"error":null,"timingMs":3210,"message":"Cell sync complete — 47 tickets in 3.2s"}
```

SSE comments (`: ping`) every 15s. A fetch error does **not** replace cached tickets for that bucket with an empty list.

> ⚠️ Behaviour change 2026-08-25: cell sync stamps only the requested bucket's `fetchedAtIso`. History / sibling cells keep their previous ages.

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | `release` or `bucket` missing | Show inline error |
| 400 | Unknown `bucket` value | Show "Invalid bucket name" |
| 401 | No JIRA token | Prompt re-auth |
| 500 | JIRA fetch failed | Show error, offer retry |

**Caching**: Reads and writes `per_release/<release>.json` + `.meta.json`. Rebuilds `bundle.json`.

---

### POST /api/release-dataset/backfill-meta

**Purpose**: One-time migration — for every cached per-release file whose `.meta.json` is missing the `buckets` field, read ticket data from disk, count tickets by their `Components` bucket tag, and persist the counts back into the meta file. No JIRA API calls — disk-only operation.

**Auth**: required

**Request**
- Query: `productId` (string, optional, default `ndb`)
- No body

**Server flow**  
`releaseDataset.js → readdir(per_release/) → for each release: read .meta.json → if no buckets: read .json, count by Components field → write updated .meta.json`

**Response shape**
```json
{
  "success": true,
  "data": {
    "productId": "ndb",
    "processed": [
      { "release": "NDB-2.10", "buckets": { "top_level_projects": { "count": 22, "fetchedAtIso": "..." }, "..." } }
    ],
    "skipped": ["NDB-2.11", "NDB-2.12"]
  }
}
```
`processed` = releases whose meta was updated. `skipped` = releases that already had bucket data or had no ticket file.

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 404 | No per-release cache dir (no sync run yet) | Prompt Full Sync first |
| 500 | Unexpected error | Show error message |

**Caching**: Writes only to `per_release/<release>.meta.json`. Does not touch JIRA or bundle.json.
