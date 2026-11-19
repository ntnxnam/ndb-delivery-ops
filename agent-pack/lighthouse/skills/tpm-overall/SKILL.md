---
name: tpm-overall
description: Fetch all KPIs tagged lifecyclePhase overall (SLA, CVE, deferral and any future overall KPI) — generic via kpiConfig + kpiService. Use for the Overall / cross-phase health slice of the TPM Agent.
audience: tpm, portfolio_mgr, rm
---

# TPM Overall — Generic Overall-Phase Fetch

Generic fetch for the **Overall** lifecycle phase. Reads `kpiConfig.json`, filters `lifecyclePhase === 'overall'`, and executes each KPI via `kpiService`. No hard-coded KPI ids or product strings (D1); new overall KPIs appear with no code change.

## When to Use This Skill

- User asks "how's overall health?", "SLA / CVE / deferral status for <release>?"
- TPM Agent needs the Overall slice for a release, team, or org roll-up.
- Orchestrator fans out to all 4 phase fetches — this is the `overall` leg.
- Any future KPI tagged `overall` (e.g. compliance, security posture) — automatically included.

If the user wants post-release (CFDs/CFIs/oncall), execution (P0/P1/E-W), or at-release (regression/system/smokes), use `tpm-post-release`, `tpm-execution`, or `tpm-at-release` respectively.

## Quick Start

```
Input: {
  scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' }
       | { kind: 'team', teamId: 'ndb' }
       | { kind: 'me', teamId: 'ndb', principal: 'jane.doe' }
       | { kind: 'org', orgId: 'eng', teamIds: ['ndb','ncm'] },
  jqlExtra?: string | null,   // optional extra JQL AND-ed to each KPI
  token: string               // caller's JIRA PAT (Bearer per D40)
}

Output: TpmFetchResult (per tpmFetchResult.json) — totals, byAssignee, cited JQLs + timestamps
```

## Core Rules

1. **Generic by phase tag.** `loadKpiConfigSync()` → `getKpisForTeam()` → filter `kpi.lifecyclePhase === 'overall'`. Never list KPI ids by name in code.
2. **Product-agnostic (D1).** `teamId` / `releaseVersion` / `baseFilter` come from config (`teamBoardConfig`, `kpiConfig`, `releaseBaseFilter`). No `project = ERA` literals.
3. **Citation-first (D10).** Every count cites its JQL + timestamp. `cited: [{ jql, ts }]` for each executed KPI; `links.combinedJql` + `jiraSearchUrl` for drill-through.
4. **Bearer PAT only (D40).** All JIRA reads via `jiraConnector` / `getJira(token)` with `Authorization: Bearer <pat>`. No Basic/OAuth.
5. **Read-only.** This skill never writes JIRA/Confluence. Only `tpm-report` sends email (D26).

## Tool Contract

### Server — `apps/delivery-ops/server/services/tpmOverallService.js`

```js
const { getOverallKpis } = require('../services/tpmOverallService');
// Filter is inside the service — caller just passes scope + token:
const result = await getOverallKpis({ scope, token, jqlExtra });
// result = { skill: 'tpm-overall', scope, totals, byAssignee?, cited, links, warnings? }
```

Implementation notes (inside the service, not in the skill prompt):
- `loadKpiConfigSync()` → `getKpisForTeam(teams, teamId)` → `.filter(k => k.lifecyclePhase === 'overall')` → sort by `order`.
- For each KPI, build release-scoped JQL via `kpiService.buildReleaseKpiCombinedJql` (release scope) or `kpiService.buildKpiCombinedJql` (team scope), with `jqlExtra` AND-ed when present and `excludeDeferred` respected.
- Execute via `kpiService.executeKpiQuery` (count vs list per `displayType`).
- Aggregate `totals: { total, open, done }` as sum across KPIs; `cited` collects each KPI's `combinedJql` + `new Date().toISOString()`.
- Empty overall set → `totals: { total:0, open:0, done:0 }` with warning `No KPIs tagged overall for team <teamId>`.

### API — `GET /api/tpm/overall?scope=...&releaseVersion=...&teamId=...`

Thin route — delegates to `tpmOverallService.getOverallKpis`. Returns `TpmFetchResult` JSON. Auth via `Authorization: Bearer <pat>` header (D40).

## Output Format

```markdown
**Overall — {{scopeLabel}}** ({{total}} open across {{kpiCount}} KPIs)

| KPI | Open | Total | JQL |
|-----|------|-------|-----|
| Bugs Out of SLA | 3 | 12 | [JQL](jiraSearchUrl) |
| CVE | 1 | 5 | [JQL](jiraSearchUrl) |
| Deferral | 0 | 2 | [JQL](jiraSearchUrl) |

Sources: <cited JQLs> @ <ts>. [Open in JIRA](combinedJqlUrl)
```

## Quality Validation

- [ ] No hard-coded product strings (`project = ERA`, `NDB-`) — grep `tpm-overall` for `project =` must be 0
- [ ] `lifecyclePhase === 'overall'` filter is the only selector — adding a new overall KPI to `kpiConfig.json` surfaces without code change
- [ ] Every number has `cited: { jql, ts }` with live `searchCount` (not fixture) — JQL spot-check passes
- [ ] `jiraConnector` (D40 Bearer) is the only JIRA path — no ad-hoc axios
- [ ] Empty overall set handled (warning, zero totals, no throw)
- [ ] Server tests green (`npm test -- tpmOverallService`)

## Delegation

Owner: `tpm-specialist`. Triggered by `ops-assistant` (D16) via `loadAgentPack('lighthouse')`.
