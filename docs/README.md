# Docs — hub

Served at `/docs` (alias `/Documentation`) via `express.static`; hub is `docs/index.html`.
Build: `node scripts/lighthouse/docs/docs-build.js` regenerates `docs/guides/*.html` from `docs/guides/*.md` only.

## Sections

| Path | Contents | Render |
|------|----------|--------|
| `guides/` | 16 how-to/ops guides (USER_GUIDE, ADMIN_GUIDE, DEVELOPER_GUIDE, DEPLOYMENT_GUIDE, etc.) | `.md` + generated `.html` |
| `technical/` | HLD, TECH_DESIGN, 4 LLDs, ARCHITECTURE, DECISIONS, ARCHITECTURE_TARGET, JIRA_STATUS_MAPPINGS, RBAC_GUIDE | `.md` |
| `product/` | PRD, REQUIREMENTS, DeliveryOps-full-capabilities | `.md` |
| `api/` | 23 per-resource API contracts (jira, ai, email, release-dataset, …) | `.md` |
| `pages/` | 44 per-page requirements + data-layer specs | `.md` |
| `reports/` | Past release slide-decks, VP reports, gantt | `.html` (static) |
| `release-notes/` | RELEASE_NOTES, NDB-2.11 | `.md` |
| `known-issues/` | KNOWN_ISSUES | `.md` |
| `exec-pitch/` | Exec pitch deck, speaker notes, slide images | `.md` + `.html` + assets |
| `architecture/` | CONSOLIDATION, FEATURE_CATALOG (consolidation tracking) | `.md` |
| `assets/` | Shared CSS (`style.css`) for hub + generated guide HTML | `.css` |
| `dependency-audit-debt.md` | Dependency audit — security / debt register | `.md` (top-level) |
| `tcms-rows-followup.md` | Follow-up tracker | `.md` (top-level) |

Root SoT docs `ARCHITECTURE.md` / `DECISIONS.md` / `README.md` mirror into `docs/technical/` where consumed by the hub; product docs live here (not `agent-pack/`).

## Conventions

- Only `guides/` has generated `.html` — all other sections link to `.md` (no build step).
- Hub links must point to files that exist; `docs-verify.sh` checks staleness.
- Operations handover lives in `generated/handover/` (git-tracked, not `docs/handover/`); link there only when ready (Phase F).
