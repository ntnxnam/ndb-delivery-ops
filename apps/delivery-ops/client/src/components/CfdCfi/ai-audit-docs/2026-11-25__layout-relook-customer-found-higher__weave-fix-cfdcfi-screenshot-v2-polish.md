---
page: CfdCfi
route: /cfdcfi
source: apps/delivery-ops/client/src/components/CfdCfi
weave: fix-cfdcfi-screenshot-v2-polish
date: 2026-11-25
author: namratha.singh + loom
models: [muse-spark]
goal: "Relook at layout + fix screenshot defects + add Customer found categories breakdown"
audience: tpm, team, rm, team-exec
---

# 2026-11-25 — CFD / CFI — layout-relook-customer-found-higher

## Prompt (verbatim)
> Relook at the layout. Use @agent-pack/loom/rules/weave.mdc to decide. TEach Weave what you learn. Implement
> Keep running weave. Create new agents for all bugs you find and fix them. Run checkin smoke tests before you call it done.
> Do this repeatedly until goal is met — Tell me when you are finally done

Plus prior asks in this session: "Nah not good. Where is breakdown of all the Customer found categories?" and "Put it higher up in the page." — Customer found categories was missing, then buried as #10 of 13 breakdowns.

## Goal → Done When
GOAL: Fix every visual defect visible in 23:29 screenshot + add missing "Breakdown of all the Customer found categories" and place it higher up (first breakdown).
DONE WHEN:
1. Screenshot defects gone: 72 \uXXXX escapes → raw UTF-8 (— ↗ → · ⚡ ✕), hero counts large (button.value transparent + fs-section), RAG reads "RED — 282 aged open >14d.", title "CFD / CFI" clean
2. New breakdown "Customer found categories" between ChipRow and By component (higher up — #1 breakdown, not #10), driven by 5 Top-CFD/CFI qualifier sub-clauses (ONCALL link vs SF≥5 vs EELIST/DevEx/Serviceability vs Impact vs NPS) each count+JQL proof, row-click → drawer
3. check-compile PASS, docs-verify PASS, D1 clean (no hard-coded filter=142537)

## AI Config Snapshot
- `aiConfig.json` @ SHA: fe9868c (no model change; prompts via buildCfdcfiPrompt + generateCfdcfiBrief D44)
- Models: muse-spark
- Connectors: jiraConnector (searchPages/searchCount 7-way parallel + 5m cache)

## Changes
| File | Change |
|------|--------|
| client/src/components/CfdCfiV2/CfdCfiV2Page.js | 72 escapes → raw UTF-8, title V2→clean, hero button large, layout: Customer found moved from #10 (after Age buckets) to #1 (after ChipRow, before By component) — WHY before WHERE |
| client/src/components/CfdCfiV2/CfdCfiV2.css | Dedup duplicate .cfdcfi-v2-chips/chip/table blocks, add section-title/mono rules, hero button transparent |
| server/services/cfdcfiDashboardV2.js | TOP_QUALIFIER_SUBCLAUSES (5 literals from kpiConfig TOP qualifier), buildCustomerFoundQueries + fetchCustomerFoundBreakdown via andParts(baseScope,subClause,openStatusJql) → customerFound: [{label,count,jql}], 7-way Promise.allSettled, RAG includes Customer found context |
| server/routes/ai.js + naiService.js | CFDCFI concern prompt now includes CUSTOMER_FOUND line, COMPUTED_RAG verbatim |
| mcp/shared/tools/buildCfdcfiPrompt.ts | CUSTOMER_FOUND line in AI prompt |
| agent-pack/loom/rules/weave.mdc | Learnings: screenshot→bug list, layout WHY before WHERE, CSS dedup |
| docs/pages/cfdcfi/* + docs/api/cfdcfi.md | 6 breakdowns → 7, purpose line Customer found added, feature.md 7 cards |

## Decisions & Alternatives Considered
- **Layout: WHY before WHERE** — Customer found categories = WHY it became Top-CFD/CFI (which trigger: ONCALL link, SF cases, labels, Impact, NPS). First among breakdowns, right after Chips. Before: #10 buried below Age buckets/testEscape/linkage. New: ChipRow → Customer found (#1) → By component (WHERE) → By release → Age buckets (HOW LONG) → Test escape/Root cause/linkage (HOW FOUND) → Boomerang → Pulse. User: "Put it higher up" confirms hero insight status.
- **CSS dedup** — second `.cfdcfi-v2-chips {gap:6px}` silently stripped first's bg/border/radius; folded into one canonical block per selector; verified grep -c ==1.
- **Rejected:** Keeping Customer found at #10 — buried below 6 tables, VP never scrolls that far. Also rejected merging Customer found into existing breakdown (it's a distinct Top-qualifier taxonomy, not component-derived).

## Mistakes & Corrections
- **Layout miss:** Customer found initially appended after Age buckets (#10) because dev followed backend insertion order (last breakdown). User had to say "Put it higher up". Prevention: use weave.mdc layout decision (Story → At-a-glance → WHY → WHERE → HOW LONG → HOW FOUND) before placing any new breakdown.
- **CSS dedup miss:** Duplicates survived first polish commit — second review caught `grep -c ".cfdcfi-v2-chips {" ==2`. Prevention: check-compile doesn't catch CSS dedup; add `grep -c` to checkin smoke.
- **Title/pills minor:** Title still "V2" in one place, pills not sticky on second check — fixed via unicode pass.

## Verification
- Code Review: 7 P1 must-fix flagged → 3 fixed (section-title, dead variable, JSDoc), 4 deferred to layout relook (CSS dedup, App.js dead route, buildTimeframeHeroQueries, D1 hard-code) — now fixed.
- QA: 72 unicode literals → raw UTF-8 (0 left), hero button transparent + fs-section, Customer found table count+JQL proof per row + chip + drawer.
- UX: WHY→WHERE scan improved, no horiz scroll 375/768/1440, pills sticky, section titles styled.
- PM: "Put it higher up" satisfied — Customer found now #1 after Chips. "Breakdown of all the Customer found categories" present with 5 Top-trigger rows.
- JIRA: customerFound JQL = andParts(baseScope, subClause, openStatusJql) per 5 triggers, D1 clean (no filter=142537).
- Compile: shared PASS, server canary PASS, mcp pre-existing exempt (24 errors same as weave base), docs-verify PASS.
- Smoke: node --check dashboardV2 OK, docs-verify PASS, shared PASS.

## Links
- Fix: `fix/cfdcfi-screenshot-v2-polish@269b2e5` → `weave/cfdcfi-v2@1ad2b99` → `main@833bc4c`
- Screenshot: 23:29 2026-11-24 — RED — 282 aged open >14d, heroes tiny boxed, unicode literals
- Layout doc: `/tmp/layout_decision.md`

## Config Delta
```json
{ "TOP_QUALIFIER_SUBCLAUSES": ["oncallLinked", "sfCases5", "eelLabels", "impact", "nps"] }
```

## Follow-ups / Waivers
- Oncall chase fix (fix/oncall-chase) merged to main@a4fc4f7 before this fix — no conflict, rebased.
- Boomerang gateDates empty → 0% graceful fallback (known limitation).
- mcp/lighthouse|loom 24 pre-existing error TS on weave base — not introduced by this fix.
