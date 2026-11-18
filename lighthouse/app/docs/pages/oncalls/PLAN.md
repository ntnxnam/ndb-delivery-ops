# Plan — OnCalls pulse + authenticity

1. **Blocking UI** — EscalationDrill real status; AboutLine drawer banner (no per-row NAI limited)
2. **Requirements** — rewrite OC-01/OC-09/OC-10; feature GOALS/STATUS
3. **Server** — `oncallService.getDashboard` → `buildPulse({ baseJql: baseScopeJql })` soft-fail
4. **Client** — replace 7d Hero strip with `KpiPulseBand`; map open-family → PathDrill
5. **Docs** — data-layer + `docs/api/jira.md` OnCalls `pulse`
6. **Pipeline** — Code Review → QA → UX → PM → Exec → JIRA → Fix

Out of scope: kpiConfig JQL edits; System-Test pulse; SR chase-hero UI (taxonomy documented only).
