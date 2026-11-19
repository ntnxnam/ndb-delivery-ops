---
name: tpm-at-release
description: At-release phase fetch — every KPI tagged lifecyclePhase=release (regression, system test, open verification and any future KPI with that tag). Generic via kpiConfig + shared tpmFetch. Use when the TPM asks about release-time health, gate readiness, or regression/system-test status for a release.
audience: tpm, rm, director
---

## When to Use This Skill

- TPM / RM asks "how is NDB-2.12 at release?" / "regression status for <release>"
- Release-gate readiness check (D20) — system test / regression / open verification counts
- Orchestrator fans out for `tpm-report` mode `release` / `digest` / `rollup`
- Scheduled `tpm-at-release` tick fires (via `tpm-schedule`)

## Quick Start

```ts
import { fetchAtRelease } from '@portfolio-delivery-ops/shared/services';
import { JiraConnector } from '@portfolio-delivery-ops/shared/connectors';
import kpiConfig from '../../apps/delivery-ops/server/config/kpiConfig.json' with { type: 'json' };

const result = await fetchAtRelease(
  { scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' }, jqlExtra: null },
  { jiraConnector: new JiraConnector(env), kpiConfig, jiraBaseUrl: env.jiraBaseUrl },
);
// result.totals, result.kpiBreakdown, result.cited, result.links
```

## Contract

Input: `TpmFetchInput` — `{ scope: TpmScope, jqlExtra?: string | null }`
Output: `TpmFetchResult` — see `../tpm-contracts/contracts/tpm-at-release.json` and `tpmFetchResult.json`.

Scope kinds supported: `me` | `release` | `team` | `org` — all resolve to a `teamId` for kpiConfig lookup; `release` adds `filter=<version>-All` scoping.

## Core Rules

1. **Generic — no hard-coded KPI names or product strings (D1).** Read `kpiConfig.json` `teams[teamId]`, filter `kpi.lifecyclePhase === 'release'`, execute each via `tpmFetch`. New KPIs tagged `release` appear automatically.
2. **All numbers cite JQL + timestamp (D10).** Every `total` / `open` / `done` has a `cited: { jql, ts }` entry. `links.combinedJql` is the OR of all phase KPI JQLs; `links.jiraSearchUrl` opens it in JIRA.
3. **JIRA via `jiraConnector` only (D3, D40).** Bearer PAT (`Authorization: Bearer`). No direct axios to JIRA elsewhere.
4. **Read-only (D26).** This skill never mutates JIRA, Confluence, or schedule state. Only `tpm-report` sends.
5. **Product-agnostic scope (D1).** `teamId`, `releaseVersion`, `orgId` are opaque strings. `release` scope composes `getReleaseBaseFilter(releaseVersion)` from `releaseVersionsColumnsConfig` + per-KPI `baseQuery`.
6. **Empty phase is not an error.** If no KPI has `lifecyclePhase === 'release'` for the team, return `totals: {0,0,0}` with a `warnings` entry — caller renders "no KPIs in this phase".
7. **Orchestrator-owned (D16).** `ops-assistant` decides to invoke; users never address this skill by name. Builder hosts may also expose via `loom`.

## Output Shape

```ts
{
  skill: 'tpm-at-release',
  scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' },
  totals: { total: 42, open: 12, done: 30 },
  kpiBreakdown: [
    { kpiId: 'kpi_mltr5912_iqnubebp', kpiName: 'System Test', total: 20, open: 5, done: 15, jql: '...' },
    { kpiId: 'kpi_mltr5hi3_0qdmhcep', kpiName: 'Smokes', total: 10, open: 2, done: 8, jql: '...' },
    { kpiId: 'kpi_mmaylqy1_a8nuacz5', kpiName: 'NDB PreCommits', total: 12, open: 5, done: 7, jql: '...' },
  ],
  links: { jiraSearchUrl: 'https://jira.../issues/?jql=...', combinedJql: '(...) OR (...) OR (...)' },
  cited: [{ jql: 'filter=NDB-2.12-All and filter=NDB-System-Test and ...', ts: '2026-11-19T12:00:00.000Z' }, ...],
  warnings: undefined,
}
```

## Quality Validation

- [ ] No hard-coded product strings (`NDB`, `ERA`, `project = ERA`) — all from config/scope
- [ ] `kpiConfig.json` has `lifecyclePhase: "release"` on System Test / Smokes / NDB PreCommits (and any future release KPI)
- [ ] Every numeric claim has a `cited` entry with JQL + ISO timestamp
- [ ] JQL uses `jiraConnector.searchCount` (Bearer PAT), not raw axios
- [ ] `tpmFetchResult.json` contract validates (skill, scope, totals, links, cited required)
- [ ] Warnings present when KPI skipped or JQL failed — never silent zero
