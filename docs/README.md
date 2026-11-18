# Docs hub — `docs/` at repo root

Published site lives at `docs/index.html` (see `assets/style.css` for styling).

## Layout

| Path | What lives there |
|------|-----------------|
| `docs/index.html` | Hub home — links to every section |
| `docs/guides/` | User/admin/developer guides (published as HTML via `scripts/docs-build.js`) |
| `docs/technical/` | Cross-product architecture — `ARCHITECTURE.md`, `DECISIONS.md`, `HLD.md`, `TECH_DESIGN.md`, LLDs |
| `docs/api/` | Per-resource API contracts (jira, ai, email, etc.) |
| `docs/pages/` | Per-page requirements + data-layer contracts |
| `docs/product/` | PRD, requirements, capability map |
| `docs/architecture/` | Feature catalog, consolidation notes |
| `docs/exec-pitch/` | Exec pitch decks + design briefs |
| `docs/reports/` | Generated release reports (archived) |
| `docs/known-issues/` | Known issues register |
| `docs/dependency-audit-debt.md` | Cross-workspace `npm audit` debt — re-verify commands inside |
| `lighthouse/docs/` | **Lighthouse product docs** — PRD/HLD/LLDs, `api/`, `pages/`, `runbooks/`, `archive/` (product-owned, not hub) |
| `lighthouse/docs/runbooks/` | Lighthouse runbooks — logging, feature flags, deploy |
| `platform/docs/` | Shared infra — `AI_CONFIGURATION.md`, `NAI_SETUP.md`, `SMTP_PRODUCTION_SETUP.md` (SMTP + NAI only per D44) |

## Ownership (D44)

- `docs/` is the **cross-app hub** — published, cross-product technical truth.
- `lighthouse/docs/` is **product-owned** — Lighthouse controls its PRD/HLD/LLDs and runbooks.
- `platform/docs/` is **platform-owned** — SMTP + NAI only.

See `scripts/docs-verify.sh` + `scripts/docs-build.js` for hub verification and guide publishing.
