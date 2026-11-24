# Goal KPI Card — weave/oncall-report-email

GOAL: OnCalls is V2-only at /oncalls (V1 removed) with Download Report + Send Email HTML email reusing Outstanding report pattern, timeframe-driven (7d..Overall), CSS fixed — like other pages.

SCOPE: apps/delivery-ops/client/src/App.js (route), components/OncallsV2/OncallsV2Page.js + OncallReportSection.js, hooks/useOncallReport.js + useOncallsV2.js, server/services/oncallDashboardV2.js + oncallReportService.js (new) + oncallBlurbService.js, server/routes/jira/oncalls.js (report endpoint), server/services/oncallService.js (legacy orphan), docs/pages/oncalls/*, docs/api/jira.md, USER_GUIDE
BASE: origin/main @ 1d59110

DONE WHEN:
  1. /oncalls renders V2 (8 pills 7d/15d/1M/1Q/2Q/1Y/18M/Overall, Overall=no clause), /oncalls-legacy → /oncalls redirect, V1 files deleted (OncallsPage.js, useOncalls.js, pulse test)
  2. CSS fixed: OncallsV2Page imports Oncalls.css for oc-* + ocv2-* styles, no unstyled page
  3. Download Report produces standalone HTML (heroes/health/taxonomy/workflow + ticket tables + JQL proof links) via client triggerDownload
  4. Send Email preview/send via POST /api/jira/oncalls/report → buildOncallReportHtml + sendEmailDirect (same SMTP/CC as Outstanding), subject [OnCalls tf] team — N open

AGENT KPIs:
  Developer:
    - V1 removed: App.js no OncallsPage import, legacy route is Navigate redirect, deleted files not importable
    - CSS re-wired: OncallsV2Page imports ../Oncalls/Oncalls.css + ./OncallsV2.css
    - Report service exists: oncallReportService.js buildOncallReportHtml + previewOrSendOncallReport, uses sendEmailDirect, defaultRecipients
    - Route exists: POST /api/jira/oncalls/report with previewOnly + dashboard passthrough, kpi_view auth
    - Client hook + section: useOncallReport + OncallReportSection with Download/Preview/Send, wired into OncallsV2Page
    - No hardcoded NDB/ERA in new code — uses cfg.teamId / cfg.baseScopeJql (product-agnostic D1)
    - oncallBlurbService refactored to oncallConfigResolve (no oncallService import)
  Impact Scout:
    - All consumers of deleted files grep'd: OncallsPage, useOncalls, oncallService importers patched or confirmed orphan (only oncallAiSummaryService legacy, not on hot path)
  Code Review:
    - no localhost in client/src (relative /api + proxy)
    - minimal-architecture: component renders, hook fetches, service transforms; no fetch in JSX
    - no JQL edit without approval; gap taxonomy uses cfg.gapProjectPrefixes
    - server/index.js dotenv still loads server/.env + apps/delivery-ops/.env (no regression)
  QA:
    - /oncalls with teamId+timeframe returns 200 with hero/health/gapTaxonomy (live JQL proof)
    - /oncalls/report preview returns 200 HTML containing hero counts + JQL links; send returns messageId (mocked SMTP in test)
    - Overall timeframe omits resolved >= clause
  UX:
    - Pill bar sticky, active state, 8 pills visible at 1280/768
    - Download/Preview/Send bar aligned, not crushing hero grid; drill overlay still works (z-index, overflow hidden)
    - Print hides sidebar (Layout.css @media print)
  PM:
    - OnCalls value prop preserved: one timeframe drives all, AI Concern + health + taxonomy, drill keeps timeframe
    - Email subject + HTML answers team-exec question: how many open/aged, where gap, what to chase — like Outstanding
    - No scope creep: no new KPI, no Streamlit
  Exec:
    - /oncalls shows RAG + AI Concern first, then heroes/health as evidence (high-level first, drill-down)
    - Every count has JQL proof: count → PathDrill, Open in JIRA ↗ → exact JQL per metric-click-dual-action
  JIRA Query Check:
    - timeframeClause returns null for Overall, else "resolved >= -Nd" / "created >= -Nd" with correct field
    - linkedOutJql = issueFunction in linkedIssuesOf("<OnCalls KPI baseQuery>") per kpiConfig, not invented wrapper
    - All hero JQLs via buildTimeframeHeroQueries (seed + status + timeframe clause)
  Compile Gate:
    - node --check server/index.js + oncallReportService.js + oncalls.js pass; tsc --noEmit for shared/mcp passes when tsc available (server OK is blocking gate)
  Merge:
    - Branch weave/oncall-report-email → origin/main via --no-ff, status clean, pushed
