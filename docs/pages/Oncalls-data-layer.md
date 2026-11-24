# Oncalls V2 — Data Layer

**Route**: `/oncalls` (V2) — `/oncalls-legacy` redirects to `/oncalls` (V1 removed 2026-11-24)  
**Component**: `OncallsV2Page` (V1 `OncallsPage` removed)  
**Hooks**: `useOncallsV2` (V1 `useOncalls` removed)

---

## API endpoints called

| Method | Path | When |
|--------|------|------|
| GET | `/api/jira/oncalls?teamId=&timeframe=&v2=` | Initial load / team or timeframe change (V2) |
| GET | `/api/jira/oncalls/v2?teamId=&timeframe=` | Explicit V2 alias (same) |
| POST | `/api/jira/oncalls/refresh` | Pull from JIRA (V2, timeframe-aware) |
| POST | `/api/jira/oncalls/v2/refresh` | Pull V2 alias |
| POST | `/api/jira/oncalls/report` | Preview (`previewOnly:true`→`{subject,html}`) or Send email (`→{messageId}`) — reuses `sendEmailDirect`, server-owned CC |
| POST | `/api/ai/oncall-concern` | Generate fused AI Concern (auto after metrics load + on Regenerate + on pill/hero/taxonomy change) |
| POST | `/api/ai/oncall-slice` | Per-view AI 2-liner for drill drawer (on open drill) |
| GET | `/api/jira/oncalls?teamId=` | Legacy initial load (no timeframe) |
| POST | `/api/ai/oncall-summary` | Legacy AI briefing (pulse-era) |
| POST | `/api/ai/oncall-blurbs` | Legacy path drill About (pulse-era) |

---

## Server flow — V2

```
GET /api/jira/oncalls?timeframe=&v2=         → checkKpiViewAuthorization
GET /api/jira/oncalls/v2?timeframe=          → oncallDashboardV2.getDashboard({ token, teamId, timeframe })  [5-way parallel]
  1. resolveRuntimeConfig(teamId)            → baseScopeJql (OnCalls KPI baseQuery from kpiConfig), onCallProject, techHelpProjects, agedOpenDays, needInfoDays/waitingForCustomerDays
  2. buildTimeframeHeroQueries(cfg, tf)      → heroes + workflow + TIMEFRAMES{7d:7,15d:15,1M:30,1Q:90,2Q:180,1Y:365,18M:540,Overall:null} + timeframeClause('resolved', tf) = resolved >= -Nd or null
  3. runCounts(queries)                      → jira.searchCount per hero (concurrency 6, soft-fail per hero)
  4. fetchOpenStacks(token, cfg)              → searchPages open OnCalls + linked fetch + classifyStacksFromIssues → openStacks, assigneeMix, priorityMix, componentMix
  5. fetchClosedStacks(token, cfg, tf)        → searchPages closed seeds (seed AND statusCategory=Done AND resolved >= -Nd || no clause) cap 500 → classifyStacksFromIssues → closedStacks
  6. linkedOut searchCount linkedIssuesOf(baseScopeJql)
  7. buildPulse({ token, baseJql, optionalHeroes:{p0,p1}, window: computePulseWindow(tf) }) — Overall → default 2Q pulse; soft-fail
  8. classifyGapBuckets(closedStacks, cfg)   → duds/ndbGaps/otherTeamGaps; buildGapCells
     classifyNdbSubGaps(ndbGaps, cfg)         → thLinked/bugs/improvements/other; buildNdbSubCells
  9. health { mttrMedian, p90, net, throughput, agedShare } + workflow buckets + componentMix topN
  → { teamId, baseScopeJql, timeframe, hero, workflow, gapTaxonomy, gapMeta, health, pulse, paths, componentMix, openTickets, stacksPreview, closedStacksPreview, errors }

POST /api/jira/oncalls/refresh               → same, force: true path (authenticatedPost) with { teamId, timeframe, v2 }
GET/POST /api/jira/oncalls/v2/*             → same V2 orchestrator

POST /api/ai/oncall-concern  Body: { teamId, timeframe, dashboard }
  → oncallDashboardV2.getDashboard if dashboard missing
  → naiService.buildOncallConcernPrompt / generateOncallConcern(concernInput { hero, health, workflow, gapTaxonomy, componentMix, validKeys })
  → Loom builds prompt, Lighthouse calls NAI (ONCALL_CONCERN)

POST /api/ai/oncall-slice  Body: { teamId, timeframe, view, keys, meta }
  → naiService.generateOncallSlice({ view, keys, timeframe, meta })  (ONCALL_SLICE)
```

Legacy flow removed 2026-11-24: V1 `oncallService.getDashboard` at `GET/POST /api/jira/oncalls` (no timeframe) deleted; all requests now go to `oncallDashboardV2.getDashboard` (V2, timeframe-aware).

Modules (V2): `oncallDashboardV2.js` (orchestrator) · `oncallGapService.js` (taxonomy) · `oncallConfigResolve.js` · `oncallStacksService.js` · `kpiPulseService.js` · `oncallReportService.js` (report email) · `naiService.js` (ONCALL_CONCERN + ONCALL_SLICE) · `routes/jira/oncalls.js` · `routes/ai.js` · `mcp/shared/tools/buildOncallPrompt.ts`

