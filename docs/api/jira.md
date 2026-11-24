# API Contract — `/api/jira/*`

**Route file**: `server/routes/jira/index.js`  
**Auth**: most endpoints require `validateJiraTokenMiddleware`; noted where different  
**Mounted at**: `/api/jira`

This file covers the ~40 endpoints in `jira/index.js`. Grouped by domain.

---

## Diagnostics & Validation

### GET /api/jira/jira-diagnostic

**Purpose**: Test JIRA connectivity and return API version + current user info.

**Auth**: validates token from query/header

**Response**: `{ user, serverInfo, status: "ok" }`

---

### POST /api/jira/test-jql

**Purpose**: Run a test JQL query and return the count + first 10 keys. For dev/debug.

**Auth**: required

**Request** — Body: `{ jql: string }`

**Response**: `{ total, issues: [{ key }] }`

---

### POST /api/jira/validate

**Purpose**: Validate a JIRA token — returns the authenticated user's profile.

**Auth**: token from body

**Request** — Body: `{ token: string, username: string }`

**Response**: `{ valid: true, user: { displayName, email, accountId } }`

---

## Search & Fetch

### POST /api/jira/search-by-jql

**Purpose**: Generic JQL search — returns issues with requested fields.

**Auth**: required

**Request** — Body: `{ jql: string, fields: string[], maxResults?: number, startAt?: number }`

> ⚠️ JQL approval rule applies — any change to JQL passed by callers requires approval.

**Response**: `{ issues: [...], total, startAt, maxResults }`

---

### POST /api/jira/fetch-all-jira-tickets

**Purpose**: Paginated bulk fetch of all tickets matching a JQL, up to a high limit (e.g. 10 000).

**Auth**: required

**Request** — Body: `{ jql: string, fields: string[], batchSize?: number }`

**Response**: `{ issues: [...], total }`

---

### POST /api/jira/fetch-epics

**Purpose**: Fetch all epics for a set of parent keys.

**Auth**: required

**Request** — Body: `{ parentKeys: string[], productId: string }`

**Response**: `{ epics: [...] }`

---

### POST /api/jira/fetch

**Purpose**: Generic JIRA fetch — passes a pre-built request config to the connector. Lower-level than `search-by-jql`.

**Auth**: required

**Request** — Body: `{ endpoint: string, method: string, params?: object, body?: object }`

---

## KPI

### POST /api/jira/kpi-results

**Purpose**: Run a single KPI query for a team and return the result (count + JIRA link).

**Auth**: required

**Request** — Body: `{ teamId, kpiId, release, productId }`

**Response**: `{ kpiId, label, count, jql, jiraUrl }`

---

### POST /api/jira/kpi-results-batch

**Purpose**: Run all KPI queries for a team in parallel and return results array.

**Auth**: required

**Request** — Body: `{ teamId, release, productId, kpiIds?: string[] }`

**Response**: `{ results: [{ kpiId, label, count, jql, jiraUrl }] }`

---

### POST /api/jira/release-kpi-results

**Purpose**: Run a single release-level KPI query (not team-scoped).

**Auth**: required

**Request** — Body: `{ kpiId, release, productId }`

**Response**: `{ kpiId, label, count, jql, jiraUrl }`

---

### POST /api/jira/release-kpi-results-batch

**Purpose**: Batch release-level KPI queries — powers `ReleaseBriefPage` KPI cards.

**Auth**: required

**Request** — Body: `{ release, productId, kpiIds?: string[] }`

**Response**: `{ results: [{ kpiId, label, count, jql, jiraUrl }] }`

---

### POST /api/jira/release-kpi-breakdown-batch

**Purpose**: For each team KPI, return `total` / `done` / `open` counts scoped to
a release version, split by resolution. Powers the Retrospective page's
Cross-Release Comparison "KPI Categories" rows, and leader-scoped KPI chips on
SoS by Leader (via optional `jqlExtra`).

**Auth**: required — KPI view authorization (same gate as `kpi-results-batch`).

**Request**
- Method + path: `POST /api/jira/release-kpi-breakdown-batch`
- Required headers: `x-jira-token` (PAT), `x-username`
- Body params:
  - `releaseVersion` (string, required) — e.g. `NDB-2.11`
  - `teamId` (string, required) — team key whose KPI config is used
  - `jqlExtra` (string, optional) — AND-ed onto every bucket JQL (e.g.
    `"Assignee Manager" in ("Jovan Cukalovic", …)` for leader SoS)

**Server flow**
Route (`routes/jira/kpi.js`) → `kpiService.getReleaseKpiResolutionBreakdown`
→ per KPI builds `buildReleaseKpiResolutionJql(total|done|open)` (release base
filter + KPI filter + optional `jqlExtra` + resolution/status clause) →
`jira.searchCount` (count-only, maxResults=0) for each bucket.

