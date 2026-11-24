# CFD / CFI API

> **V2 (current):** `/cfdcfi` now mounts `CfdCfiV2Page` (VP-first, unified dashboard). Legacy tabbed pulse contract is preserved when `?timeframe=` is absent. See [CfdCfi feature](../pages/cfdcfi/feature.md) and [Agent brief](../../agent-pack/lighthouse/context/pages/cfdcfi.md).

## GET /api/jira/cfdcfi (V2 — timeframe-aware)

**Purpose**: Live CFD/CFI V2 dashboard — timeframe-scoped heroes (Open / Aged / P0 / P1 / Closed in window), health (MTTR median/p90/throughput/aged-share), 6 breakdowns (by-component, by-fixVersion, age buckets, test-escape, root-cause, linkage), boomerang rate + by-component/by-release, KPI Pulse window override, stacks preview.

**Auth**: required — JIRA token middleware + `kpi_view` (`validateJiraTokenMiddleware` + `apiLimiter`)

**Request**
- Method + path: `GET /api/jira/cfdcfi`
- Query params:
  - `teamId` (string, optional) — sidebar team; defaults to `cfdcfiConfig.defaultTeamId` (`ndb`)
  - `timeframe` (string, optional) — one of `7d` · `15d` · `1M` · `1Q` · `2Q` · `1Y` · `18M` · `Overall`. `Overall` = no `resolved >= -Nd` clause (all closed history). Defaults to `7d`.
  - `v2` (string, optional) — `1` / `true` forces V2 even without `timeframe`; otherwise V2 triggers when `timeframe` is present.

**Server flow — V2**
`GET /api/jira/cfdcfi?timeframe=&v2=1` → `checkKpiViewAuthorization` → `cfdcfiDashboardV2.getDashboard({ token, teamId, timeframe })`:
  1. `resolveRuntimeConfig(teamId)` → `baseScopeJql` (clubbed `kpiConfig` CFD|CFI baseQueries + `teamBaseFilter` AND), `cfdcfiConfig` thresholds (`agedOpenDays` 14, `needInfoDays` 10, `waitingForCustomerDays` 21), `optionalHeroes` p0/p1/tbv, `rag` boomerang threshold
  2. `buildTimeframeHeroQueries(cfg, tf)` composes `closedInWindow = seed AND statusCategory=Done AND resolved >= -Nd` (or no date clause for `Overall`), plus `open = seed AND statusCategory!=Done`, `agedOpen = open AND age> Nd`, `p0Open`/`p1Open` priority slices, `tbv`
  3. Parallel fetch (6-way `Promise.allSettled`): `runCounts(heroQueries)` + `fetchOpenStacks` + `fetchClosedCfdcfiStacks(tf)` + `linkedOut searchCount` + `buildPulse({ baseJql: baseScopeJql, window: computePulseWindow(tf) })` + `fetchDeferredBoomerangs`
  4. Derive `health { mttrMedian, p90, net, throughput, agedShare, churn }` from pulse + hero counts; `breakdowns { byComponent, byFixVersion, ageBuckets, testEscape, rootCause, linkage }` from `cfdcfiStacksService.classifyStacksFromIssues`; `boomerang { keys, rate, deferredTotal, byComponent, byFixVersion }` from deferred-label membership check
  5. `SimpleCache(5m)` per `teamId:timeframe`; soft-fail per hero/pulse

