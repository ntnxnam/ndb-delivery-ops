### POST /api/jira/release-items-tcms
**Purpose**: Return component-level release items with TCMS fields for Component Report.
**Auth**: required (`releaseVersions`)

> TCMS time-filtered (Last 4 weeks) metrics use `/api/v1/all_test_cases/aggregate/metrics` (`time_filter=four_weeks`, `target={milestone}-qcow2`); see `../tcms-rows-followup.md`.