**Response shape**
```json
{
  "success": true,
  "results": {
    "product-blockers": {
      "name": "Product Blockers",
      "total": 12,
      "done": 9,
      "open": 3,
      "links": {
        "total": "fixVersion = \"NDB-2.11\" and (...) ",
        "done": "... and resolution in (Fixed, Done, Resolved, Complete)",
        "open": "... and status not in (Done, Closed)"
      }
    },
    "system-test": { "error": "..." }
  }
}
```
Per-KPI `error` strings are returned inline; a failing KPI does not fail the batch.

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | `releaseVersion` or `teamId` missing | fix request |
| 403 | not KPI-view authorized | hide the comparison KPI rows |
| 5xx | JIRA/query failure | show error, allow retry |

**Caching**: No server cache. Client caches per (teamId, releaseSet) via the
`useRetroComparison` hook key; no auto-refetch on empty results.

> JQL buckets approved via the richer-retrospective plan (2026-09-21):
> `total = <releaseBaseFilter> AND (<kpiPart>)`;
> `done = total AND resolution in (Fixed, Done, Resolved, Complete)`;
> `open = total AND status not in (Done, Closed)`. `excludeDeferred` KPIs also
> append the deferred-label exclusion.

---

## Issue Breakdown & History

### POST /api/jira/issue-breakdown

**Purpose**: Break down a set of issue keys by issue type group (Project Hierarchy / Bug / Dev Code / Test / etc.).

**Auth**: required

**Request** — Body: `{ keys: string[], productId: string }`

**Response**: `{ breakdown: { "Bug": 34, "Dev Code": 120, ... } }`

---

### POST /api/jira/checkpoint-history

**Purpose**: Fetch the date-history of a custom field (e.g. gate date changes over time) for a set of tickets.

**Auth**: required

**Request** — Body: `{ keys: string[], fieldId: string, productId: string }`

**Response**: `{ history: [{ key, changes: [{ date, from, to }] }] }`

---

## Release Versions

### POST /api/jira/release-versions

**Purpose**: List versions in the selected team's JIRA project (`GET /project/{projectKey}/versions`). Default is unreleased only; pass `includeReleased: true` for Retrospective and other past-release pickers.

**Auth**: required + `releaseVersions` permission

**Request** — Body:
- `teamId` (string, required). No fallback to another team when missing or unknown.
- `includeReleased` (boolean, optional, default `false`). When `true`, also return shipped (`released: true`) versions. Archived versions are always excluded.

**Server flow**
`jira/versions.js` → `releaseDataService.listOpenReleaseVersions` → `listFixVersionsForTeam` → `GET /rest/api/2/project/{team.projectKey}/versions` → drop archived → optionally keep released → pick next upcoming unreleased `releaseDate` as `defaultVersion`

**Response shape**
```json
{
  "success": true,
  "versions": [
    { "name": "MSP-2.1", "released": false, "releaseDate": "2026-10-01" },
    { "name": "MSP-2.0", "released": true, "releaseDate": "2026-01-01" }
  ],
  "projectKey": "ENG",
  "defaultVersion": "MSP-2.1",
  "teamId": "prism-infra"
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | teamId missing, unknown, or team has no `projectKey` | Show Fetch / Admin error |
| 429 | JIRA rate limit | Retry later |

**Caching**: ~10 min per team on the server (shared across includeReleased true/false).

> ⚠️ Breaking change in 2026-08-26: versions are unreleased names from `GET /project/{team.projectKey}/versions` (one call). No ticket search.
>
> 2026-10-15: optional `includeReleased` for Retrospective past-release dropdown. Default behaviour unchanged.

---

### POST /api/jira/discover-versions

**Purpose**: Auto-discover release versions from JIRA that match the product naming pattern.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ productId: string, pattern?: string }`

**Response**: `{ versions: [...] }`

---

### POST /api/jira/check-version-exists

**Purpose**: Check if a version name already exists before creating.

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ versionName: string, projectKey: string }`

**Response**: `{ exists: boolean, version?: { id, name } }`

---

### POST /api/jira/create-version

**Purpose**: Create a new JIRA release version.

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ name: string, description?: string, releaseDate?: string, projectKey: string }`

**Response**: `{ success: true, version: { id, name, self } }`

---

### POST /api/jira/rename-release-cascade

**Purpose**: Cascade-rename a release and all companion versions (NDB-2.11 → NDB-2.12, plus .1, .1.1, etc.).

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ oldName: string, newName: string, projectKey: string, dryRun?: boolean }`

**Response**: `{ success: true, renamed: [{ id, oldName, newName }], errors: [] }`

---

## Filters

### POST /api/jira/check-filter-exists

**Auth**: required + `releaseSetup` permission  
**Request** — Body: `{ filterName: string }`  
**Response**: `{ exists: boolean, filter?: { id, name } }`

---

### POST /api/jira/create-filter

**Auth**: required + `releaseSetup` permission  
**Request** — Body: `{ name: string, jql: string, description?: string }`  
**Response**: `{ success: true, filter: { id, name, self } }`

---

### POST /api/jira/cleanup-duplicate-prefix-filters

**Purpose**: Remove duplicate JIRA filters that have a redundant prefix from a rename operation.

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ prefix: string, dryRun?: boolean }`