**Response shape — V2**
```json
{
  "success": true,
  "teamId": "ndb",
  "baseScopeJql": "(project in (ERA,NDBECO) OR (project in (shared 10) AND ...)) AND ((filter CFD) OR (filter CFI))",
  "jiraBaseUrl": "https://jira.nutanix.com",
  "agedOpenDays": 14,
  "timeframe": "7d",
  "asOf": "2026-11-24T00:00:00.000Z",
  "elapsedMs": 1800,
  "hero": {
    "open": { "count": 28, "jql": "… AND statusCategory != Done" },
    "agedOpen": { "count": 6, "jql": "… AND statusCategory != Done AND created <= -14d" },
    "closedInWindow": { "count": 41, "jql": "… AND statusCategory = Done AND resolved >= -7d" },
    "p0Open": { "count": 2, "jql": "… AND priority = \"Blocker - P0\" AND statusCategory != Done" },
    "p1Open": { "count": 5, "jql": "… AND priority = \"Critical - P1\" AND statusCategory != Done" },
    "all": { "count": 69, "jql": "…" },
    "tbv": { "count": 1, "jql": "…" }
  },
  "health": { "mttrMedian": 6.2, "p90": 22, "net": -8, "throughput": 41, "agedShare": 21, "churn": 33 },
  "pulse": { "window": { "start": "2026-11-17", "end": "2026-11-24", "label": "Last 7d" }, "heroes": {}, "series": [], "story": "…" },
  "breakdowns": {
    "byComponent": [{ "name": "Upgrade", "count": 9 }],
    "byFixVersion": [{ "name": "NDB-2.12", "count": 12 }],
    "ageBuckets": { "0-7": 12, "8-30": 10, "31-90": 4, "90+": 2 },
    "testEscape": [{ "name": "Yes", "count": 3 }],
    "rootCause": [{ "name": "Code defect", "count": 7 }],
    "linkage": { "thLinked": 8, "techPubsLinked": 2, "totalOpen": 28 }
  },
  "boomerang": {
    "keys": ["ERA-123"],
    "rate": 18,
    "deferredTotal": 22,
    "byComponent": [{ "name": "Upgrade", "count": 2 }],
    "byFixVersion": [{ "name": "NDB-2.11", "count": 3 }],
    "cell": { "count": 4, "jql": "key in (ERA-123, …)" }
  },
  "gapMeta": { "boomerangKeys": ["ERA-123"], "boomerangCells": {} },
  "priorityMix": [{ "name": "Blocker - P0", "count": 2 }],
  "assigneeMix": [{ "name": "Alice", "count": 5 }],
  "componentMix": [{ "name": "Upgrade", "count": 9 }],
  "fixVersionMix": [{ "name": "NDB-2.12", "count": 12 }],
  "openTickets": [{ "key": "ERA-1", "summary": "…", "status": "Open", "priority": "…", "assignee": "…", "ageDays": 5, "components": [], "fixVersions": [] }],
  "stacksPreview": [{ "key": "ERA-1", "summary": "…", "status": "Open", "priority": "Blocker - P0", "ageDays": 12, "components": ["Upgrade"], "cfdcfiFields": { "testEscape": "Yes", "rootCause": "…" } }],
  "closedStacksPreview": [{ "key": "ERA-90", "summary": "…", "resolution": "Fixed", "status": "Closed" }],
  "paths": { "sample": { "openTotal": 28, "openFetched": 28 } }
}
```

`timeframe = "Overall"` omits the `resolved >= -Nd` clause — closed JQL is `seed AND statusCategory=Done` only. Legacy callers omit `timeframe`/`v2` entirely (see legacy section below).

**Error responses**

| HTTP code | When | Client should |
|-----------|------|---------------|
| 403 | No `kpi_view` | Show access denied |
| 500 | JIRA / service failure | Show error; offer Pull retry |

**Caching**: `SimpleCache(5m)` per `teamId:timeframe` in `cfdcfiDashboardV2`; pulse/hero counts also respect `kpiPulseService` soft-fail.

---

## GET /api/jira/cfdcfi/v2

**Purpose**: Explicit V2 alias — same as `GET /api/jira/cfdcfi?timeframe=&v2=1` (defaults `timeframe=7d`).

**Auth**: required · `kpi_view`

**Request**
- Method + path: `GET /api/jira/cfdcfi/v2`
- Query params: `teamId` (optional), `timeframe` (optional, default `7d`)

**Server flow**
`GET /api/jira/cfdcfi/v2` → `cfdcfiDashboardV2.getDashboard({ token, teamId, timeframe })` (same as V2 path above).

**Response shape**: Same as V2 `GET /api/jira/cfdcfi`.

**Caching**: Same as V2.

---

## POST /api/jira/cfdcfi/refresh (V2 variant)

**Purpose**: Explicit Pull from JIRA — same payload as GET. When `timeframe` or `v2` is present the V2 orchestrator runs; otherwise legacy `cfdcfiService` runs.

