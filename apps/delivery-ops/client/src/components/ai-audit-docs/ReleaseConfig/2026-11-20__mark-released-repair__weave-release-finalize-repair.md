---
page: ReleaseConfig
route: /release-config
source: apps/delivery-ops/client/src/components
weave: weave-release-finalize-repair
date: 2026-11-20
author: TBD (human) + TBD (AI)
models: []
goal: "Handle JIRA-already-released repair — if JIRA was marked Released directly, allow completing lighthouse + email + ticket move"
audience: rm
---

# 2026-11-20 — Release Config — mark-released-repair

## Prompt (verbatim)
> What if someone had already marked release as release directly in jira?

## Goal → Done When
GOAL: Allow repair when JIRA already released — preview canRepair, mark skips PUT but completes lighthouse+email+tickets.
DONE WHEN: preview jiraAlreadyReleased/canRepair, mark repair flag, UI repair warning, 409 only for lighthouse released, compile PASS.

## AI Config Snapshot
- Models: muse-spark-816b
- Connectors: jiraConnector (versions, issue move), emailConnector

## Changes
| File | Change |
|------|--------|
| server/services/releaseFinalizeService.js | Dual-project live check parity, escapeHtml, RELEASE_DISTRO, repairFromJira |
| server/routes/config.js | preview/mark routes |
| client/src/components/ReleaseConfigPage.js | Repair button visible when _jira released, warning, dialog a11y |
| docs/api/config.md | 2 endpoints documented |

## Decisions & Alternatives Considered
Repair skips JIRA PUT but completes lighthouse/email/tickets; alternative hard 409 rejected as it strands tickets.

## Mistakes & Corrections
- Early mark blocked repair on _jira.released → fixed to allow repair when !lighthouseReleased.
- Button hidden on _jira.released → fixed to !released only with Repair label.

## Verification
- Review: Code Review COND PASS fixed, QA 9/10, JIRA 10/10, UX COND fixed, PM 7.5
- Compile: PASS
- docs-verify: PASS

## Links
- Docs: docs/api/config.md

## Config Delta
```json
{"repair": "jiraAlreadyReleased -> skip PUT, set repairFromJira"}
```

## Follow-ups / Waivers
File-size <500 waived (pre-existing); D1 RELEASE_DISTRO waiver documented.
