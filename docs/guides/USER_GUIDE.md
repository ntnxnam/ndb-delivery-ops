---
product: NDB Delivery Ops
lastUpdated: 2026-11-18
coversVersion: "3.0"
source: doc-user-guide @ 2026-11-18
---

# User Guide

> For IC / TPM / FEAT / QA personas. Maintained by `doc-specialist` via `doc-user-guide`.

## Table of Contents
- [Getting Started](#getting-started)
- [Sprint Report](#sprint-report)
- [Release Brief](#release-brief)
- [Quality Column (TCMS)](#quality-column-tcms)
- [Tips & FAQ](#tips--faq)

## Getting Started

1. Log in at `/login` (RBAC via `allowedUsers.json` — see [ADMIN_GUIDE.md#rbac) (see Documentation)).
2. Pick product + release in the header.
3. Use sidebar tabs per your permission.

## Sprint Report

**Who:** TPM, FEAT owners
**Steps:** Open Sprint Report → select sprint → review burndown/burnup.
**Tips:** Use `?` filter help for JQL-backed counts.

## Release Brief

**Who:** Team Exec / Director
**Steps:** Open Release Brief → check RAG + blockers → drill into FEAT.

## Risk Details (Project Status)

**Who:** Portfolio Manager, TPM, Director
**Steps:** Open Project Status → select release → scan the Risk Details column.
**What it shows:** Risk Indicator pill (Deep Red/Red/Green/Yellow) + Risk Assessment + Path to Green. Rich-text values authored in JIRA (ADF) render as plain text; URLs render as Link; empty stays Not Set. Previously cached HTML values strip on next fetch.

## Quality Column (TCMS)

**Who:** TPM, FEAT owners, QA

The Quality column on the Project Status table shows TCMS test results per
feature.

- **Four tables per feature**: `Release — Overall`, `Release — Last 4
  weeks`, `Master — Overall`, `Master — Last 4 weeks`.
- **Each table is a 2×2 grid**:
  - Rows: **Functional**, **System**
  - Columns: **Manual**, **Automation**
  - Cells: QI / Run / Passed / Failed / Rate
- **Last 4 weeks** window reflects runs in the most recent 4-week window;
  shows "Not Set" when there are no runs in that window (it does not fall
  back to Overall). Time-filtered runs now come from the corrected TCMS
  metrics endpoint (`/api/v1/all_test_cases/aggregate/metrics` with
  `time_filter=four_weeks`).
- **Caveat:** Functional and System rows currently share the same source
  metrics until TCMS exposes a `test_category` filter. Do not read
  distinctness into the two rows yet. See [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md).

## OnCalls
**Who:** EM, TPM
**Steps:** Open KPIs → OnCalls → select release → review counts by period.
**Tips:** Click a count to see the filtered list; counts come from `kpiConfig` live JQL.

## CFD / CFI
**Who:** TPM, QA Lead
**Steps:** Open KPIs → CFD/CFI → Top / Non-Top → check created vs resolved.
**Tips:** Use MTTR and status-dwell to spot aging items.

## Dependency View
**Who:** FEAT owner, TPM
**Steps:** Open Dependency View → select release → review blockers.
**Tips:** Links show upstream/downstream tickets.

## KPI Pulse
**Who:** TPM, Director
**Steps:** Open KPIs → last 2 quarters strip → toggle cumulative / point-in-time.
**Tips:** Compare trend vs snapshot.

## Tips & FAQ

- Missing tab? Check permissions in [ADMIN_GUIDE.md](./ADMIN_GUIDE.md).
- Caveats? See [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md).