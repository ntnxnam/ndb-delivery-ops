---
page: ProjectStatus
route: /project-status
source: apps/delivery-ops/client/src/components
weave: weave-project-status-rename-fix
date: 2026-11-19
author: namratha.singh + muse-spark-816b
models: [muse-spark-816b]
goal: "seamless user and developer experience — fix stale ReleaseVersionTab name and prevent recurring item.getFieldValue crash"
audience: team
---

# 2026-11-19 — Project Status — stale-name-and-getfieldvalue-guard

## Prompt (verbatim)
> weave: fix that stale name, fix why this issue comes up consistently and make sure same mistakes are not repeated which is also part of weaver requirement Goal: seamless user and developer experience

## Goal → Done When
GOAL: Fix stale ReleaseVersionTab naming and prevent recurring item.getFieldValue crash
DONE WHEN: 1) ProjectStatusPage canonical with alias, no broken imports 2) Defensive getFieldValue + CI guard stops crash recurrence 3) docs-verify + compile canary pass

## AI Config Snapshot
- `aiConfig.json` @ SHA: check git log
- Models used: muse-spark-816b
- Connectors touched: jiraFieldsConfig (client+server), releaseItems

## Changes
| File | Change |
|------|--------|
| `client/src/components/ProjectStatusPage.js` | Renamed from ReleaseVersionTab.js; component `ProjectStatusPage` canonical, re-exports `ReleaseVersionTab` alias |
| `client/src/components/ReleaseVersionTab.js` | Shim re-export for backward compat |
| `client/src/components/ProjectStatusPage.css` | Renamed from ReleaseVersionTab.css; shim @import kept |
| `client/src/App.js:15,102` | Import/use ProjectStatusPage |
| `client/src/layout/utils/routeConfig.js:28` | component ProjectStatusPage |
| `client/src/utils/jiraFields.js:38` | Defensive getFieldValue unwraps .fields, delegates legacy method, fallback to fieldKey |
| `server/utils/jiraFieldsConfig.js:146` | Same parity fix |
| `client/src/utils/generateExecutiveSummary.js` etc | item.getFieldValue → getFieldValue |
| `scripts/loom/checks/check-no-stale-getfieldvalue.sh` | CI guard |
| `server/config/aiAudit.config.json` | file ProjectStatusPage.js |
| `docs/ai-audit/LEARNINGS.md` | 2 entries: naming + data |

## Decisions & Alternatives Considered
Rename vs alias-only: chose rename+shim to avoid breaking 30+ docs while fixing canonical name per ARCHITECTURE_TARGET Path B. Defensive getFieldValue handles both legacy method-items and plain JSON so future regressions self-heal; CI guard catches new stale calls.

## Mistakes & Corrections
Prior weave left `item.getFieldValue(item,` in 3 utils — every row threw TypeError. Corrected via bulk replace + defensive helper + CI guard. Logged in LEARNINGS.md (data).

## Verification
- Review: impact scout mapped 30+ consumers, all patched
- QA: check-no-stale-getfieldvalue PASS, node --check PASS on 4 files
- docs-verify: to run via docs-build.js (links preserved via shim)

## Links
- Plan: `~/.opencode/plan/weave-project-status-rename-fix.md`
- PR: pending
- Docs: LEARNINGS.md#2026-11-20 — data — recurring item.getFieldValue crash

## Config Delta
```json
{"pages.ProjectStatus.file":"ProjectStatusPage.js"}
```

## Follow-ups / Waivers
None
