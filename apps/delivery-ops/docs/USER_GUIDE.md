---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
coversVersion: "2.11"
source: doc-user-guide @ 2026-05-19
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

1. Log in at `/login` (RBAC via `allowedUsers.json` — see [ADMIN_GUIDE.md](./ADMIN_GUIDE.md#rbac)).
2. Pick product + release in the header.
3. Use sidebar tabs per your permission.

## Sprint Report

**Who:** TPM, FEAT owners
**Steps:** Open Sprint Report → select sprint → review burndown/burnup.
**Tips:** Use `?` filter help for JQL-backed counts.

## Release Brief

**Who:** Team Exec / Director
**Steps:** Open Release Brief → check RAG + blockers → drill into FEAT.

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
  distinctness into the two rows yet. See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

## Tips & FAQ

- Missing tab? Check permissions in [ADMIN_GUIDE.md](./ADMIN_GUIDE.md).
- Caveats? See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).