**Response**: `{ deleted: [{ id, name }], errors: [] }`

---

## Sprints

### GET /api/jira/sprints

**Purpose**: List sprints for a board.

**Auth**: required + `sprintReport` permission

**Request** — Query: `boardId` (number, required)

**Response**: `{ sprints: [{ id, name, state, startDate, endDate }] }`

---

### POST /api/jira/sprints

**Purpose**: (Alternate) List sprints — accepts boardId in body for clients that can't use query params.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ boardId: number }`

**Response**: same as GET

---

### GET /api/jira/project-components

**Purpose**: List components for a JIRA project.

**Auth**: required + `sprintReport` permission

**Request** — Query: `projectKey` (string, required)

**Response**: `{ components: [{ id, name }] }`

---

### POST /api/jira/sprint-report

**Purpose**: Full sprint report for a team/sprint — velocity, resolution breakdown, issue type breakdown.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, sprintId, boardId, startDate, endDate, productId }`

**Response**:
```json
{
  "dev": { "count": 47, "storyPoints": 89, "jql": "..." },
  "qaVerification": { "count": 18, "adjustedCount": 5.94, "jql": "..." },
  "qaTestTasks": { "count": 12, "storyPoints": 24, "jql": "..." },
  "resolutionBreakdown": { "Done": 47, "Unresolved": 5, "Duplicate or Not Reproducible": 3, "Others": 2 }
}
```

---

### POST /api/jira/sprint-report-by-range

**Purpose**: Sprint report across a date range (e.g., a fiscal quarter) — returns per-sprint data.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, boardId, startDate, endDate, productId }`

**Response**: `{ sprints: [ /* per-sprint report objects */ ] }`

---

### POST /api/jira/sprint-kpi-breakdown

**Purpose**: KPI breakdown per sprint — used for multi-sprint trend charts.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, boardId, sprintIds: number[], productId }`

---

### POST /api/jira/sprint-report-trends

**Purpose**: Multi-sprint trend data — velocity over time, issue type trends.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, boardId, startDate, endDate, productId }`

---

### POST /api/jira/sprint-gantt-data

**Purpose**: Gantt chart data for sprint-based tickets — resolves sprint end dates for timeline bars.

**Auth**: required

**Request** — Body: `{ keys: string[], productId: string }`

**Response**: `{ items: [{ key, summary, startDate, endDate, issueType }] }`

---

## Release Items

### POST /api/jira/release-items

**Purpose**: Live Feature/Initiative items for Project Status. Always JIRA; disk cache is ignored.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ fixVersions: string[], teamId: string }` (both required)

**Server flow**  
`jira/versions.js` → `releaseItemsDataService.fetchAllItemsAcrossVersions` → wrap `(${team.baseFilter}) AND ((fixVersion = "…" OR labels = "<labelPrefix>-<suffix>-long-term-funded") AND issuetype IN (Feature, Initiative) AND status != Cancelled) ORDER BY key ASC`

**Response**: `{ success: true, data: { allItems: [...] } }`

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | no team, no `baseFilter`, empty `fixVersions`, or JIRA rejected the JQL | Show the server `error` string (JIRA message when present) |

---

### POST /api/jira/release-items-history

**Purpose**: Checkpoint date history for Project Status — walks JIRA changelog per ticket for Code Complete / Commit Gate / Promotion Gate (and FS/DS, Test Plan, Status Update Date). Powers the struck-through old dates and `moved N times by X weeks` label on `/project-status` (also used by `/sos-summary` via `/sos-items-history`).

**Duration rule** (fixed 2026-11): `weeks = |current - first ever set|`, not `max - min`. A revert to the original date shows `0 weeks` (a spike-then-revert no longer shows phantom delay). Count stays `distinct values - 1`.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ fixVersion: string, teamId?: string }` — server resolves item keys via the same JQL as `/release-items`, then `fetchFieldHistoryForMultiple` per key.

---

### POST /api/jira/release-items-tcms

**Purpose**: Enrich release items with TCMS (test management) data.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string }`

> TCMS time-filtered (Last 4 weeks) metrics use `/api/v1/all_test_cases/aggregate/metrics` (`time_filter=four_weeks`, `target={milestone}-qcow2`); see `../tcms-rows-followup.md`.

---

## Executive Summary

### PUT /api/jira/update-executive-summary

**Purpose**: Write an updated executive summary string to a JIRA field.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ issueKey: string, summary: string }`

---

### POST /api/jira/generate-exec-summary

**Purpose**: AI-generate an executive summary for a release payload. Returns generated text.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string, teamId?: string }`

**Response**: `{ summary: string, generatedAt: string }`

---

### POST /api/jira/enhanced-exec-summary

**Purpose**: Enhanced (richer) AI executive summary with predictive analytics section.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string, teamId?: string }`

