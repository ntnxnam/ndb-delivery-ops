# TPM Agent — Answers Log

> One row per open question. Updated as you answer. Source of truth for kpiConfig + hygiene + trigger wiring.

| # | Question | Answer | Recorded | Notes |
|---|----------|--------|----------|-------|
| 1 | CFD/CFI definition | Saved JIRA filters — categorise on the fly by filter name | 2026-11-19 | Top-CFD/CFI + Non-Top filters from kpiConfig; resolve filter name via JIRA API, group by name |
| 2 | Oncalls KPI | Saved filter | 2026-11-19 | Like Top-CFD/CFI; resolve via filter ID/name |
| 3 | Regression / system test | Saved filters | 2026-11-19 | Resolve via filter ID/name |
| 4 | Open verification | JIRA status | 2026-11-19 | Status like Ready for QA / In Verification / Resolved — map per workflow |
| 5 | SLA | Saved filter | 2026-11-19 | SLA breach via saved filter |
| 6 | fixVersion vs shadow | Only fixVersion is truth | 2026-11-19 | Release Payload per D36 — no shadow labels |
| 7 | Due date field | Standard duedate | 2026-11-19 | All issue types use standard duedate |
| 8 | P0/P1 source | priority is truth — Blocker - P0 / Critical - P1 | 2026-11-19 | Stable across products per D1 |
| 9 | Trigger scope | Category-scoped (CFDs-tracked releases) — duedate change / past-due / fixVersion without deferral+label → DAILY email, not immediate | 2026-11-19 | Aligns with release outstanding work page logic (deferral + label check); frequency: once a day |
| 10 | Daily digest (who + what) | IC plate by category + hygiene + fix; To=assignee/QA contact, CC=manager (role unknown — dev/QA/manager all can be assignee); deferral justification pending (starts after PG per live release) included | 2026-11-19 | To if you own ticket, CC if manager; deferral tracked only after Promotion Gate of live release |
| 11 | Slip wording | Approved — 'OS image issue — patch slip, RM-approved' | 2026-11-19 | Matches releaseVersionsEmailConfig ga3 reason |
| 12 | E-W projects KPI | Labels ndb-ew / global-ew / nutanix-ew — super important when in release — KPI uses release base filter | 2026-11-19 | baseQuery: labels in (ndb-ew, global-ew, nutanix-ew); combined via releaseBaseFilter (fixVersion scoping per D36) |
