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

**Purpose**: Return the full pre-computed dataset for a single release from the disk bundle.

**Auth**: required

**Request**
- Path: `release` (string) — e.g. `NDB-2.11`
- Query: `productId` (string, required)

**Server flow**  
Reads `shared/.cache/release-dataset/{productId}/per_release/{release}.json` from disk.

**Response**
```json
{ "success": true, "data": { /* full release bundle */ }, "meta": { "cachedAt": "..." } }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 404 | Release not in cache | Fall back to live fetch |

**Caching**: Disk bundle. TTL: 24 h; refresh via `/sync`.

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

**Purpose**: Return sprint velocity (Dev / QA-Verification / QA-Test) for a team across a release.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required), `teamId` (string, required)

**Server flow**  
`releaseDataset.js → shared/services/releaseDatasetService.getVelocity → bundle or live JIRA sprint queries`

**Response**
```json
{
  "success": true,
  "data": {
    "sprints": [
      { "name": "S22", "dev": 47, "qaVerification": 5.94, "qaTestTasks": 12 }
    ]
  }
}
```

**Caching**: Bundle (24 h).

---

### GET /api/release-dataset/forecast

**Purpose**: Return landing forecast / completion probability for a release.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required), `teamId` (string, required)

**Server flow**  
`releaseDataset.js → shared/services/landingForecastService.getForecast`

**Response**
```json
{ "success": true, "data": { "predictedLanding": "2026-08-12", "confidence": "medium", "basis": "velocity trend S18–S22" } }
```

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

### GET /api/release-dataset/project-breakdown

**Purpose**: Return per-project issue counts and RAG for a release (powers ProjectBreakdownMatrix).

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required)

**Response**
```json
{ "success": true, "data": { "projects": [{ "key": "ERA-100", "name": "Storage", "open": 12, "closed": 88, "rag": "amber" }] } }
```

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

**Purpose**: Return bundle metadata (last sync time, size, release count) without making JIRA calls.

**Auth**: required

**Request**
- Query: `productId` (string, required)

**Response**
```json
{ "success": true, "data": { "lastSync": "2026-06-15T06:00:00Z", "releaseCount": 18, "bundleSizeBytes": 4200000 } }
```

**Caching**: Reads `bundle.meta.json` from disk — no cache.

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

**Purpose**: Trigger a full release dataset sync for a product. Returns a Server-Sent Events stream with progress.

**Auth**: required

**Request**
- Body: `{ productId: string, releases?: string[] }` — `releases` is optional; omit to sync all

**Response**: SSE stream  
```
data: {"step": "fetch", "release": "NDB-2.11", "pct": 20}
data: {"step": "done", "pct": 100, "duration": 45000}
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 409 | Sync already running | Show "Already syncing" |