---

## Risk & Misc

### POST /api/jira/risk-indicator-changes

**Purpose**: Fetch the history of risk indicator changes for items in a release.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string }`

---

### GET /api/jira/fields

**Purpose**: Return JIRA field metadata — field IDs and display names. Used by column configurator in JIRA Emailer.

**Auth**: required

**Response**: `{ fields: [{ id, name, type }] }`

---

### GET /api/jira/team-configurations

**Purpose**: Return team configurations visible to the current user.

**Auth**: `releaseVersions` permission

**Response**: `{ teams: [{ id, name, boardId, kpiConfig }] }`

---

### POST /api/jira/log-user-action

**Purpose**: Server-side audit log for significant user actions (e.g., email sent, release renamed).

**Auth**: none (fire-and-forget from client; no sensitive data logged)

**Request** — Body: `{ action: string, meta?: object }`

**Response**: `{ logged: true }`

---

### GET /api/jira/test-changelog/:key

**Purpose**: Dev/debug endpoint — return the full changelog for a JIRA ticket key.

**Auth**: required

**Request** — Path: `key` (JIRA issue key)

**Response**: `{ changelog: [...] }`

---

## System-Test Scale

### GET /api/jira/system-test-scale

**Purpose**: Return live System-Test scale dashboard counts, per-metric JQL, RAG, components, release-over-release trends, and label-based ST pulse (filters 188191–188195) scoped by team KPI `filter={teamCode}-System-Test` with `cf[13260]` regression typing.

**Auth**: required · KPI view authorization (`kpi_view`)

**Request**
- Method + path: `GET /api/jira/system-test-scale`
- Query params:
  - `teamId` (string, optional) — team board id (e.g. `ndb`); resolves `teamCode` → `filter={teamCode}-System-Test`
  - `currentRelease` (string, optional) — e.g. `NDB-2.11`
  - `compareRelease` (string, optional) — e.g. `NDB-2.10`
- Required headers: JIRA token (middleware)

**Server flow**
Route handler → `checkKpiViewAuthorization` → `systemTestScaleService.getDashboard({ teamId, … })` → resolve teamCode / kpiFilter → parallel `jira.searchCount` → assemble payload

**Response shape**
```json
{
  "success": true,
  "generatedAt": "2026-10-08T06:00:00.000Z",
  "fetchSeconds": 52.3,
  "teamId": "ndb",
  "teamCode": "NDB",
  "kpiFilter": "filter=NDB-System-Test",
  "regressionField": "cf[13260]",
  "currentRelease": "NDB-2.11",
  "compareRelease": "NDB-2.10",
  "rag": { "level": "yellow", "why": "..." },
  "current": { "open": { "count": 19, "jql": "..." }, "rates": { "regressionRate": 8.1 } },
  "compare": { },
  "byRelease": { },
  "stPulse": {
    "global": { "all": { "count": 0, "jql": "..." }, "open": {}, "resolvedNotClosed": {} },
    "byRelease": { "NDB-2.12": { "affectedOpen": {}, "fixVersionOpen": {} } },
    "sourceFilters": { "all": 188191, "open": 188192, "resolvedNotClosed": 188193, "affectedOpen": 188194, "fixVersionOpen": 188195 },
    "byLabel": {
      "longevity": { "key": "longevity", "title": "Longevity", "label": "longevity", "all": {}, "open": {} },
      "smoke": { "key": "smoke", "title": "System Smoke", "label": "ndb-system-smoke-test", "all": {}, "open": {} },
      "functional": { "key": "functional", "title": "Functional (ST-found)", "label": "ndb-systest-found-functional-bug", "all": {}, "open": {} },
      "scale": { "key": "scale", "title": "Scale", "label": "ndb-scale", "all": {}, "open": {} }
    }
  },
  "trends": { "series": [], "rateSeries": [] },
  "components": { },
  "carry": { }
}
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Team has no releases in `systemTestScaleConfig.teams` | Show configure message |
| 403 | User lacks KPI view | Show access denied |
| 500 | JIRA / internal failure | Show error + retry |

**Caching**
No — always live JIRA `searchCount`.

---

### POST /api/jira/system-test-scale/refresh

**Purpose**: Explicit pull — same live re-count as GET (user-triggered Refresh).

**Auth**: required · KPI view authorization

**Request**
- Method + path: `POST /api/jira/system-test-scale/refresh`
- Body params:
  - `teamId` (string, optional)
  - `currentRelease` (string, optional)
  - `compareRelease` (string, optional)
- Required headers: JIRA token

**Server flow**
Route handler → `getDashboard` → respond

**Response shape**
Same as GET `/api/jira/system-test-scale`.

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Team not configured for System-Test | Show configure message |
| 403 | No KPI view | Show access denied |
| 500 | Refresh failed | Show error + retry |

**Caching**
No.

---

## KPI Pulse (shared kit — service contract)

