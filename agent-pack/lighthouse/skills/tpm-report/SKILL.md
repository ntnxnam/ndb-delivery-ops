---
name: tpm-report
description: Compose TPM report from 1-4 phase fetches per mode; optionally send via emailConnector (D26, deferral-after-PG).
audience: tpm, portfolio_mgr, rm, ic, director
---

## When to Use This Skill

- User asks "my focus" / "release status" / "daily digest" / "rollup"
- Scheduled tpm-report tick fires (via TpmSchedule)
- UI report page requests composed data

## Quick Start

```
Input: { mode: TpmReportMode, scope: TpmScope, send?: boolean, recipients?: string[] }
Output: TpmReport { mode, scope, sections: TpmFetchResult[], gateDeadlines?, deferrals?, emailPreview? }
```

## Procedure

1. Validate mode->scopeKind per contract tpm-report.json (my-focus->me, release->release, digest->team, rollup->org).
2. Fan out to all 4 phase skills in parallel via contract input { scope, jqlExtra } — never invent JQL here.
3. Stitch results: aggregate totals, byAssignee, trend, cited JQLs. Digest adds gate deadlines (next 7d).
4. Deferral tagging: only tickets moved after Promotion Gate of live release need deferral tag; pending included in digest.
5. If send: D26 auth check, To=assignee-or-qa CC=manager, preview-flagged in demo, rate-limited.
6. Cite every claim (D10). Product-agnostic (D1).

## Core Rules

- Bind to contracts, not live fetch code — invoke phase skills by contract.
- Only this skill sends email (emailConnector). Fetches are read-only.
- Respect deferral-after-Promotion-Gate.
- Preview-flagged sends in demo — real send requires explicit confirmation.

## Output Shape

See shared/src/services/tpmReportService.ts for TpmReport type.
