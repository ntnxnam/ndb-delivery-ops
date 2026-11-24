---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
source: doc-known-issues @ 2026-05-19
---

# Known Issues

> Maintained by `doc-specialist` via `doc-known-issues` skill. Every row cites a JIRA ticket. Pipeline stage 8.5 keeps this current.

## Deferred / known-issue tickets

| Key | Summary | Severity | Workaround | Introduced | Link |
|---|---|---|---|---|---|
| — | _No deferred JIRA tickets at this time_ | — | — | — | — |

*Last verified: 2026-05-19 — re-check JIRA: `project = NDB AND labels in (known-issue, deferred) OR status = Deferred`*

## Known Limitations (no JIRA ticket yet)

| Area | Summary | Severity | Workaround / Status | Introduced | Reference |
|---|---|---|---|---|---|
| TCMS Quality table | **Fixed 2026-11-24:** `Functional` vs `System` now distinct via `test_case.test_sets` SystemTest regex (`^test_sets/milestones/{milestone}/[^/]+/SystemTest/` vs `$not`). Time-filtered (Last 4 weeks) uses `/api/v1/all_test_cases/aggregate/metrics` (`time_filter=four_weeks`, `target={milestone}-qcow2`) + category filter. | Medium | Verify in Project Status: Release/Master × Overall/Last 4 weeks should show different Functional/System manual/automation counts. See `docs/tcms-rows-followup.md` | 2.12 | [tcms-rows-followup.md](../tcms-rows-followup.md) |
| Bin-Packing Converter | File-to-CSV converter caps input at 10 MB; `.csv`, `.tsv`, `.xlsx`, `.xls`, `.pdf`, `.docx`, `.html`/`.htm` and pasted text are accepted. `.csv`/`.xlsx`/`.xls` are fully parsed; `.tsv`/`.pdf`/`.docx`/`.html` are decoded as text fallback (dedicated extractors are a future enhancement — see CSV_CONVERTER_GUIDE Supported Inputs). Other extensions receive a descriptive 422 error. Files above 10 MB are rejected before conversion. | Low | Reduce file or export as CSV/XLSX. See [CSV_CONVERTER_GUIDE.md](../product/CSV_CONVERTER_GUIDE.md) | 3.1 | [CSV_CONVERTER_GUIDE.md](../product/CSV_CONVERTER_GUIDE.md) |