**Not a standalone route.** Page APIs (OnCalls, System-Test Scale, future KPI pages) call `kpiPulseService.buildPulse` and attach the result as `pulse` on their response. UI mounts `client/src/components/KpiPulse/KpiPulseBand`.

**Purpose**: Reusable last-2-Nutanix-Q analytics — exec heroes, weekly created vs resolved, MTTR, status dwell, product-impact shell. Only `baseJql` changes per page.

**Service**: `server/services/kpiPulseService.js` → `buildPulse({ token, baseJql, quarterCount?, agedOpenDays?, sampleCap?, optionalHeroes?, productImpact? })`

**Quarters**: `server/utils/nutanixQuarters.js` — Q1 starts 01-Aug; default window = last 2 quarters through today.

**Skill / rule**: `agent-pack/skills/kpi-pulse-analytics/SKILL.md`, `.cursor/rules/kpi-pulse-analytics.mdc`

**Response shape (`pulse`)**
```json
{
  "window": { "start": "2026-05-01", "end": "2026-10-16", "label": "Last 2 Nutanix Qs (…)", "quarters": ["Q4 FY25", "Q1 FY26"] },
  "story": "Falling behind — created 148 vs resolved 136 (net -12). Typical wait 4.2d. …",
  "seriesCaption": "Created ahead of resolved in 12 of 24 weeks.",
  "heroes": {
    "openNow": { "count": 12, "jql": "…" },
    "createdWindow": { "count": 148, "jql": "…" },
    "resolvedWindow": { "count": 136, "jql": "…" },
    "netBurn": { "count": -12, "createdCount": 148, "resolvedCount": 136, "jql": null, "label": "-12" },
    "mttrMedian": { "count": 4.2, "unit": "days", "jql": "…", "sampleSize": 80, "truncated": false },
    "mttrP90": { "count": 18, "unit": "days", "jql": "…", "sampleSize": 80, "truncated": false },
    "agedOpen": { "count": 9, "jql": "…" },
    "topDwellStatus": { "status": "Waiting for customer", "count": 6, "unit": "days", "jql": null }
  },
  "series": [{ "weekStart": "2026-05-04", "created": { "count": 3, "jql": "…" }, "resolved": { "count": 2, "jql": "…" } }],
  "mttr": { "medianDays": 4.2, "p90Days": 18, "sampleSize": 80, "truncated": false, "jql": "…" },
  "statusDwell": [{ "status": "Waiting for customer", "medianDays": 6, "sampleSize": 20, "jql": null }],
  "productImpact": { "summary": null, "generatedAt": null, "citations": [] },
  "asOf": "2026-10-16T12:00:00.000Z",
  "baseJql": "(…)"
}
```

**Caching**: No durable cache — computed on each page dashboard load / Pull.

**JQL**: Composes date/status clauses onto the caller’s `baseJql` only; does not edit `kpiConfig` baseQuery strings.

---

## OnCalls

> **V2 (current):** `/oncalls` now mounts `OncallsV2Page` (VP-first, timeframe pills). Legacy pulse-only contract is preserved for backward compat when `?timeframe=` is absent.

### GET /api/jira/oncalls (V2 — timeframe-aware)

**Purpose**: Live OnCalls V2 dashboard — timeframe-scoped heroes (Open / Aged / Need Info / Waiting for Customer / Closed in window), workflow buckets, gap taxonomy (duds / NDB gaps / other-team + NDB sub-drill), health MTTR/throughput, KPI Pulse window override, component hotspot.

**Auth**: required · KPI view authorization (`kpi_view`)

**Request**
- Method + path: `GET /api/jira/oncalls`
- Query params:
  - `teamId` (string, optional) — team board id (e.g. `ndb`)
  - `timeframe` (string, optional) — one of `7d` (legacy default) · `15d` · `1M` · `1Q` · `2Q` · `1Y` · `18M` · `Overall`. If `Overall`, server omits the date clause (all history). Defaults to `7d` when omitted.
  - `v2` (string, optional) — `1` / `true` forces V2 even without `timeframe`; otherwise V2 triggers when `timeframe` is present.
- Required headers: JIRA token (middleware via `validateJiraTokenMiddleware` + `apiLimiter`)

**Server flow — V2**
`GET /api/jira/oncalls?timeframe=` → `checkKpiViewAuthorization` → `oncallDashboardV2.getDashboard({ token, teamId, timeframe })`:
  1. `resolveRuntimeConfig(teamId)` → `baseScopeJql`, `onCallProject`, `techHelpProjects`, `needInfoDays`/`waitingForCustomerDays`, `agedOpenDays`
  2. `buildTimeframeHeroQueries(cfg, timeframe)` composes `closedInWindow = seed AND statusCategory=Done AND resolved >= -Nd` (or no date clause for Overall), plus `needInfoOpen = statusCategory!=Done AND status="Need Info"` and `waitingCustomerOpen = statusCategory!=Done AND status="Waiting for Customer"`
  3. Parallel JIRA fetch (5-way `Promise.allSettled`): `runCounts(heroQueries)` + `fetchOpenStacks` + `fetchClosedStacks(timeframe)` + `linkedOut searchCount` + `buildPulse({ baseJql, windowOverride })`
  4. `computeWorkflowBuckets`, `classifyGapBuckets` → `buildGapCells`, `classifyNdbSubGaps` → `buildNdbSubCells`, `health { mttrMedian, p90, net, throughput, agedShare }`, `pulse` (window = `computePulseWindow(timeframe)`, Overall → default 2Q)
  → respond `{ success: true, timeframe, hero, workflow, gapTaxonomy, gapMeta, health, pulse, paths, componentMix, … }`

