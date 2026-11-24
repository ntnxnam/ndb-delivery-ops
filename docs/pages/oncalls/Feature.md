# Feature — OnCalls V2 (VP-first, 2 lenses) — `/oncalls`

## Outcome

VP-first OnCalls dashboard where one timeframe pill controls the business story: heroes + workflow buckets + gap taxonomy + health + graph + fused AI concern. Drill keeps the timeframe. Legacy pulse-only view kept at `/oncalls-legacy`.

## Constraints (preserve)

- `kpi-config-driven` — OnCalls `baseScopeJql` from `kpiConfig.OnCalls.baseQuery` only; hero JQL composes onto it, never edits it
- `kpi-pulse-analytics` — mount `KpiPulseBand` + `buildPulse({ window: computePulseWindow(tf) })`; no forked chart
- `jira-authenticity-links` / `metric-click-dual-action` — count → in-app `PathDrill`; Open in JIRA → exact hero JQL (`key in (…)` for taxonomy)
- `jql-edit-approval` — any JQL shape change needs explicit approval flag
- `no-hardcoding` / D1 — NDB is one tenant; `gapProjectPrefixes` makes gap detection product-agnostic
- `product-agnostic` — `oncallConfig.json` owns `needInfoDays`/`waitingForCustomerDays`/`agedOpenDays` and project lists

## Lenses

- **Health:** Open/Aged/Need Info/Waiting/Closed-in-window heroes + MTTR median/p90/throughput/aged-share + age table + weekly Created→Resolved graph
- **Outcome:** Duds (no linked fix or dud resolution) / NDB gaps / Other-team gaps + NDB sub-drill (TH/Bugs/Improvements/Other) + gap% in AI concern

## Data shapes

- `TIMEFRAMES = {7d:7,15d:15,1M:30,1Q:90,2Q:180,1Y:365,18M:540,Overall:null}` — `timeframeClause` returns `resolved >= -Nd` or `null` (Overall)
- `gapTaxonomy { duds, ndbGaps, otherTeamGaps, ndbSub{thLinked,bugs,improvements,other} }` each `cell(count, jql)` where `jql = key in (...)` or null
- `health { mttrMedian, p90, net, throughput, agedShare }` derived from `pulse` + hero counts
- Component hotspot: `topN(componentMix,6)` → AI concern top-2
