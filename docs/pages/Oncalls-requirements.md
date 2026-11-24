# Oncalls V2 — Requirements

**Route**: `/oncalls` (canonical — mounts `OncallsV2Page`; `/oncalls-legacy` redirects to `/oncalls`, V1 removed 2026-11-24)  
**Component**: `OncallsV2Page` (`apps/delivery-ops/client/src/components/OncallsV2/OncallsV2Page.js`)  
**Permission**: `kpi_view`  
**Audience**: `team-exec`, `tpm`, `director`, `team`, `rm`

---

## Purpose

VP-first OnCalls dashboard — one global timeframe pill drives every hero, health strip, AI concern, age table, graph, and gap taxonomy so a VP can answer *what's hot, what's stuck too long, and what to fix now* in one skim. Product-agnostic (D1); NDB is one tenant — tenant-specific strings live in `oncallConfig.json` + `kpiConfig`.

Two lenses (B3 spec):

- **Lens 1 — Health:** at-a-glance heroes + MTTR/health strip (open/aged/need-info/waiting/closed-in-window; MTTR median/p90/throughput/aged-share) + How-long-open table + Created→Resolved pulse graph.
- **Lens 2 — Outcome:** gap taxonomy (duds / NDB gaps / other-team) with NDB sub-drill (TH linked / Bugs / Improvements / Other) + AI concern (fused quant+qual with hotspot + gap%) + per-view AI slice (2-liner + fix suggestion).

Global pills: `7d` · `15d` · `1M` · `1Q` · `2Q` (default) · `1Y` · `18M` · `Overall` — sticky, inherited in drawers (no reset). `Overall` = no date clause (all closed history).

Loom JIRA pull + prompt build → Lighthouse AI consume (dual MCP: `loom-mcp buildOncallPrompt` + `lighthouse-mcp generateOncallBrief`).

---

## Audiences

| Audience | Use |
|----------|-----|
| Team Executive / VP | One-paragraph AI Concern + hotspot (top 2 components) + fix-this; drill only when needed |
| TPM / Portfolio Manager | Timeframe skim, chase Need Info vs Waiting for Customer, own NDB gaps, close loop |
| Director / EM | Who is hit, aging, MTTR trend, throughput |
| IC / RM | Interrupt load vs release work; per-hero JQL proof |

---

## User Stories