**Backward compat — legacy (no timeframe, no v2 flag)**
Route handler delegates to `oncallService.getDashboard` → counts + stacks + `buildPulse({ baseJql: baseScopeJql })` (soft-fail) + escalation. See legacy response below.

**Response shape — V2**
```json
{
  "success": true,
  "teamId": "ndb",
  "onCallProject": "OnCall",
  "baseScopeJql": "filter = NDB-OnCalls",
  "timeframe": "2Q",
  "asOf": "2026-10-16T09:00:00.000Z",
  "elapsedMs": 4200,
  "hero": {
    "open": { "count": 43, "jql": "filter=NDB-OnCalls AND statusCategory != Done" },
    "agedOpen": { "count": 9, "jql": "filter=NDB-OnCalls AND statusCategory != Done AND statusCategory != Done …" },
    "needInfoOpen": { "count": 6, "jql": "filter=NDB-OnCalls AND statusCategory != Done AND status = \"Need Info\"" },
    "waitingCustomerOpen": { "count": 4, "jql": "filter=NDB-OnCalls AND statusCategory != Done AND status = \"Waiting for Customer\"" },
    "closedInWindow": { "count": 87, "jql": "project = OnCall AND filter=NDB-OnCalls AND statusCategory = Done AND resolved >= -180d" },
    "p0Open": { "count": 1, "jql": "... AND priority = P0 AND statusCategory != Done" }
  },
  "workflow": {
    "needInfo": { "count": 6, "jql": "…" },
    "waiting": { "count": 4, "jql": "…" }
  },
  "gapTaxonomy": {
    "duds": { "count": 21, "jql": "key in (ONCALL-1, …)" },
    "ndbGaps": { "count": 38, "jql": "key in (…)" },
    "otherTeamGaps": { "count": 28, "jql": "key in (…)" },
    "ndbSub": {
      "thLinked": { "count": 12, "jql": "key in (…)" },
      "bugs": { "count": 18, "jql": "key in (…)" },
      "improvements": { "count": 5, "jql": "key in (…)" },
      "other": { "count": 3, "jql": "key in (…)" }
    }
  },
  "gapMeta": {
    "dudsKeys": ["ONCALL-1"],
    "ndbGapsKeys": ["ONCALL-2"],
    "otherTeamGapsKeys": ["ONCALL-9"],
    "ndbSubKeys": { "thLinked": [], "bugs": [], "improvements": [], "other": [] }
  },
  "health": { "mttrMedian": 4.2, "p90": 18, "net": -12, "throughput": 87, "agedShare": 21, "churn": 88 },
  "pulse": { "window": { "start": "2026-05-01", "end": "2026-10-16", "label": "Last 2Q" }, "story": "...", "heroes": {}, "series": [] },
  "paths": { "withTechHelp": { "count": 4, "jql": "key in (...)" } },
  "componentMix": [{ "name": "Upgrade", "count": 7 }],
  "priorityMix": [],
  "assigneeMix": [],
  "openTickets": [],
  "stacksPreview": [],
  "closedStacksPreview": []
}
```

Legend: `timeframe = "Overall"` sends no `resolved >= -Nd` clause — JQL is `seed AND statusCategory=Done` only. Legacy callers omit `timeframe` entirely.

**Gap taxonomy (V2)**
- `duds` — closed OnCall where `resolution ∈ {Duplicate, Won't Do, Cannot Reproduce, Invalid}` **or** no linked fix.
- `ndbGaps` — linked fix projectKey starts with `NDB` (or tenant `gapProjectPrefixes`) or component contains NDB.
- `otherTeamGaps` — remainder with a linked fix outside NDB.
- NDB sub-drill inside `ndbGaps`: `thLinked` (has TH) · `bugs` (linked Bug) · `improvements` (Improvement/Story/Task) · `other`.

Counts are `key in (...)` proofs; all use `baseScopeJql` as seed. See `server/services/oncallGapService.js` (`DUD_RESOLUTIONS`, `classifyGapBuckets`, `classifyNdbSubGaps`).

**Timeframe pills**
`TIMEFRAMES = { 7d:7, 15d:15, 1M:30, 1Q:90, 2Q:180, 1Y:365, 18M:540, Overall:null }` — `timeframeClause('resolved', tf)` returns `resolved >= -Nd` or `null` for Overall. Pill selection drives heroes / health / pulse window / gap window together (global pills, inherit in drawers).

