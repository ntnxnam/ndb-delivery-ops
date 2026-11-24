# Goal KPI Card — fix/closed-age-cycle

GOAL: Closed in window sample shows Priority/Assignee/Age correctly, with Age = cycle (created→resolved) not today-based.

SCOPE: apps/delivery-ops/server/services/oncallDashboardV2.js (closedStacksPreview shape) + oncallStacksService.js (cycleDays already computed) + server/services/oncallReportService.js (ticketRowsHtml Age column for closed) + client tables if any
BASE: origin/main @ b6d1dad (weave/oncall-report-fix merged)

DONE WHEN:
  1. Closed in window sample (≤20) returns priority, assignee, cycleDays, resolutiondate alongside key/summary/status/resolution (no missing columns)
  2. Age column for closed tickets shows cycle (e.g. 12d) = daysBetween(created, resolutiondate), not daysAgo(created)
  3. Report email + UI drills show 4 columns Priority/Assignee/Age filled, not "—" or missing
  4. Existing open-ticket Age still uses daysAgo(created) unchanged

AGENT KPIs:
  Developer: closedStacksPreview includes priority/assignee/cycleDays/created/resolutiondate; ticketRowsHtml uses cycleDays for closed scope
  Impact Scout: grep closedStacksPreview consumers (OncallsV2Page, oncallReportService, oncallDashboardV2) all patched
  Code Review: no hardcoded product strings, minimal-arch kept, cycleDays via daysBetween not daysAgo
  QA: closed sample fields non-null, Age = cycleDays not ageDays, open Age unchanged
  UX: tables show 4 columns without truncation
  PM: closed Age semantic correct (how long it lived before close)
  JIRA: no JQL change
  Compile Gate: node --check on 3 server files PASS
  Merge: branch fix/closed-age-cycle → origin/main via --no-ff
