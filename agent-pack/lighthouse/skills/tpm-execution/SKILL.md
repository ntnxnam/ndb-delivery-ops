---
name: tpm-execution
description: Fetch all KPIs tagged lifecyclePhase execution — P0, P1, E-W projects (labels ndb-ew/global-ew/nutanix-ew), open dev/test work, and any future KPI tagged that phase. Generic via kpiService — add a KPI to kpiConfig.json and the next fetch includes it without code change.
audience: tpm, rm, team_lead, director
---

# tpm-execution — Execution Phase Fetch (Skill 2 of 6)

Fetch every KPI whose `lifecyclePhase === 'execution'` for the caller's scope.

## When to Use

- TPM asks "what's still open for execution?" or "show me P0/P1 + E-W for this release"
- RM checks execution health for one release before a gate
- Director/T​PM roll-up fans out across teams — this skill handles one slice
- Any future KPI tagged `execution` in `kpiConfig.json` — this skill picks it up automatically

## Input

```jsonc
{
  "scope": { "kind": "release", "releaseVersion": "NDB-2.12", "teamId": "ndb" },
  "jqlExtra": null  // optional extra JQL clause (e.g. "assignee = currentUser()")
}
```

`scope` is one of `TpmScope` (`me` | `release` | `team` | `org`) — see `shared/src/types/tpm.ts` and `agent-pack/lighthouse/skills/tpm-contracts/contracts/tpmScope.json`.

## What It Fetches (generic — driven by config, not code)

| KPI today | Base query source | Scoping |
|---|---|---|
| P0 Blockers | `project=ERA … priority = "Blocker - P0"` (or team-scoped variant) | `teamBaseFilter` or `releaseBaseFilter` depending on `scope.kind` |
| P1 Criticals | `priority = "Critical - P1"` | same |
| E-W Projects | `labels in (ndb-ew, global-ew, nutanix-ew)` (+ portfolio expansion) | `releaseBaseFilter` when `scope.kind === 'release'` and `releaseScoped: true` (D36) |
| Open dev/test work | any future KPI with `lifecyclePhase: execution` | auto-included, same scoping rules |

A new KPI added to `kpiConfig.json` with `"lifecyclePhase": "execution"` appears on the next fetch without touching this skill or `tpmExecutionService`.

## Scoping Rules (D36 Release Payload)

- **`release` scope** — every KPI is sliced to that release. KPIs with `releaseScoped: true` (E-W) use `releaseBaseFilter` (`filter=<version>-All` or the override in `releaseVersionsColumnsConfig.json`). Other KPIs also prefer `releaseBaseFilter` when available, falling back to `teamBaseFilter`.
- **`team` scope** — KPIs filtered to `teamId`, JQL is `(teamBaseFilter) AND (kpiBaseQuery)`.
- **`me` scope** — same as `team` plus `AND assignee = "<principal>"`.
- **`org` scope** — fans out across `teamIds`, merges KPIs from each team into one `TpmFetchResult`.

All reads go through `shared/connectors/jiraConnector` — Bearer PAT only (D40).

## Output — `TpmFetchResult` (contract: `agent-pack/lighthouse/skills/tpm-contracts/contracts/tpm-execution.json`)

```jsonc
{
  "skill": "tpm-execution",
  "scope": { "kind": "release", "releaseVersion": "NDB-2.12", "teamId": "ndb" },
  "totals": { "total": 42, "open": 42, "done": 0 },
  "links": {
    "jiraSearchUrl": "https://jira.nutanix.com/issues/?jql=…",
    "combinedJql": "(filter=NDB-2.12-All AND …) OR (filter=NDB-2.12-All AND …)"
  },
  "cited": [
    { "jql": "filter=NDB-2.12-All AND (project=ERA …) AND status != Closed", "ts": "2026-11-19T10:00:00.000Z" }
  ],
  "rag": "amber",
  "warnings": [] // only when a KPI could not be fetched
}
```

Every count is backed by a live `jiraConnector.searchCount(jql)` call — no cached bundle. Each entry in `cited` is the exact JQL + ISO timestamp (D10). `links.jiraSearchUrl` opens the combined JQL in JIRA for verification.

## Service Entry Point

```ts
import { fetchExecutionKpis } from '@portfolio-delivery-ops/shared/services/tpmExecutionService';
// or generically:
import { fetchKpisForPhase } from '@portfolio-delivery-ops/shared/services/tpmKpiService';

const { details, result } = await fetchExecutionKpis({
  scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
  jiraConnector,
  env,
  // optional overrides for testing / MCP:
  // kpiConfig, teamConfig, kpiConfigPath, teamConfigPath, columnsConfig, jqlExtra
});

// details — per-KPI breakdown for debugging / drill-down:
//   [{ kpiId, kpiName, jql, count }, …]
// result — the TpmFetchResult contract above
```

`details` is for internal/diagnostic use; the contract output is `result`.

## Rules

1. **Generic, not hard-coded** — the only phase string in code is the constant `TPM_EXECUTION_PHASE = 'execution'`. KPI inclusion is `kpi.lifecyclePhase === phase` on the live `kpiConfig.json` teams map. Never enumerate KPI ids or names.
2. **Product-agnostic** (D1) — `teamId`, `releaseVersion`, and JQL project keys are opaque strings from `teamBoardConfig.json` / `kpiConfig.json`. No `project = ERA` literal in skill or service code.
3. **Bearer PAT only** (D40) — JIRA reads via `jiraConnector` (`Authorization: Bearer <PAT>`). No Basic, no Cloud token, no ad-hoc `axios.get`.
4. **Citation-first** (D10) — every number cites `jql + ts`. `links.combinedJql` + `links.jiraSearchUrl` must reproduce the count when pasted into JIRA.
5. **E-W uses releaseBaseFilter** (D36) — any KPI with `releaseScoped: true` is scoped by `filter=<version>-All` (or column override) when `scope.kind === 'release'`.
6. **Read-only** — this phase never mutates JIRA. Only `tpm-report` may send email (D26).

## QA Checklist (JQL spot-check)

- [ ] With `scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' }`, `links.combinedJql` contains `filter=NDB-2.12-All` for E-W + P0/P1 slices.
- [ ] Live `POST /rest/api/2/search?jql=<each cited jql>&maxResults=0` total matches the `count` shown.
- [ ] No hard-coded product strings in `shared/src/services/tpmKpiService.ts` or `tpmExecutionService.ts` (`grep -rn 'project = ERA\|NDB-'` in those files returns empty outside tests/fixtures).
- [ ] Adding a new KPI with `"lifecyclePhase": "execution"` to `kpiConfig.json` appears in the next fetch without code change.
- [ ] `shared` tests green (`npm run test` or `npx tsc --noEmit`).

## Delegation

Owner: `tpm-specialist`. Triggered by `ops-assistant` (D16 orchestrator) via `loadAgentPack('lighthouse')`. `tpm-report` fans out to this skill plus the three sibling phase fetches.

## Contracts

- Phase contract: `agent-pack/lighthouse/skills/tpm-contracts/contracts/tpm-execution.json`
- Result shape: `agent-pack/lighthouse/skills/tpm-contracts/contracts/tpmFetchResult.json`
- Scope shape: `agent-pack/lighthouse/skills/tpm-contracts/contracts/tpmScope.json`
- Shared types: `shared/src/types/tpm.ts`