**Legacy response (no timeframe)**
```json
{
  "success": true,
  "teamId": "ndb",
  "onCallProject": "OnCall",
  "baseScopeJql": "filter = NDB-OnCalls",
  "asOf": "2026-10-16T09:00:00.000Z",
  "pulse": { "window": {}, "story": "...", "heroes": {}, "series": [] },
  "hero": { "open": { "count": 12, "jql": "..." } },
  "paths": { "withTechHelp": { "count": 4, "jql": "key in (...)" } },
  "escalation": { "cells": {}, "rows": [] },
  "rag": { "level": "YELLOW", "why": "..." },
  "stacksPreview": [],
  "assigneeMix": [],
  "priorityMix": []
}
```

`pulse` follows `kpiPulseService.buildPulse` (see KPI Pulse kit section). If pulse fails, `pulse` is `null` and `errors.pulse` is set; path/escalation still return.

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 403 | No KPI view | Show access denied |
| 500 | Dashboard failed | Show error + retry |

**Live JQL verification** (STALE — re-run before sign-off): `curl -H "Authorization: Bearer $PAT" "$HOST/api/jira/oncalls?teamId=ndb&timeframe=Overall"` must return `hero.open.jql` without `resolved >=` clause. For non-Overall, `hero.closedInWindow.jql` must contain `resolved >= -Nd`.

**Caching**
No — live on load / Pull.

### POST /api/jira/oncalls/refresh

**Purpose**: Explicit Pull from JIRA — same payload as GET (timeframe-aware when `timeframe` or `v2` present, else legacy).

**Auth**: required · `kpi_view`

**Request**
- Method + path: `POST /api/jira/oncalls/refresh`
- Body: `{ "teamId": "ndb", "timeframe": "2Q", "v2": "1" }` — `teamId` optional, `timeframe` one of the 8 pills, `v2` optional force flag. Query `?timeframe=` also honored.
- Also accepts `teamId` in query for bookmarked pulls.

**Response shape**
Same as GET `/api/jira/oncalls` for the selected timeframe (V2) or legacy shape when no timeframe.

**Caching**
No.

### GET /api/jira/oncalls/v2

**Purpose**: Explicit V2 alias — same as `GET /api/jira/oncalls?timeframe=&v2=1` (defaults `timeframe=2Q`).

**Auth**: required · `kpi_view`

**Request**
- Method + path: `GET /api/jira/oncalls/v2`
- Query params: `teamId` (optional), `timeframe` (optional, default `2Q`)
- Required headers: JIRA token

**Server flow**
`GET /api/jira/oncalls/v2` → `oncallDashboardV2.getDashboard({ token, teamId, timeframe })` (same as V2 path above).

**Response shape**
Same as V2 `GET /api/jira/oncalls` (with `timeframe`).

**Caching**
No.

### POST /api/jira/oncalls/v2/refresh

**Purpose**: Explicit V2 pull alias.

**Auth**: required · `kpi_view`

**Request**
- Method + path: `POST /api/jira/oncalls/v2/refresh`
- Body: `{ "teamId": "ndb", "timeframe": "2Q" }` (both optional)
- Required headers: JIRA token

**Server flow**
Same as `POST /api/jira/oncalls/refresh` with timeframe → `oncallDashboardV2.getDashboard`.

**Response shape**
Same as V2 `GET /api/jira/oncalls`.

**Caching**
No.

### POST /api/jira/oncalls/report

**Purpose**: Preview or send OnCalls HTML email report — reuses Outstanding pattern. Download via client `Blob` or preview HTML in drawer. Timeframe-scoped heroes/health/taxonomy + ticket tables with JQL proof links. `previewOnly:true` returns `{subject,html}` without SMTP; `previewOnly:false` sends via `sendEmailDirect` (server-owned CC).

**Auth**: `kpi_view` (`validateJiraTokenMiddleware` + `checkKpiViewAuthorization` + `apiLimiter`) — same as `GET /api/jira/oncalls`

**Request**
- Method + path: `POST /api/jira/oncalls/report`
- Body:
  ```json
  {
    "teamId": "ndb",
    "timeframe": "7d",
    "to": ["ndb-exec-updates@nutanix.com"],
    "previewOnly": true,
    "dashboard": { "hero": {}, "health": {}, "gapTaxonomy": {}, "openTickets": [], "closedStacksPreview": [], "asOf": "2026-11-24T00:00:00Z" },
    "aiConcern": "optional fused concern string"
  }
  ```
  `timeframe` is `7d|15d|1M|1Q|2Q|1Y|18M|Overall` (validated against `TIMEFRAMES`, falls back to `7d`; case-insensitive like dashboard). `dashboard` optional — when missing/!hero server re-fetches via `oncallDashboardV2.getDashboard`. `to` overrides default `ndb-exec-updates@nutanix.com`; `cc` is server-owned (ignored from client, from `releaseVersionsCCConfig.json` → `ndb-tech-leads@`/`ndb-managers@`). Payload guard: `dashboard` >200KB or `aiConcern` >5000 chars → `413`.

