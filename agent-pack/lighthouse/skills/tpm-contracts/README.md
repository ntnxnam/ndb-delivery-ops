# tpm-contracts — phase + report + schedule contracts for 6 TPM weaves

Each fetch weave implements one phase contract. Report + schedule bind to these,
so all 6 loom weaves can run in parallel after Stage 0.

- `tpm-post-release.json` — every KPI tagged `postRelease` (CFDs/CFIs/Oncalls/E-W post)
- `tpm-execution.json` — every KPI tagged `execution` (P0/P1/E-W/dev-test)
- `tpm-at-release.json` — every KPI tagged `release` (regression/system/verify)
- `tpm-overall.json` — every KPI tagged `overall` (SLA/CVE/deferral)
- `tpm-report.json` — 4 report modes fan out to the 4 phases
- `tpm-schedule.json` — schedule CRUD + runner contract

Each has input/output + examples. Weaves assert against theirs.
Shared types: `shared/src/types/tpm.ts` (TpmScope, TpmFetchResult, TpmSchedule).
