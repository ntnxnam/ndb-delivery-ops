---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
source: doc-specialist @ 2026-05-19 (TCMS Quality rows follow-up)
---

# TCMS Quality Rows — Migration & Deprecation Follow-up

Companion to `KNOWN_ISSUES.md` and the TCMS Quality table rendered by
`client/src/components/ReleaseVersionTableCell.js` (`renderQualityCell` /
`renderQualityTable`) and `client/src/utils/emailTableGenerator.js`.

## Current shape (shipped)

- Each TCMS Quality table is a 2×2 grid:
  - Rows: **Functional**, **System**
  - Columns: **Manual**, **Automation**
  - Cells: QI / Run / Passed / Failed / Rate
- Four tables per feature: `Release — Overall`, `Release — Last 4 weeks`,
  `Master — Overall`, `Master — Last 4 weeks`.
- Window key: `releaseLast4Weeks` / `masterLast4Weeks` (primary) with
  deprecated alias `releaseLast3Weeks` / `masterLast3Weeks` (kept for
  back-compat, see below).

## Clone caveat (WAIVED — pending TCMS `test_category` filter)

`Functional` and `System` rows currently share the **same source metrics**
(`tcmsService.enrichItemWithQuality` → `toTable` clones `functional` from
`system`). TCMS does not yet expose a `test_category` filter, so distinct
per-category aggregates cannot be fetched. Rows are intentionally identical;
no UI/email label claims distinctness. Tracked as a known limitation in
`KNOWN_ISSUES.md`.

**Unblock condition:** TCMS exposes a `test_category` (or equivalent)
filter on `all_test_cases/aggregate/metrics` (or
`quality_index`). When available, split `fetchMergedMetrics` into
`functionalMetrics` vs `systemMetrics` in `tcmsService.js` and stop cloning.

## overall → system fallback (back-compat)

Legacy data shape carried an `overall` key per table
(`{ overall, functional, automation }`). The new shape drops `overall` and
keeps `functional` + `system`. To avoid breaking older cached/enriched
payloads, the renderers fall back:

- UI (`renderQualityTable`): `rowData?.[key] ?? (key === 'system' ? rowData?.overall : null)`
- Email (`emailTableGenerator`): `data[r.key] ?? (r.key === 'system' ? data.overall : null)`

This keeps legacy `overall` data visible under the **System** row until the
fallback is removed.

## Deprecation timeline

| Alias / fallback | Introduced | Removal target | Removal condition |
|---|---|---|---|
| `releaseLast3Weeks` / `masterLast3Weeks` keys (alias of `*Last4Weeks`) | 2026-05 (D2) | After 2 sprints (~2026-07) | All consumers read `*Last4Weeks`; tests updated |
| `overall → system` row fallback in UI/email renderers | 2026-05 | After 2 sprints (~2026-07) | No cached payload carries `overall` key; `tcmsService` stops emitting it |
| Clone of `functional` from `system` (D1) | 2026-05 | When TCMS ships `test_category` filter | Distinct fetch implemented + tests for distinct data |

## Action items

1. File/track JIRA ticket for TCMS `test_category` filter (owner: QA/TCMS).
2. Remove `releaseLast3Weeks`/`masterLast3Weeks` alias from `tcmsService.js`
   (`enrichItemWithQuality`) and from UI/email `??` fallbacks once sprints elapse.
3. Remove `overall → system` fallback once no cached payloads carry `overall`.
4. Add distinct-data test coverage once clone is resolved (KPI item 4).
5. Update `docs/api/jira-project-status.md` and `docs/pages/ProjectStatus-*`
   if the `tcmsQuality` shape changes.

## Endpoint migration — time-filtered metrics (Last 4 weeks)

Previously the time-filtered window called
`/api/v1/milestone_all_test_cases/aggregate/metrics` with `target_milestone`
and passed the raw time-filter string (e.g. `Last 4 Week`); TCMS either
errored or echoed the Overall window, so "Last 4 weeks" was not genuinely
filtered.

Corrected call (shipped):

- Endpoint: `/api/v1/all_test_cases/aggregate/metrics`
- `aggregation_field`: `test_case.metadata.requirements`
- `time_filter`: `all` (Overall window) or `four_weeks` (Last 4 weeks)
- `target`: `{milestone}-qcow2` (e.g. `NDB-2.12-qcow2`)
- `feat_type`: `all`
- `filters`: `{"$and":[{"test_case.metadata.requirements":"{featKey}"},{"test_case.deprecated":false}]}`

Legacy time-filter strings are mapped to `four_weeks` for back-compat
(`tcmsService.fetchMilestoneMetrics`: `timeFilter === 'all' ? 'all' : 'four_weeks'`).
For time-filtered windows, `fetchMergedMetrics` no longer falls back to the
Overall QI — the table shows "Not Set" when there are no runs in the window.

Migration note for callers/consumers: any code or cached payload still using
the old `milestone_all_test_cases/aggregate/metrics` + `target_milestone`
path must migrate to the call above; the old path is retired for time-filtered
metrics (it remains in use only for the count fallback
`/api-readonly/v1/milestone_all_test_cases/aggregate/total`).

## References

- `apps/delivery-ops/server/services/tcmsService.js` (`enrichItemWithQuality`, `toTable`)
- `apps/delivery-ops/client/src/components/ReleaseVersionTableCell.js` (`renderQualityCell`, `renderQualityTable`)
- `apps/delivery-ops/client/src/utils/emailTableGenerator.js` (quality branch)
- `apps/delivery-ops/server/config/releaseVersionsColumnsConfig.json` (quality column description)
- `apps/delivery-ops/client/src/__tests__/components/ReleaseVersionTableCell.quality.test.js`
- `apps/delivery-ops/server/__tests__/services/tcmsService.test.js`
- `apps/delivery-ops/docs/KNOWN_ISSUES.md`
