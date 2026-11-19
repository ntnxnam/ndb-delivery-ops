---
name: tpm-post-release
description: Fetch all KPIs tagged lifecyclePhase postRelease (CFDs, CFIs, Oncalls, any future KPI). Generic — no hard-coded KPI names; new KPIs appear when tagged in kpiConfig.json.
audience: tpm, portfolio_mgr, team_lead
---

# tpm-post-release — Post-Release KPI Fetch

Generic fetch for **postRelease** lifecycle phase. The orchestrator (`ops-assistant`) delegates here for post-release cadence queries. Adding a new KPI requires only tagging it `lifecyclePhase: postRelease` in `kpiConfig.json` — no code change.

Base directory for this skill: `agent-pack/lighthouse/skills/tpm-post-release`

## When to Use

- User asks "post-release KPIs", "CFDs/CFIs for post-release", "post-release Oncalls"
- Schedule tick for `tpm-post-release` phase (see `tpm-contracts`)
- Any fetch where `lifecyclePhase === 'postRelease'` KPIs are needed for a release/team/overall scope

For execution / release / overall phases, use the sibling skills `tpm-execution`, `tpm-release`, `tpm-overall`.

## Quick Start

```ts
import { loadEnv } from '@portfolio-delivery-ops/shared/connectors';
import { JiraConnector } from '@portfolio-delivery-ops/shared/connectors';
import { fetchPostReleaseKpis } from '@portfolio-delivery-ops/shared/services/tpmFetchService';
import kpiConfig from '../../../apps/delivery-ops/server/config/kpiConfig.json' with { type: 'json' };

const env = loadEnv();
const jira = new JiraConnector(env);
const result = await fetchPostReleaseKpis({
  scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
  jira, env, kpiConfig,
});
// result.kpis -> [{ kpiId, kpiName, jql, count, jiraUrl, capturedAt }, ...]
// Every number cites JQL + capturedAt (D10)
```

Via agent runtime tool loop — `tpmFetchResult` contract:

```json
{
  "skillId": "tpm-post-release",
  "lifecyclePhase": "postRelease",
  "scope": { "kind": "release", "releaseVersion": "NDB-2.12", "teamId": "ndb" },
  "asOf": "2026-11-19T12:00:00.000Z",
  "kpis": [{ "kpiId": "...", "kpiName": "Top-CFD", "jql": "filter=NDB-2.12-All and filter=142537 and status != Closed", "count": 7, "jiraUrl": "https://jira.nutanix.com/issues/?jql=...", "capturedAt": "2026-11-19T12:00:01.000Z" }],
  "totalKpis": 3,
  "jiraBaseUrl": "https://jira.nutanix.com"
}
```

## Core Rules

1. **Generic — no KPI name literals.** Read `kpiConfig.json`, filter `kpi.lifecyclePhase === 'postRelease'`. Never `if (kpi.name === 'Top-CFD')`.
2. **Citation-first (D10).** Every `count` is paired with `jql` + `capturedAt` + `jiraUrl`. Render as "7 — `jql` @ `capturedAt` → [Verify ↗](jiraUrl)".
3. **Bearer PAT only (D40).** `JiraConnector` uses `Authorization: Bearer <PAT>`; no Basic/OAuth.
4. **Product-agnostic (D1).** No `project = ERA` / `NDB-*` literals in code — release and team come from `TpmScope` / config.
5. **Partial success.** JQL failures produce `error` on that KPI entry; other KPIs still return. Caller renders error inline.
6. **Order preserved.** Results follow `kpiConfig` `order` field.

## Tool Contract

```
Input:  TpmScope { kind, releaseVersion?, teamId?, productId? }
Output: TpmFetchResult { skillId, lifecyclePhase, scope, asOf, kpis[], totalKpis, jiraBaseUrl }

JQL shape (per KPI):
  filter=<RELEASE>-All and <kpiBaseQuery> and status != Closed
  (when scope has releaseVersion; otherwise kpiBaseQuery alone, type=→issuetype= normalized)

Errors: per-KPI { error, count:0 } — do not throw for single-KPI failure.
```

## Quality Validation

- [ ] No hard-coded KPI names in `shared/src/services/tpmFetchService.ts` (grep `CFD|CFI|Oncall` → 0 in logic)
- [ ] `npm run build` in `shared/` succeeds
- [ ] Live spot-check: `searchCount` delta 0 (or <2% for >100) vs direct JIRA
- [ ] Every KPI result has `jql` + `capturedAt` + `jiraUrl`

## Delegation

Owner: `tpm-specialist`. Triggered by `ops-assistant` via `loadAgentPack('lighthouse')`.
