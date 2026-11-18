# OnCalls page

**Route**: `/oncalls`  
**Audience**: tpm, team, rm

Customer-facing OnCall pulse: shared `KpiPulseBand` (last 2 Nutanix Qs + weekly graph) plus chase/path/escalation and AI briefing.

## Domain (read first)

Canonical outcome taxonomy: **`../domain/oncall-outcome-taxonomy.md`**

Short form:

| Outcome | Signal |
|---|---|
| Customer environment | TH / customer-side — not eng miss |
| Documentation miss | → TECHPUBS |
| Known issue / knowledge byte | → SR (self-help) |
| Genuine engineering miss | → eng ticket; ask why tests missed it |

Stack: OnCall → TechHelp → (SR \| TechPubs \| eng).

## Scope JQL

- OnCalls KPI `baseQuery` (kpiConfig) is the seed query — also `buildPulse` `baseJql`
- Current path chips: sample of open OnCall seeds (`key in (...)` when capped)
- Portfolio outcomes UI: chase gaps first (no path → need eng → need TechHelp → in flight)
- Linked footprint (proof only): `issueFunction in linkedIssuesOf("<OnCalls KPI baseQuery>")` — all statuses, never sample-capped
- Past: closed seeds in `pastLookbackDays` + path chips (same sample honesty)

## Metric clicks

- Pulse open-family + path / escalation: **count → side drill**; **Open in JIRA ↗ → exact JQL**.
- Pulse Created / Resolved / MTTR: count → JIRA only.
- Escalation field status chip = real JIRA `status` (Closed stays Closed).
- About miss → one drawer banner; rows show pathHint without per-row NAI chrome.

## APIs

`GET /api/jira/oncalls` (includes `pulse`), `POST /api/ai/oncall-summary`, `POST /api/ai/oncall-blurbs`.  
Server: `oncallService` + `kpiPulseService` + stacks / escalation / blurbs.  
KPI chip on `/kpis` deep-links here.  
Prompt: `prompts/production/oncall-ops-briefing.md`.
