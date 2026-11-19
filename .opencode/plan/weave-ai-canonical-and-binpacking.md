# Weave Plan: AI NAI Canonical + Bin-Packing Converter

## Goal

Fix "AI_API_KEY/AI_API_BASE_URL not configured" on CFD/CFI and Email Sender surfaces by making
`NAI_*` canonical for all 5 AI vars (keep `AI_*` fallback during transition), plus ship the
universal file→bin-packing CSV converter (UI + API + MCP) through the full delivery pipeline.

## Branch

`weave/feature-dashboard-shared-views` → merge to `main` (currently 5ef4c2e on 3c2c457).
Rebased from origin/main per merge-rebase-policy (clean, no conflicts). History:
- 60e328a feat(bin-packing): universal file→canonical CSV converter (15 files, 2731 ins)
- 5ef4c2e fix(ai): make NAI_* canonical for all 5 vars, keep AI_* fallback (9 files, cherry-picked 52d2533)

## KPI Card (from weave.mdc mandatory Goal→KPI contract)

```
GOAL: Email Sender + CFD/CFI surfaces no longer surface "AI not configured" errors; operators can upload any tabular file and get a bin-packing-ingest CSV via web UI or MCP.
SCOPE: shared/src/connectors/aiConnector.ts, apps/delivery-ops/server/{config/aiConfig.json,.env.example,services/*,routes/binPackingConvert.js,index.js,__tests__}, apps/bin-packing/*, mcp/shared/tools/convertToBinPackingCsv.ts, docs/*, mcp/lighthouse/src/index.ts
DONE WHEN:
  1. POST /api/bin-packing/convert accepts multipart + productId and returns canonical CSV (or structured error) with temp-dir cleanup + size/MIME gates.
  2. mcp/shared/tools/convertToBinPackingCsv + agent-pack/lighthouse/skills/csv-to-binpacking/ delegations work from loom/lighthouse MCP.
  3. shared aiConnector reads NAI_* first, falls back to AI_*, then aiConfig.json; no localhost default; all 5 vars have NAI_* canonical naming (NAI_API_KEY has no AI_* fallback per D40/secret rule).
  4. All pipeline gates pass: build, tests, docs-verify, link integrity, no-localhost, merge-rebase.

AGENT KPIs:
  Developer:        Bin-packing routes/services compile; aiConnector config precedence correct (NAI>AI>aiConfigJson>error); no secrets in logs.
  Impact Scout:     Grep coverage — every consumer of AI_* env keys patched; bin-packing import map has no unpatched consumers.
  Code Review:      No arch regressions (connectors→services→API), no useEffect loops, file caps OK, no localhost/Bearer drift, one-shot skill hygiene.
  QA:               Bin-packing happy/sad paths verified; AI surfaces render (no raw dump); count/metric links verified if any; docs-verify + docs-build PASS; link gate PASS.
  UX:               Upload flow reachable, a11y OK, responsive 375/768/1440, no crushed layout; Email Sender + CFD/CFI no longer show raw config errors.
  PM:               Goal fit — operator can upload→CSV + Email Sender/CFD-CFI errors gone; AC testable; scope discipline; persona correct.
  Exec:             N/A — no new dashboard/exec surface (skip with one-line note in handoff).
  JIRA Query Check: N/A — no metrics/JQL/counts added (bin-packing is file→CSV, AI is config; skip with note in handoff).
  Doc:              Known Issues / Release Notes / USER_GUIDE / ADMIN_GUIDE / Tech Guide + docs/api/ai.md + docs/pages/bin-packing where required; docs-build + docs-verify PASS, zero DOA links.
  Merge:            Rebased on origin/main (no conflicts), user ok obtained, commit clean, push ok, status clean; branch deleted per merge-rebase-policy.
```

## Stage assignments (appropriate leads per weave.mdc)

| Stage | Lead / technique |
|-------|-----------------|
| 1 Developer | Loom (this session) — land + scaffold check; already done (rebase + cherry-pick 5ef4c2e committed) |
| 1.5 Impact Scout | impact-scout lead — grep AI_* consumers + bin-packing import coverage; Blocking if unpatched consumers |
| 2 Code Review | Bugbot + one-shot comments-check in parallel (weave.mdc code-review modes) |
| 3 QA | QA lead — bin-packing paths + AI guardrails + docs-verify/link gate |
| 4 UX | UX lead — upload + Email Sender/CFD-CFI polish; responsive + a11y |
| 5 PM | PM lead — goal fit + AC + scope discipline |
| 6 Exec | skip — no exec surface (one-line note) |
| 7 JIRA QC | skip — no JQL/counts (one-line note) |
| 8 Fix | Loom — apply Blocking punch-list, re-run failed gates |
| 8.5 Doc | doc lead — 5-surface doc sweep |
| 8.6 Final Acceptance | QA-owns-UX lead — post-Fix regression sweep |
| 9 Security | PAUSED — skip per weave.mdc |
| 10 Merge | merge-agent / Loom direct — rebase already done; await user ok, then merge→push→delete branch |
| 11 Back to user | Loom — short KPI scorecard, ask for ok→merge |

## Hard gates for this weave (from weave.mdc + mdc rules)

- `merge-rebase-policy`: already rebased on origin/main (3c2c457) clean; next merge must still `git fetch` + confirm.
- `no-localhost`: client uses relative /docs/ + dev proxy setupProxy.js; fail if any localhost/127.0.0.1 in client/src.
- `ai-config-sync`: 5 vars NAI_* canonical, NAI_API_KEY no AI_* fallback; aiConfig.json stays non-secret; .env.example mirrors.
- Link integrity: broken/DOA href gate — docs-verify.sh + docs-build.js must PASS.
- `one-shot.mdc`: skills csv-to-binpacking under agent-pack/lighthouse/skills/ must stay one-shot hygiene.

## Open questions

None blocking — AI fix mirrors shipped 52d2533 (already QA'd in earlier loop); bin-packing is new surface needing full sweep.
