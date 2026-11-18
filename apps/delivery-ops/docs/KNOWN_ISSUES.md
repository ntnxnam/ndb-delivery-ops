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
| TCMS Quality table | `Functional` and `System` rows currently share the same source metrics (clone) until TCMS exposes a `test_category` filter. Time-filtered (Last 4 weeks) metrics now use `/api/v1/all_test_cases/aggregate/metrics` with `time_filter=four_weeks` and `target={milestone}-qcow2` (previously errored/echoed Overall). | Medium | None — rows are intentionally identical; do not read distinctness into them. Last 4 weeks shows "Not Set" when no runs in window. Tracked in `docs/tcms-rows-followup.md` | 2.12 | [tcms-rows-followup.md](./tcms-rows-followup.md) |