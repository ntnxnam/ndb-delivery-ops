---
page: ReleaseConfig
route: /release-config
source: apps/delivery-ops/client/src/components
weave: weave-release-announce-gantt
date: 2026-11-20
author: namratha.singh (human) + muse-spark-816b (AI)
models: [muse-spark-816b]
goal: "When marking release from app, also send release announcement draft to logged-in person (NDB-2.11 example → reusable prompt)"
audience: portfolio_mgr
---

# 2026-11-20 — Release Config — release-announcement-draft

## Prompt (verbatim)
> When marking release from the app, alongside the jira and other changes in config, we need to also send a release announcement draft to the person who has logged in. (NDB-2.11 sample provided as example for reusable prompt)

## Goal → Done When
GOAL: When marking release from http://localhost:8899/release-config, also send announcement draft to actor (logged-in user) via usernameToEmail, using NDB-2.11 sample as reusable prompt for all future releases. DONE WHEN: preview shows announcementDraftTo/Subject (relative /api, no localhost), markReleased returns announcementDraft.sent to actor, Gantt only open (!released) with dynamic gates (cc=N, not just 2), no localhost hardcode, compile PASS, prompt registered in manifest/INDEX.

## AI Config Snapshot
- `aiConfig.json` beam-1-501b maxTokens 8192 via NAI_API_KEY
- Models: muse-spark-816b (prompt + fallback), beam-1-501b for generation
- Connectors: jiraConnector (fetchReleaseFeatures), emailConnector (sendAnnouncementDraft), aiConnector (generateReleaseAnnouncement)

## Changes
| File | Change |
|------|--------|
| `apps/delivery-ops/client/src/components/ReleaseConfigPage.js` | Preview modal 6th li + toast for announcementDraft (announcementDraftTo/Subject) |
| `apps/delivery-ops/client/src/components/ReleaseGantt.js` | Filter !released (D30) + grace 60d + getLatestGateDate dynamic N with solid preference; fixes mixing past/open + NDB-3.0-EA ccm3Gate |
| `apps/delivery-ops/server/routes/config.js` | Preview enriches announcementDraftTo via usernameToEmail, markReleased already delegates to service |
| `apps/delivery-ops/server/services/naiService.js` | RELEASE_ANNOUNCEMENT_SYSTEM_PROMPT + buildReleaseAnnouncementPrompt + generateReleaseAnnouncement (temp 0.4) |
| `apps/delivery-ops/server/services/releaseAnnouncementService.js` | New 290-line service: extractGaDate, fetchReleaseFeatures (fixVersion JQL), buildFallbackHtml (NDB-2.11 buckets placeholder), generateAnnouncementHtml (AI-first fallback), sendAnnouncementDraft (username→email, never throws) |
| `apps/delivery-ops/server/services/releaseFinalizeService.js` | Header 5→6 step, import usernameToEmail, preview null placeholder, markReleased 6th step sendAnnouncementDraft (swallowed) |
| `agent-pack/lighthouse/prompts/production/release-announcement.md` | Canonical prompt 112 lines, product-agnostic D1, NDB-2.11 example buckets |
| `agent-pack/lighthouse/manifest.json` + `prompts/INDEX.md` | Register release-announcement prompt |
| `docs/api/config.md` | 6-step purpose + announcementDraft preview/markReleased samples |
| `server/utils/teamResolve.js` | Extracted resolveTeamForRelease to avoid duplication (D3) |

## Decisions & Alternatives Considered
Chosen: AI-first (naiService) with deterministic fallback (buildFallbackHtml) — never blocks finalize; preview shows recipient via relative fetch (no localhost per no-localhost.mdc, fixed ports 8899/8001); Gantt uses !released SoT + 60d grace to keep recent overdue visible but hide very old (NDB-2.10) without mixing past released. Rejected: hardcoding NDB in fallback (fixed to product variable), grace-only filter (hid overdue open), local getLatestGateDate duplication (now extracted/shared).

## Mistakes & Corrections
Initial Gantt filter used !released alone → showed 13 releases spanning 2y, hid nothing, looked empty to user; fixed to !released + grace 60d (UX 7d→60d) to keep recent overdue. Initial getLatestGateDate had dead candidates array + legacyKey param never used; deduped to prefix-only. Support channel hardcoded #ndb → fixed to #${product.toLowerCase()} (D1). Missing a11y role/dialog on modal → added role="dialog" aria-modal aria-labelledby.

## Verification
- Review: Code Review 5/12 MET → fixed a11y, overflow, D1, dead code; UX 8.5/10 PASS; PM 8/10 PASS; Impact Scout no blocking
- QA: emailService 14/14 PASS, teamOverallReport pre-existing 8 fails unrelated
- docs-verify: PASS (after new-entry + rebuild-indexes)
- check:compile: PASS (shared/mcp/lighthouse/mcp/loom + server canary)

## Links
- Plan: `agent-pack/lighthouse/prompts/production/release-announcement.md` (NDB-2.11 sample)
- PR: weave/release-announce-gantt → main
- Docs: `docs/api/config.md` 6-step + `docs/pages/release-config.md` N/A (existing page, api is SoT per PM)
- Manifest: `agent-pack/lighthouse/manifest.json:470`

## Config Delta
```json
{
  "releases": {
    "announcementDraftTo": "actor@nutanix.com via usernameToEmail(username)",
    "announcementDraftSubject": "[DRAFT] Announcing ${product} ${version} — Official Release is Live 🎉"
  }
}
```

## Follow-ups / Waivers
Waived: file-size 852 >600 for ReleaseConfigPage.js (pre-existing monolith, split to useReleaseFinalize deferred); compile-gate never waived.
