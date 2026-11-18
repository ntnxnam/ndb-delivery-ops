# Team Overall Report Page — Requirements

## Overview
The Team Overall Report page (`/team-overall-report`) provides a portfolio-level view of a team's delivery performance over a configurable date window. It consumes `GET /api/reports/team-overall` and renders KPI cards, a grouped bar chart (Work Type distribution), a status pie chart, a JQL proof panel, an issues sample table, and NAI summaries.

## Audience
Portfolio Manager (primary), Team Executive (secondary, via role lens).

## Acceptance Criteria
1. Page renders for any configured team (ndb, prism-infra, etc.) with KPI cards.
2. Grouped bar chart shows Work Type distribution (count + story points).
3. Data table lists issuesSample with clickable Jira links (open in new tab).
4. Controls allow period type (quarter/year/custom), inclusion mode (closed/touched/worklogged), groupBy (issuetype/status/priority/assignee), and multi-project toggle.
5. Cache indicator shows when data is served from cache.
6. Force Refresh button bypasses cache.
7. Multi-project toggle includes/excludes companion project issues.
8. No hardcoded product strings (D1).
9. Responsive on 1280px without horizontal scroll.
10. Jira links open in new tab (`target="_blank" rel="noreferrer"`).

## Route
- Path: `/team-overall-report`
- Permission: `release_versions_view`
- Component: `TeamOverallReportPage`
- Layout: `Layout wide`