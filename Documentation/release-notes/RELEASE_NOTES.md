---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
source: doc-release-notes @ 2026-05-19
---

# Release Notes

> Rolling notes. Per-release files live under `docs/release-notes/<version>.md`. Maintained by `doc-specialist` via `doc-release-notes`.

## NDB 2.11 — _TBD_

See [release-notes/NDB-2.11.md](./release-notes/NDB-2.11.md) when cut.

### Recent changes (TCMS Quality table)

- TCMS Quality table now renders **Functional** and **System** rows (2×2:
  Functional/System × Manual/Automation) instead of the legacy
  Overall/Functional/Automation layout. `Overall` is no longer a row/title.
- Window label aligned to data source: **Last 4 weeks** (key
  `releaseLast4Weeks`/`masterLast4Weeks`), with deprecated alias
  `releaseLast3Weeks`/`masterLast3Weeks` retained for back-compat.
- Legacy `overall` data falls back to the **System** row for back-compat.
- Caveat: Functional and System rows currently share the same source metrics
  (clone) until TCMS exposes a `test_category` filter — see
  `KNOWN_ISSUES.md` and `docs/tcms-rows-followup.md`.
- TCMS time-filtered metrics corrected: "Last 4 weeks" now queries
  `/api/v1/all_test_cases/aggregate/metrics` with `time_filter=four_weeks`
  and `target={milestone}-qcow2`, returning genuinely filtered data instead
  of erroring or echoing Overall. See `docs/tcms-rows-followup.md` (Endpoint
  migration).

## Template for next release

Copy into `release-notes/<version>.md`:

- Highlights (3-5 exec-readable bullets)
- What's New / Enhancements / Bug Fixes
- Breaking Changes (⚠️ + migration step)
- Upgrade Notes
- Known Issues → [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)