**Auth**: required — JIRA token + `kpi_view`

**Request**
- Method + path: `POST /api/jira/cfdcfi/refresh`
- Body: `{ "teamId": "ndb", "timeframe": "7d", "v2": "1" }` — `teamId` optional, `timeframe` one of 8 pills, `v2` optional force flag. Query `?timeframe=` also honored.
- Also `POST /api/jira/cfdcfi/v2/refresh` with `{ teamId, timeframe }`.

**Server flow**: `timeframe`/`v2` → `cfdcfiDashboardV2.getDashboard`; else `cfdcfiService.getDashboard`.

**Response shape**: Same as `GET /api/jira/cfdcfi` for the selected shape.

**Caching**: No — Pull bypasses `SimpleCache` for hero counts? Server still returns via `heroCache.get` fast path (5m) on GET; POST forces fresh via `runCounts` + `fetchOpenStacks` (same as OnCalls V2).

---

## POST /api/ai/cfdcfi-concern

**Purpose**: Fused CFD/CFI AI concern for the VP — merges open/aged/closed/MTTR/net/aged-share + boomerang rate + hotspot component top-2 + breakdown linkage into ~100 words (Quantitative 40–45w + Qualitative 45–50w + Hotspot 50–60w + 2-line chase). Triggered on timeframe/hero/breakdown/boomerang change and on demand. Loom builds prompt, Lighthouse calls NAI (D44).

**Auth**: required — `validateJiraTokenMiddleware` (JIRA Bearer for dashboard re-fetch when `dashboard` snapshot missing)

**Request**
- Method + path: `POST /api/ai/cfdcfi-concern`
- Body:
  ```json
  {
    "teamId": "ndb",
    "timeframe": "7d",
    "dashboard": { "hero": {}, "health": {}, "breakdowns": {}, "boomerang": {}, "componentMix": [], "gapMeta": {}, "agedOpenDays": 14, "stacksPreview": [], "openTickets": [] }
  }
  ```
  `dashboard` is optional — when missing or lacking `hero`, server re-fetches via `cfdcfiDashboardV2.getDashboard({ token, teamId, timeframe })`.

**Server flow**
`POST /api/ai/cfdcfi-concern` → optionally `cfdcfiDashboardV2.getDashboard` → build `concernInput { timeframe, hero, health, breakdowns, boomerang, componentMix, validKeys (gapMeta.boomerangKeys→openTickets), agedOpenDays, gapMeta, stacksPreview }` → `naiService.generateCfdcfiConcern(concernInput)` (`CFDCFI_CONCERN` system prompt + `buildCfdcfiConcernPrompt`) → `{ summary }`. Prompt includes `VALID TICKET KEYS` — model must copy keys verbatim.

MCP split: `mcp/shared/tools/buildCfdcfiPrompt.ts` `build_cfdcfi_prompt` (Loom, JIRA pull + prompt build, no NAI) → `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts` `generate_cfdcfi_brief` (Lighthouse, calls `shared/src/connectors/aiConnector.ts` `chatCompletion`).

