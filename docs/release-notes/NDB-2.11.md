---
product: NDB Delivery Ops
release: "2.11"
date: 2026-05-19
gate: GA TBD
source: doc-specialist @ 2026-05-19
---

# Release Notes — NDB 2.11

## Highlights

- TCMS Quality table reworked to show **Functional** and **System** rows
  (2×2 grid: Functional/System × Manual/Automation) with QI/Run/Passed/
  Failed/Rate per cell.
- Window label aligned to data source: **Last 4 weeks** (no more stale
  "Last 3 weeks" label).
- Legacy `overall` data falls back to the **System** row for back-compat
  with older cached payloads.
- No "Overall" row/title collision in UI or email output.

## What's New

- Quality column (`releaseVersionsColumnsConfig.json`) description updated
  to document the 2-row (Functional/System) × 2-col (Manual/Automation)
  layout. See `docs/pages/ProjectStatus-*`.
- TCMS follow-up migration note: `docs/tcms-rows-followup.md`.
- TCMS time-filtered (Last 4 weeks) metrics now genuinely filtered via
  `/api/v1/all_test_cases/aggregate/metrics` (`time_filter=four_weeks`,
  `target={milestone}-qcow2`); no fallback to Overall.

## Breaking Changes

- None for consumers. `releaseLast3Weeks`/`masterLast3Weeks` aliases
  retained (deprecated; removal after 2 sprints — see
  `docs/tcms-rows-followup.md`).

## Upgrade Notes

- No config change required. Cached payloads carrying `overall` are still
  rendered under the System row via the back-compat fallback.
- TCMS time-filtered metrics migrated to
  `/api/v1/all_test_cases/aggregate/metrics` with `time_filter=four_weeks`
  and `target={milestone}-qcow2`. Legacy callers using
  `/api/v1/milestone_all_test_cases/aggregate/metrics` with `target_milestone`
  must migrate; legacy time-filter strings (e.g. "Last 4 Week") map to
  `four_weeks`.

## Known Issues

- Functional and System rows currently share the same source metrics
  (clone) until TCMS exposes a `test_category` filter. See
  [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md) and
  [tcms-rows-followup.md](../tcms-rows-followup.md).