---

## Domain classification — V2 gap taxonomy

| Bucket | Rule |
|--------|------|
| `duds` | `resolution ∈ {duplicate, won't do, cannot reproduce, invalid}` (case-insensitive, see `DUD_RESOLUTIONS`) **or** no linked fix |
| `ndbGaps` | Linked fix projectKey starts with `NDB` (or `cfg.gapProjectPrefixes` tenant override) or component contains NDB |
| `otherTeamGaps` | Any other linked fix (outside NDB family) |
| `ndbSub.thLinked` | `ndbGaps` with TechHelp linked |
| `ndbSub.bugs` | Linked issuetype contains `bug` |
| `ndbSub.improvements` | Linked issuetype contains `improvement`/`story`/`task` |
| `ndbSub.other` | Remaining NDB gaps |

All taxonomy cells are `key in (…)` JQL proofs. JQL never edits `kpiConfig` baseQuery — composes `resolved >= -Nd` or `status = "…"` onto seed only.

### Timeframe pills → JQL

| Pill | `timeframeClause('resolved', pill)` | Notes |
|------|-------------------------------------|-------|
| `7d` · `15d` · `1M` · `1Q` · `2Q` · `1Y` · `18M` | `resolved >= -Nd` (N = 7/15/30/90/180/365/540) | Windowed closed count |
| `Overall` | `null` (no clause) | All closed history — server omits date filter |

### Workflow buckets

- `Need Info` → `status = "Need Info" AND statusCategory != Done`
- `Waiting for Customer` → `status = "Waiting for Customer" AND statusCategory != Done`
- Counts from `countSearch` (JQL) + bucket totals from `openTickets` status filter; `needInfoDays`/`waitingForCustomerDays` from `oncallConfig.json` are UI meta (dwell nudge), not JQL dwell (changelog dwell planned).

---

## Client flow — V2

```
useOncallsV2(teamId, initial='7d')
  load({ force=false }) → authenticatedGet('/api/jira/oncalls', { teamId, timeframe, v2:'1' })
  load({ force=true })  → authenticatedPost('/api/jira/oncalls/refresh', { teamId, timeframe, v2:'1' })
  set timeframe → effect resets aiConcern + reloads

  auto: after data.asOf changes → POST /api/ai/oncall-concern { teamId, timeframe, dashboard }
  on drill open(view, keys, meta) → POST /api/ai/oncall-slice { view, keys, timeframe, meta }

OncallsV2Page
  PillBar(8) sticky top + in drawer → deriveKeysForView(mode) caps 12 keys from openTickets / gapMeta / closedStacksPreview
  health + taxonomy cards: count→openDrill, jql→Open in JIRA ↗
  NDB double-click → showNdbSub toggle
  PathDrill({ mode, tickets, jql, cellCount, scope, timeframe, aiSlice })
```

Legacy removed: V1 `useOncalls` → `OncallsPage` deleted; V2 `useOncallsV2` → `OncallsV2Page` is sole consumer.

---

## Config

`server/config/oncallConfig.json` (per D1 — no hardcoded product strings):

| Field | Purpose |
|-------|---------|
| `onCallProject`, `techHelpProjects`, `knowledgeProjects`, `techPubsProjects`, `engFixProjects` | Project scoping for stacks/gaps |
| `agedOpenDays` (14) | Aged threshold for hero/meta + drawer filter |
| `needInfoDays` (10), `waitingForCustomerDays` (21) | UI dwell nudge meta (status-only JQL) |
| `gapProjectPrefixes` (optional) | Tenant override for NDB-family detection; fallback `['NDB','NDB-']` |
| `openStatusJql`, `doneStatusJql` | `statusCategory` clauses |
| `pastLookbackDays` (legacy), `maxOpenIssuesFetch`, `maxPastIssuesFetch` | Fetch caps |

MCP: `mcp/shared/tools/buildOncallPrompt.ts` (Loom, read-only) + `mcp/lighthouse/src/tools/generateOncallBrief.ts` (Lighthouse, NAI call).

---

## Caching

- Dashboard counts + pulse + stacks + gaps: live on load / Pull (no durable cache)
- Ticket narrative / blurbs (legacy): short-lived per key
- `oncallDashboardV2.getDashboard` parallelizes with `allSettled`; partial errors surface in `errors` map

**Live JQL verification — STALE (re-run before sign-off):** `curl -H "Authorization: Bearer $PAT" "$HOST/api/jira/oncalls?teamId=ndb&timeframe=Overall"` must return `hero.open.jql` without `resolved >=` clause.

---

## Error handling

| Case | Client |
|------|--------|
| 403 | Show access denied |
| `errors.counts` / `errors.openStacks` / `errors.closedStacks` / `errors.gapTaxonomy` | Hero shows 0 with jql null; rest of page loads |
| `errors.pulse` | KpiPulseBand error banner; heroes/taxonomy still load |
| `notConfigured` (no baseScopeJql) | Show config hint ("Add OnCalls KPI in Admin → KPIs") |
| `NAI_API_KEY not set` on AI call | 400 + setup hint; quantitative page works |
| NAI timeout / 502 | AI panel shows error with retry; "Regenerate" reuses snapshot |
