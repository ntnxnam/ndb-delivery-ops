---
name: kpi-pulse-analytics
description: Add or wire the reusable KPI Pulse band (last 2 Nutanix Qs, created vs resolved with line/grouped-bars + cumulative/point-in-time toggles, MTTR, status dwell, product impact) onto any KPI-scoped page. Use when the user asks for KPI pulse, MTTR tiles, created vs resolved graphs, chart toggles, last-2-quarter analytics, or to reuse the pulse kit on OnCalls, System-Test, CFD/CFI, or a new KPI page.
audience: tpm, team-exec, director, qa_lead
---

## When to Use This Skill

- User asks for **KPI pulse**, **MTTR tiles**, **created vs resolved**, or **last 2 quarters** analytics on a page
- Wiring pulse onto **OnCalls**, **System-Test Scale**, or another KPI-scoped surface
- Building a **new** KPI page that needs the same exec hero row + chart (do not invent a one-off chart)
- Extending pulse heroes (P0/P1/TBV) via `optionalHeroes` flags

## Quick Start

```
Input: {
  page: 'oncalls' | 'system-test-scale' | '<other>',
  baseJqlSource: 'kpiConfig OnCalls baseQuery' | 'filter={teamCode}-System-Test' | ...,
  optionalHeroes?: { p0?, p1?, tbv? }
}

1. Confirm kit exists:
   - server/utils/nutanixQuarters.js
   - server/services/kpiPulseService.js → buildPulse
   - client/src/components/KpiPulse/KpiPulseBand.js
   If missing, implement kit first (see Core Rules paths) before page wiring.

2. Resolve baseJql from that page’s KPI filter (kpi-config-driven — no hard-coded KPI names).

3. In the page service (thin call only):
   const pulse = await buildPulse({ token, baseJql, optionalHeroes });
   Attach `pulse` on the dashboard API response.

4. In the page component:
   import { KpiPulseBand } from '../components/KpiPulse';
   <KpiPulseBand
     pulse={data.pulse}
     jiraBaseUrl={data.jiraBaseUrl}
     title="… · last 2 Nutanix Qs"
     onGenerateImpact={...}   // optional — product impact
     domainHint="…"           // page flavor
     onHeroClick={(key, cell) => openDrill(key, cell)}  // open/aged/P0/P1 → side panel
   />
   // PulseHero: count → onOpen/panel; "Open in JIRA ↗" → cell.jql (jira-authenticity §1)

5. Update page requirements + data-layer + docs/api in the same change.

6. Do NOT fork CreatedResolvedChart / MTTR tiles per page.
```

### Example — OnCalls (Plan 1 consumer)

```javascript
const { buildPulse } = require('./kpiPulseService');
// inside getDashboard:
pulse: await buildPulse({
  token,
  baseJql: oncallSeedJql(cfg), // seeds only
}),
```

### Example — System-Test Scale

```javascript
pulse: await buildPulse({
  token,
  baseJql: `filter = ${teamCode}-System-Test`,
  optionalHeroes: { p0: true, p1: true, tbv: true },
}),
```

## Core Rules

1. **Same graph component; data from `baseJql` only** — mount `KpiPulseBand`, call `buildPulse({ baseJql })`.
2. **Default window** = last **2** Nutanix fiscal quarters (Q1 starts **01-Aug**), previous Q start → today (`lastNQuartersWindow(2)`).
3. **Canonical exec heroes**: P0/P1 (if opted) · Open now · Net change · Aged open · Created · Resolved · Typical wait (MTTR med) · Slow tail (p90) · Where it stalls (+ optional TBV).
4. **Story caption** required (`pulse.story`) — one plain-English verdict (catching up / falling behind), not a metric join.
5. **Ticket-count metrics clickable** — `{ count, jql }`. Derived metrics (**net change**, **status dwell medians**) use `jql: null`. MTTR day heroes may link to resolved-in-window sample as provenance.
6. **Dual click on open-family heroes** — when the page has an open-ticket sample: **count → in-app drill** (`PulseHero.onOpen` / `KpiPulseBand.onHeroClick`); **Open in JIRA ↗ → exact JQL**. Never both external. No sample → count-as-JIRA only (no redundant hint). Same contract as OnCalls `Hero` (`jira-authenticity-links`).
7. **Created vs resolved chart toggles** (shared `CreatedResolvedChart` only): **Line | Bars** (grouped side-by-side — never stack Created/→Resolved/→Closed) and **Point-in-time | Cumulative**. Point-in-time opens that week’s JQL; cumulative opens `createdCumulative` / `resolvedCumulative` (window start → weekEnd). Do not fork chart UIs per page.
8. **Outcome-first** — chase gaps before raw linked-universe footprints; footprints are proof-only (`kpi-pulse-analytics.mdc`).
9. **Compose dates onto baseJql** — never rewrite KPI `baseQuery` in `kpiConfig`. New helper only; propose if changing existing builders (`jql-edit-approval`).
10. **Product impact** is qualitative, on-demand, grounded in real ticket keys (citation-first). Shared `ProductImpactCard`; page supplies prompt flavor + generate handler.
11. **Page-specific metrics stay below the band** (OnCalls portfolio outcomes / CFD escalation, ST release trends).
12. Follow `kpi-pulse-analytics.mdc` and `kpi-config-driven.mdc`.
13. Chart band ≤ 280px incl. toggles (`ui-density`). Keep services under hard size limits.

### JQL composition (kit helper)

```
({baseJql}) AND created >= "YYYY-MM-DD" AND created <= "YYYY-MM-DD"
({baseJql}) AND resolved >= "YYYY-MM-DD" AND resolved <= "YYYY-MM-DD"
({baseJql}) AND statusCategory != Done
({baseJql}) AND statusCategory != Done AND created <= -14d
```

## Output Format

`buildPulse` response (mount as `data.pulse`):

```js
{
  window: { start, end, label, quarters },
  story: string,
  heroes: {
    openNow, createdWindow, resolvedWindow, netBurn,
    mttrMedian, mttrP90, agedOpen, topDwellStatus
    // optional: p0Open, p1Open, tbv
  },
  series: [{
    weekStart, weekEnd,
    created: {count,jql}, resolved: {count,jql},
    createdCumulative: {count,jql}, resolvedCumulative: {count,jql}
  }],
  mttr: { medianDays, p90Days, sampleSize, jql },
  statusDwell: [{ status, medianDays, sampleSize }],
  productImpact: { summary, generatedAt, citations },
  asOf, baseJql, agedOpenDays
}
```

UI: `<KpiPulseBand pulse={…} jiraBaseUrl={…} onHeroClick={…} />`.

## Quality Validation

- [ ] Kit files present; page does not define its own created/resolved Recharts
- [ ] Chart exposes Line/Stacked + Point-in-time/Cumulative; cumulative click uses range JQL
- [ ] `baseJql` comes from KPI config / documented filter convention
- [ ] Default window is last 2 Nutanix Qs; story line present
- [ ] All hero counts have JIRA links (or explicit null for non-count tiles)
- [ ] Open-family heroes with a row sample: count opens in-app drill; separate Open in JIRA ↗; not double-external
- [ ] No raw linked-universe hero as the primary chase signal
- [ ] Product impact does not invent ticket keys
- [ ] Page docs + API docs updated when wiring a consumer
- [ ] No silent JQL edits to existing builders
- [ ] Multi-agent pipeline run for UI/metrics pages (Dev → CR → QA → UX → PM → Exec → JIRA → Fix → Security)

## Delegation

Owner: `tpm-specialist`. Triggered by `ops-assistant` via `loadAgentPack('lighthouse')`.
