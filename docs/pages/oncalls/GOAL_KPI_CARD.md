# Goal KPI Card — weave/oncall-report-email

GOAL: OnCalls V2 explains each hero — what it counts, how to read it, why it matters — so TPM/team-exec can act without guessing; previous V1→V2 + Download/Email still intact.

SCOPE: apps/delivery-ops/client/src/components/OncallsV2/OncallsV2Page.js (heroes + explainer guide + per-hero tooltips) + OncallReportSection.js (email footnote), server/services/oncallReportService.js (report glossary), docs/pages/Oncalls-requirements.md + Oncalls-data-layer.md + oncalls/Feature.md + api/jira.md (hero glossary)
BASE: origin/main @ 698e813 (follow-up on weave/oncall-report-email → base weave/oncall-report-fix)

DONE WHEN:
  1. /oncalls shows "What each number means" guide (collapsible) listing all heroes/health/taxonomy with What/How/Why columns
  2. Every hero card (Open now, Aged, Need Info, Waiting, Closed in window, MTTR median/p90, Throughput, Aged share, Duds/NDB gaps/Other-team + NDB sub) shows ℹ︎ tooltip with What/How/Why + meta/JQL hint; explain one-liner still visible
  3. Email HTML (Download + Send) includes matching glossary footnote so offline readers understand counts
  4. Docs updated: requirements AC for explainer, data-layer hero table with JQL + meaning, Feature one-liner, api/jira hero glossary
  5. Every JIRA hyperlink (hero JQL, ticket key, scope, live view) opens in new tab (target="_blank" rel="noopener noreferrer")
  6. Every AI-generated section (AI Concern card, PathDrill About column + AI slice header, email AI block) shows ✨ icon with title="AI generated"

AGENT KPIs:
  Developer:
    - Explainer guide: OncallsV2Page renders <details> "What each number means" with table Hero→What/How/Why (covers all 13 heroes inc NDB sub)
    - Per-hero tooltip: ExplainHero shows ℹ︎ with title = What + How + Why + meta; no layout break, token CSS
    - Email glossary: oncallReportService buildOncallReportHtml appends matching <h2>What each number means</h2> footnote with same What/How/Why
    - No hardcoded tenant strings in explainer — uses cfg.agedOpenDays gapProjectPrefixes generic labels
  Impact Scout:
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
    - /oncalls with teamId+timeframe returns 200 with hero/health/gapTaxonomy (live JQL proof — STALE: re-verify live before sign-off: `curl -H "Authorization: Bearer $PAT" "$HOST/api/jira/oncalls?teamId=ndb&timeframe=Overall"` must return `hero.open.jql` without `resolved >=` clause; Overall pill omits date filter)
    - /oncalls/report preview returns 200 HTML containing hero counts + JQL links; send returns messageId (mocked SMTP in test: server/__tests__/routes/oncallReport.test.js)
    - Overall timeframe omits resolved >= clause (covered by oncallReport.test.js: Overall + lowercase overall cases)
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
