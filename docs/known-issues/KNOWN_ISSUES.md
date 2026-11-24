---
product: NDB Delivery Ops
lastUpdated: 2026-11-24
source: doc-known-issues @ 2026-11-24
---

# Known Issues

> Maintained by `doc-specialist` via `doc-known-issues` skill. Every row cites a JIRA ticket. Pipeline stage 8.5 keeps this current.

## Deferred / known-issue tickets

| Key | Summary | Severity | Workaround | Introduced | Link |
|---|---|---|---|---|---|
| — | _No deferred JIRA tickets at this time_ | — | — | — | — |

*Last verified: 2026-11-24 — re-check JIRA: `project = NDB AND labels in (known-issue, deferred) OR status = Deferred`*

## Known Limitations (no JIRA ticket yet)

| Area | Summary | Severity | Workaround / Status | Introduced | Reference |
|---|---|---|---|---|---|
| TCMS Quality table | `Functional` and `System` rows currently share the same source metrics (clone) until TCMS exposes a `test_category` filter. Time-filtered (Last 4 weeks) metrics now use `/api/v1/all_test_cases/aggregate/metrics` with `time_filter=four_weeks` and `target={milestone}-qcow2` (previously errored/echoed Overall). | Medium | None — rows are intentionally identical; do not read distinctness into them. Last 4 weeks shows "Not Set" when no runs in window. Tracked in `docs/tcms-rows-followup.md` | 2.12 | [tcms-rows-followup.md](../tcms-rows-followup.md) |
| OnCalls V2 — gap NDB fallback | Gap taxonomy NDB detection falls back to `NDB` / `NDB-` prefix when `oncallConfig.json:gapProjectPrefixes` is absent. For non-NDB tenants, set `gapProjectPrefixes` (e.g. `["ENG"]`) or linked projectKey checks mis-classify. | Low | Set `gapProjectPrefixes` in `server/config/oncallConfig.json` for your tenant; component-contains-NDB fallback stays product-agnostic. See [Oncalls data-layer](../pages/Oncalls-data-layer.md#config) | 3.1 | [Oncalls-data-layer.md](../pages/Oncalls-data-layer.md) |
| OnCalls V2 — weekly report deferred | Weekly scheduled report (cron → email) + TPM Pulse card + SchedulePage hook planned for V2.1, not in V2.0. | Low | Use on-demand **Regenerate AI Concern** + manual email; tracked in [GOALS.md](../pages/oncalls/GOALS.md#waivers) | 3.1 | [GOALS.md](../pages/oncalls/GOALS.md) |
| Bin-Packing Converter | File-to-CSV converter caps input at 10 MB; `.csv`, `.tsv`, `.xlsx`, `.xls`, `.pdf`, `.docx`, `.html`/`.htm` and pasted text are accepted. `.csv`/`.xlsx`/`.xls` are fully parsed; `.tsv`/`.pdf`/`.docx`/`.html` are decoded as text fallback (dedicated extractors are a future enhancement — see CSV_CONVERTER_GUIDE Supported Inputs). Other extensions receive a descriptive 422 error. Files above 10 MB are rejected before conversion. | Low | Reduce file or export as CSV/XLSX. See [CSV_CONVERTER_GUIDE.md](../product/CSV_CONVERTER_GUIDE.md) | 3.1 | [CSV_CONVERTER_GUIDE.md](../product/CSV_CONVERTER_GUIDE.md) |