**Server flow**
`POST /api/jira/oncalls/report` → `checkKpiViewAuthorization` → `oncallReportService.previewOrSendOncallReport({ token, teamId, timeframe: tf, to, previewOnly, dashboard, aiConcern })` → if `!dash||!dash.hero` then `getDashboard` → `buildOncallReportHtml({ teamId: tid, timeframe: tf, dashboard: dash, aiConcern })` → subject `[OnCalls tf] tid — N open, N aged — YYYY-MM-DD` (tid sanitized `[\r\n]→space`) → if preview: return `{subject,to,cc,html,story}`; else `sendEmailDirect({to,cc,subject,html})` → `{messageId}`.

**Response shape** (preview)
```json
{ "success": true, "data": { "preview": true, "subject": "[OnCalls 7d] ndb — 12 open, 3 aged — 2026-11-24", "to": ["ndb-exec-updates@nutanix.com"], "cc": ["ndb-tech-leads@nutanix.com"], "html": "<div>…heroes/health/taxonomy…ticket tables…</div>", "story": "YELLOW — 3 aged" } }
```
Send adds `messageId`. Errors: `413 dashboard payload too large`, `400 To required`, `403 kpi_view`.

### POST /api/ai/oncall-concern

**Purpose**: Fused quant+qual AI concern for OnCalls V2 — merges open/MTTR/net + hotspot component + gap% for the selected timeframe pill into a ~100w concern paragraph. Triggered on timeframe/hero/taxonomy/view change and on demand.

**Auth**: required · `kpi_view` (same guard as `POST /api/ai/chat` — `validateJiraTokenMiddleware`)

**Request**
- Method + path: `POST /api/ai/oncall-concern`
- Body:
  ```json
  {
    "teamId": "ndb",
    "timeframe": "2Q",
    "dashboard": { "hero": {}, "health": {}, "workflow": {}, "gapTaxonomy": {}, "componentMix": [], "gapMeta": {}, "agedOpenDays": 14 }
  }
  ```
  `dashboard` is optional — when missing or lacking `hero`, server re-fetches via `oncallDashboardV2.getDashboard({ token, teamId, timeframe })`.

**Server flow**
`POST /api/ai/oncall-concern` → optionally `oncallDashboardV2.getDashboard` → build `concernInput { timeframe, hero, health, workflow, gapTaxonomy, componentMix, validKeys, agedOpenDays }` → `naiService.generateOncallConcern(concernInput)` (`ONCALL_CONCERN` prompt) → `{ summary }`.

Loom builds the prompt (prompt template + quant packet), Lighthouse (this route) calls NAI.

**Response shape**
```json
{ "summary": "Concern in ~100 words with hotspot + gap signal …", "intelligence": { "timeframe": "2Q", "hero": {}, "health": {}, "workflow": {}, "gapTaxonomy": {} }, "timeframe": "2Q", "generatedAt": "2026-11-24T00:00:00.000Z" }
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | `NAI_API_KEY` not configured | Show NAI setup hint (see ADMIN_GUIDE) |
| 502 | NAI gateway error | Retry |
| 504 | NAI timeout | Retry |

**Caching**
No.

### POST /api/ai/oncall-slice

**Purpose**: Per-view AI 2-liner + fix suggestion for the drill drawer — scoped to the selected hero/taxonomy pill and its top keys. Regenerates when pill changes; inherits timeframe.

**Auth**: required · `kpi_view` (`validateJiraTokenMiddleware`)

**Request**
- Method + path: `POST /api/ai/oncall-slice`
- Body:
  ```json
  {
    "teamId": "ndb",
    "view": "needInfo",
    "keys": ["ONCALL-1", "ONCALL-2"],
    "timeframe": "2Q",
    "meta": { "count": 6, "agedDays": 14 }
  }
  ```
  `view` is the drill mode (e.g. `open` / `agedOpen` / `needInfo` / `waiting` / `duds` / `ndbGaps` / `thLinked` / `bugs` / `closedInWindow` / `throughput` / `mttr`), `keys` capped to ~20, `timeframe` inherited from pills, `meta` carries hero count + thresholds.

**Server flow**
`POST /api/ai/oncall-slice` → `naiService.generateOncallSlice({ teamId, view, keys, timeframe, meta })` (`ONCALL_SLICE` prompt) → `{ summary }`.

**Response shape**
```json
{ "summary": "2-line slice briefing + fix suggestion for view …", "view": "needInfo", "keys": ["ONCALL-1"], "timeframe": "2Q", "generatedAt": "2026-11-24T00:00:00.000Z" }
```

**Error responses**
Same as `oncall-concern`.

**Caching**
No.