| ID | Story |
|----|-------|
| OC-V2-01 | As a VP, I open `/oncalls` and see AI Concern (~100w) that fuses quant (open/MTTR/net) + qual (hotspot top-2 components + gap% + workflow view) for the selected pill, and it regenerates when I change pill/hero/taxonomy/view. |
| OC-V2-02 | As a TPM, I pick a timeframe pill (7d→Overall) and every hero/health/concern/age/graph/taxonomy recomputes for that window; Overall shows all closed with no date clause. |
| OC-V2-03 | As a TPM, each hero shows count + one-line explainer + Open in JIRA proof (exact JQL) — count click drills in-app, Open in JIRA opens search. |
| OC-V2-04 | As a TPM, I see Need Info and Waiting for Customer as first-class workflow buckets (status-only JQL; dwell threshold from `oncallConfig.json` shown as meta). |
| OC-V2-05 | As a TPM, I see gap taxonomy: Duds (duplicate/Won't Do/Cannot Reproduce/no-linked-fix) · NDB gaps (linked fix in NDB family) · Other-team gaps — each with JQL proof and in-app past drill. |
| OC-V2-06 | As a TPM, double-clicking NDB gaps expands NDB sub-drill: TH linked · Bugs · Improvements · Other — each drillable with inherited timeframe. |
| OC-V2-07 | As a TPM, health strip shows MTTR median/p90/throughput/aged-share; clicking MTTR/throughput opens throughput drill (past scope) and regenerates AI slice. |
| OC-V2-08 | As a TPM, opening any hero/taxonomy shows PathDrill drawer with per-view AI slice (2-liner + fix suggestion) plus ticket rows; drill inherits pills. |
| OC-V2-09 | As a TPM, the Created→Resolved graph (KpiPulseBand) uses the timeframe window override (Overall → default 2Q pulse) and supports flow/snapshot toggle. |
| OC-V2-10 | As a TPM, changing team reloads the V2 dashboard for that team's `baseScopeJql` (via `kpiConfig.OnCalls`). |
| OC-V2-11 | As a TPM, the OnCalls KPI chip on `/kpis` deep-links to `/oncalls`. `/oncalls-legacy` redirects to `/oncalls` (V1 removed). |
| OC-V2-12 | As a TPM, when NAI is unavailable the quantitative page still loads; AI panel shows `NAI_API_KEY not set` or timeout with retry. |
| OC-V2-13 | As a TPM, I can Download Report (standalone HTML via client Blob) and Send Email (Preview → Send via `POST /api/jira/oncalls/report`) — subject `[OnCalls tf] team — N open, N aged — date`, HTML reuses Outstanding pattern heroes/health/taxonomy + ticket tables + JQL proof, CC server-owned. |
| OC-09 | As a TPM, field-ticket status in escalation drill (legacy) is the real JIRA workflow status (Closed stays Closed). |
| OC-10 | As a TPM, when About inference is unavailable I see one drawer banner — not per-row NAI chrome (legacy). |

---

## UI Behaviour

- **Header:** title `OnCalls V2` + team (TeamContext) + as-of + Pull from JIRA + Regenerate AI Concern
- **Global pills:** sticky `ocv2-pills` (`7d`/`15d`/`1M`/`1Q`/`2Q`/`1Y`/`18M`/`Overall`); active pill has `active` class; stored in `useOncallsV2` state and sent as `?timeframe=` on every fetch
- **AI Concern card:** fused quant+hotspot; states `idle` → `loading` → `done` (linkified JQL) / `error`; Regenerate reuses dashboard snapshot
- **Hero row (5):** Open now · Aged >Nd · Need Info · Waiting for Customer · Closed in window — each `ExplainHero` with count → drill, explain one-liner, and `Open in JIRA ↗` (exact JQL). Meta shows threshold/window.
- **Health row (4):** MTTR median · MTTR p90 · Throughput (with net) · Aged share — neutral tone; count → past drill; JQL from `pulse.mttr.jql` or `pulse.heroes.resolvedWindow.jql`
- **How-long-open table:** Bucket / Count / Median age / Oldest / JQL proof (Open now, Need Info, Waiting for Customer)
- **Graph:** `KpiPulseBand pulse={data.pulse}` titled `OnCalls pulse · {timeframe}`; inherits windowOverride; flow vs snapshot toggle
- **Taxonomy (3 cards):** Duds (resolution gaps) · NDB gaps (our gaps) · Other-team gaps (externalize) — count → past drill; double-click NDB gaps toggles sub-drill
- **NDB sub-drill (4 cards, hidden until double-click):** TH linked · Bugs · Improvements · Other — each inherits timeframe
- **Drill drawer:** `PathDrill mode={drill.mode} tickets={gapMeta ? closedStacksPreview : openTickets} jql={…/gapTaxonomy/hero/pulse} scope={past|open} timeframe={timeframe} aiSlice={aiSlice} aiSliceView={aiSliceView}` — per-view AI slice auto-generates on open
- **Legacy:** V1 (`OncallsPage` at `/oncalls-legacy`) removed 2026-11-24 — legacy route redirects to `/oncalls` (V2)

Metric-click dual-action (all pages): count → in-app drill; Open in JIRA → exact JQL.

---

## Permissions

- **View / refresh / AI**: `kpi_view` (`checkKpiViewAuthorization` + `validateJiraTokenMiddleware`)

---

## Edge Cases

- No team selected → `TeamRequiredGate` ("Select a team for OnCalls V2")
- `!baseScopeJql` (team not in `kpiConfig` OnCalls) → `notConfigured` payload with message; page shows config hint
- No open OnCalls → heroes show 0; Pulse may be empty; AI concern still attempts with zero counts
- `Overall` → no date clause; closed window uses `seed AND statusCategory=Done` only
- `buildPulse` failure → `errors.pulse` set; page renders pulse error but heroes/taxonomy still load
- NAI unavailable / timeout → `aiConcernError` / `aiSliceError` banner; quantitative page unaffected
- Empty gap bucket → cell shows 0 with no JQL; drill shows fallback closed preview

---

## Acceptance Criteria

- [x] Route `/oncalls` mounts `OncallsV2Page` for `kpi_view`; `/oncalls-legacy` redirects to `/oncalls`
- [x] Sticky global pills (8) drive all heroes/health/concern/age/graph/taxonomy; `Overall` = no date clause; pills inherited in drawers
- [x] Each hero shows count + explain + Open in JIRA (exact JQL); count → in-app drill (dual-action)
- [x] Need Info / Waiting for Customer buckets use exact `status = "Need Info"` / `"Waiting for Customer"` + `statusCategory != Done`
- [x] Gap taxonomy counts sum correctly; `duds` = resolution dud or no linked fix; `ndbGaps`/`otherTeamGaps` split by linked projectKey prefix; NDB sub-drill keys match taxonomy
- [x] Health MTTR strip distinct from at-a-glance heroes; throughput net shown; pulse window override per timeframe
- [x] AI Concern fuses quant+hotspot in ~100w and regenerates on pill/hero/taxonomy/view; per-view AI slice regenerates on drill
- [x] `KpiPulseBand` mounted with timeframe window; not forked
- [x] Config thresholds wired from `oncallConfig.json` (`needInfoDays`/`waitingForCustomerDays`/`agedOpenDays`)
- [x] No hardcoded product strings (D1); NDB fallback is tenant-overrideable via `gapProjectPrefixes`
- [x] Report: `OncallReportSection` with `useOncallReport` → `POST /api/jira/oncalls/report` preview/send + Download standalone HTML (`Blob` append, Firefox-safe)
- [x] Page docs + API docs present; docs-verify PASS
