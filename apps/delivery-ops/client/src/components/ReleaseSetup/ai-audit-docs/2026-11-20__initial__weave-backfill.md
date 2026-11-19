---
page: ReleaseSetup
route: /release-setup
source: apps/delivery-ops/client/src/components/ReleaseSetup
weave: weave-backfill
date: 2026-11-20
author: system (seed) + loom-builder (AI)
models: []
goal: "Seed initial audit trail for ReleaseSetup"
audience: portfolio_mgr
---

# 2026-11-20 — Release Setup — initial

## Prompt (verbatim)
> Seed the AI audit trail for every page — create `ai-audit-docs/` under each page with chronological naming conventions and weave integration.

This entry was seeded as the initial backfill for the AI audit trail feature itself. It documents the page's existence at the time the trail was introduced.

## Goal → Done When
- Every page in `routeConfig.js` has an `ai-audit-docs/` folder at its registry `auditPath`
- Chronological naming `YYYY-MM-DD__kebab-slug__weave-<slug>.md` enforced by `ai-audit-docs.mdc` and `docs-verify`
- Weave's Doc gate (8.5) requires a journal entry per touched page before merge
- Cross-page mistake log `docs/ai-audit/LEARNINGS.md` exists and is read before each weave
- `docs/ai-audit/timeline.md` aggregates all pages chronologically

## AI Config Snapshot
- `aiConfig.json` — Nutanix Enterprise AI (NuTokens) endpoint `beam-1-501b`, `maxTokens 8192`, key via `NAI_API_KEY` env
- `aiAudit.config.json` v1 — naming `YYYY-MM-DD__kebab-slug__weave-<slug>.md`, registry with 24 pages
- Models used for this seed: none (manual scaffold)

## Changes
| File | Change |
|------|--------|
| `apps/delivery-ops/client/src/components/ReleaseSetup/ai-audit-docs/` | Created audit folder for ReleaseSetup (folder-page) |
| `apps/delivery-ops/client/src/components/ReleaseSetup/ai-audit-docs/2026-11-20__initial__weave-backfill.md` | This seed entry |
| `apps/delivery-ops/client/src/components/ReleaseSetup/ai-audit-docs/INDEX.md` | Per-page chronological index (generated) |
| `apps/delivery-ops/server/config/aiAudit.config.json` | Added `ReleaseSetup` entry |
| `agent-pack/loom/rules/ai-audit-docs.mdc` | New rule: placement, naming, template, learning log |
| `agent-pack/loom/rules/weave.mdc` | Extended Stage 8.5 with AI Audit KPIs |
| `agent-pack/loom/skills/weave/SKILL.md` | Added AI Audit gate section |
| `agent-pack/loom/prompts/builder.md` | Added pre-weave reads: audit config, LEARNINGS.md, page INDEX.md |
| `scripts/loom/ai-audit/new-entry.sh` | Helper to scaffold journal entries |
| `scripts/loom/ai-audit/template.md` | Journal entry template |
| `scripts/loom/ai-audit/rebuild-indexes.js` | Index + timeline generator |
| `docs/ai-audit/INDEX.md` | Cross-page hub (generated) |
| `docs/ai-audit/timeline.md` | Cross-page chronological timeline (generated) |
| `docs/ai-audit/LEARNINGS.md` | Anti-repeat mistake log |
| `docs/ai-audit/README.md` | How to read/write audit docs |

## Decisions & Alternatives Considered
- **Co-located over fully centralized:** audit folders live next to page source so ownership is obvious; centralized `docs/ai-audit/` hub + timeline provide discovery without duplicating content.
- **Bucket pattern for file-pages:** single-file pages like `ReleaseSetup.js` cannot have a child directory, so they share `apps/delivery-ops/client/src/components/ReleaseSetup/ai-audit-docs/<PageName>/` — avoids renaming files to folders just for audit.
- **Chronological filename over numeric sequence:** dates sort naturally and carry meaning; weave slug ties back to the plan file.
- **Frontmatter required:** enables machine linting in `docs-verify` and timeline generation in `docs-build`.

## Mistakes & Corrections
No mistakes this weave — green-field scaffold with no prior trail to regress against.
<!-- Future entries: describe what went wrong, fix, and prevention. Cross-page patterns → docs/ai-audit/LEARNINGS.md -->

## Verification
- Registry lists 24 pages — all have audit folders on disk
- `bash scripts/lighthouse/docs/docs-verify.sh` — should PASS (naming + frontmatter + registry sync checks)
- `node scripts/lighthouse/docs/docs-build.js` — should regenerate hub + timeline without error

## Links
- Plan: `~/.opencode/plan/weave-ai-audit-docs.md` (this feature)
- Registry: `apps/delivery-ops/server/config/aiAudit.config.json#pages.ReleaseSetup`
- Rule: `agent-pack/loom/rules/ai-audit-docs.mdc`
- Page spec: `docs/pages/ReleaseSetup-requirements.md` + `docs/pages/ReleaseSetup-data-layer.md` (if present)
- Source: `apps/delivery-ops/client/src/components/ReleaseSetup/`

## Config Delta
```json
{
  "aiAudit.config.json": { "pages.ReleaseSetup.auditPath": "apps/delivery-ops/client/src/components/ReleaseSetup/ai-audit-docs" },
  "page": "ReleaseSetup",
  "route": "/release-setup",
  "kind": "folder-page"
}
```

## Follow-ups / Waivers
- Future weaves touching `ReleaseSetup` must add a journal entry via `scripts/loom/ai-audit/new-entry.sh --page ReleaseSetup --slug <kebab> --weave <slug>`
- Cross-page mistake patterns discovered while working on ReleaseSetup should be appended to `docs/ai-audit/LEARNINGS.md`

## Page Details
- **Component:** `apps/delivery-ops/client/src/components/ReleaseSetup/`
- **Route:** `/release-setup`
- **Description:** Create/rename releases and manage cleanup filters — `/release-setup`.
- **Kind:** folder-page
