---
page: FeatureDashboard
route: /feature-dashboard
source: apps/delivery-ops/client/src/feature
weave: weave-risk-indicator-trail
date: 2026-11-19
author: doc-specialist + risk-trail-weave
models: [muse-spark-816b]
goal: "Every release-tracking page consistently shows risk-indicator change history"
audience: portfolio_mgr
---

# 2026-11-19 — Feature Dashboard — risk-indicator-trail

## Prompt (verbatim)
> Every release-tracking page consistently shows risk-indicator change history. Verify ProjectStatus-data-layer checkpointHistory.riskIndicator contract + SoT, other pages dispositions, releaseHistoryService fix, client SoT consolidation, docs surfaces + ai-audit trail.

## Goal → Done When
GOAL: Risk trail visible on Project Status/SoS/email; dispositions explicit for out-of-scope pages. DONE WHEN: docs/pages/* consistent, SoT RAG_COLORS sole source, docs-verify PASS.

## AI Config Snapshot
- `aiConfig.json` @ SHA: TBD
- Models used: TBD
- Connectors touched: TBD

## Changes
| File | Change |
|------|--------|
| apps/delivery-ops/client/src/utils/riskHistoryDisplay.js | SoT + escapeHtml + classify aliases |
| apps/delivery-ops/client/src/components/ReleaseVersionTableCell.js | D41 consolidation via SoT |
| apps/delivery-ops/client/src/utils/emailTableGenerator.js | D41 consolidation + trail via formatRiskWithHistoryHTML |
| apps/delivery-ops/client/src/utils/sosEmailHtml.js | Import SoT, remove local RAG_COLORS, add trail |
| apps/delivery-ops/server/services/releaseHistoryService.js | includeRiskIndicator:true |
| docs/pages/ProjectStatus-data-layer.md | checkpointHistory.riskIndicator contract |
| docs/pages/FeatureDashboard-data-layer.md | risk trail disposition |
| docs/pages/EmailSender-data-layer.md | risk trail disposition |

## Decisions & Alternatives Considered
Decided: SoT riskHistoryDisplay (RAG_COLORS/riskWord/formatRiskWithHistoryHTML) — removed duplicate palette maps in sosEmailHtml/ReleaseVersionTableCell/emailTableGenerator. Rejected: separate endpoint for risk history.

## Mistakes & Corrections
Mistakes & Corrections: Initial duplicate RAG_COLORS in 3 files violated D41 SoT; corrected by consolidating to riskHistoryDisplay. HTML-interpolated risk words were unescaped (XSS) — added escapeHtml in formatRiskWithHistoryHTML. Cross-page learning appended to docs/ai-audit/LEARNINGS.md.
<!-- If there were mistakes, describe: what went wrong, how it was fixed, prevention. Link to docs/ai-audit/LEARNINGS.md when cross-page. -->

## Verification
- Review: SoT imports verified (grep RAG_COLORS).
- QA: Trail renders Red←Yellow←Green; single-value= no trail.
- docs-verify: PASS

## Links
- Plan: `~/.opencode/plan/weave-risk-indicator-trail.md`
- PR: TBD
- Docs: TBD

## Config Delta
```json
{}
```

## Follow-ups / Waivers
None