**Response shape**
```json
{ "summary": "Quantitative: 40-45w counts … Qualitative: … Hotspot: … Ask …", "intelligence": { "timeframe": "7d", "hero": {}, "health": {}, "breakdowns": {}, "boomerang": {} }, "timeframe": "7d", "generatedAt": "2026-11-24T00:00:00.000Z" }
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | `NAI_API_KEY` not configured on server | Show admin hint — set `NAI_API_KEY` in `server/.env` (same as `oncall-concern`/`oncall-slice`/`exec-summary`); page keeps quantitative heroes/pulse/breakdowns |
| 502 | NAI gateway returned empty / upstream failure | Retry; quantitative page still works |
| 504 | NAI timeout | Retry |

**Caching**: No.

---

## POST /api/ai/cfdcfi-slice

**Purpose**: Per-view AI 2-liner + fix suggestion for the CFD/CFI drill drawer — scoped to the selected breakdown/hero chip and its top keys. Regenerates when pill or chip changes; inherits timeframe. Drawer linkifies `VALID TICKET KEYS`.

**Auth**: required — `validateJiraTokenMiddleware`

**Request**
- Method + path: `POST /api/ai/cfdcfi-slice`
- Body:
  ```json
  {
    "teamId": "ndb",
    "view": "component:Upgrade",
    "keys": ["ERA-90001", "ERA-90002"],
    "timeframe": "7d",
    "meta": { "count": 9, "agedDays": 14, "testEscape": "Yes" }
  }
  ```
  `view` is chip/hero id (`open` / `agedOpen` / `p0Open` / `p1Open` / `closedInWindow` / `mttr` / `throughput` / `component:<name>` / `fixVersion:<ver>` / `ageBucket:0-7` … / `testEscape` / `boomerang` / `thLinked`), `keys` capped to 20, `timeframe` inherited from pills, `meta` carries chip count + thresholds.

**Server flow**
`POST /api/ai/cfdcfi-slice` → `naiService.generateCfdcfiSlice({ view, keys, timeframe, meta })` (`CFDCFI_SLICE` system prompt + `buildCfdcfiSlicePrompt`) → `{ summary }`. Same `400 NAI_API_KEY not configured` guard as `cfdcfi-concern`.

**Response shape**
```json
{ "summary": "Line 1: why stuck (age/test-escape/boomerang) …\\nLine 2: Ask <owner> to <action> on ERA-90001 by 7d …", "view": "component:Upgrade", "keys": ["ERA-90001"], "timeframe": "7d", "generatedAt": "2026-11-24T00:00:00.000Z" }
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | `NAI_API_KEY` not configured | Show setup hint; drawer still renders tickets + JQL proof |
| 502 / 504 | NAI failure / timeout | Retry; quantitative drawer still works |

**Caching**: No.

---

## Legacy — GET /api/jira/cfdcfi (tabbed pulse, no timeframe)

**Purpose**: (Pre-V2) Live dashboard for team KPIs whose names match CFD/CFI — one tab per KPI with pulse + open-ticket sample. Preserved when `?timeframe=` is absent and `v2` is not set.

**Auth**: required — JIRA token middleware + `kpi_view`

**Request**
- Method + path: `GET /api/jira/cfdcfi`
- Query params:
  - `teamId` (string, optional) — sidebar team; defaults via service
- Required headers: JIRA auth headers used by `validateJiraTokenMiddleware`

**Server flow**
Route `cfdcfi.js` (no `timeframe`/`v2`) → `checkKpiViewAuthorization` → `cfdcfiService.getDashboard` → `kpiConfig` / `buildKpiCombinedJql` / `buildPulse` / JIRA search per KPI tab → `{ kpis: [{ pulse, openTickets }] }`.

**Response shape**
```json
{
  "success": true,
  "teamId": "ndb",
  "jiraBaseUrl": "https://jira.nutanix.com",
  "kpiNamePattern": "CFD|CFI",
  "asOf": "2026-10-16T18:00:00.000Z",
  "kpis": [
    {
      "id": "kpi_…",
      "name": "Top-CFD",
      "baseQuery": "filter=142537",
      "combinedJql": "(…team…) AND (…)",
      "pulse": { "heroes": {}, "series": [], "story": "…" },
      "openTickets": {
        "total": 12,
        "truncated": false,
        "jql": "… AND statusCategory != Done",
        "issues": [{ "key": "ERA-1", "summary": "…", "status": "Open", "priority": "…", "assignee": "…", "ageDays": 5 }]
      }
    }
  ]
}
```

**Error responses**

| HTTP code | When | Client should |
|-----------|------|---------------|
| 403 | No `kpi_view` | Show access denied |
| 500 | JIRA / service failure | Show error; offer Pull retry |

**Caching**: No

---

## POST /api/jira/cfdcfi/refresh (legacy — no timeframe)

**Purpose**: Explicit Pull from JIRA — same payload as legacy GET.

**Auth**: required — JIRA token + `kpi_view`

**Request**
- Body: `{ "teamId": "ndb" }` (optional)

**Server flow**: Same as legacy GET (no `timeframe` → `cfdcfiService`).

**Response shape**: Same as legacy GET.

**Caching**: No
