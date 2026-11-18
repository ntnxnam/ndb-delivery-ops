# Documentation — Single Source of Truth

> All product documentation lives under `Documentation/` at repo root.
> Old paths (`apps/delivery-ops/docs/`, `docs/`, root `*.md` duplicates) are redirect stubs.

## Structure

```
Documentation/
  index.html              # HTML hub — browsable product docs
  assets/style.css
  guides/                 # USER_GUIDE.md + HTML, ADMIN_GUIDE.md + HTML, DEVELOPER_GUIDE.md
  technical/              # HLD.md, TECH_DESIGN.md, LLD-*.md, ARCHITECTURE.md, DECISIONS.md (MD only)
  product/                # PRD.md, REQUIREMENTS.md, DeliveryOps-full-capabilities.md
  api/                    # per-endpoint contracts (MD only)
  pages/                  # per-page requirements + data-layer (MD only)
  release-notes/          # RELEASE_NOTES.md (rolling) + <release>.md versioned (MD only)
  known-issues/           # KNOWN_ISSUES.md — post-ship open bugs (MD only, live JIRA)
  reports/                # past-releases slide-decks (HTML)
  exec-pitch/             # Lighthouse pitch (HTML already)
  handover/               # _Handover_Doc migrated
```

## HTML vs Markdown rule

- **HTML + MD:** `guides/*` — browsable product docs; `index.html` hub; `exec-pitch/` and `reports/` already HTML.
- **MD only:** `technical/`, `product/`, `api/`, `pages/`, `release-notes/`, `known-issues/` — engineering source of truth, linked from HTML.

## Agents — where they write

| Skill | Output |
|---|---|
| `doc-user-guide` | `Documentation/guides/USER_GUIDE.md` → `scripts/docs-build.js` regenerates `.html` |
| `doc-admin-guide` | `Documentation/guides/ADMIN_GUIDE.md` → `.html` |
| `doc-tech-guide` | `Documentation/technical/` (HLD/LLD/TECH_DESIGN on relevant diffs) |
| `doc-release-notes` | `Documentation/release-notes/RELEASE_NOTES.md` + `release-notes/<ver>.md` |
| `doc-known-issues` | `Documentation/known-issues/KNOWN_ISSUES.md` + optional `known-issues/<release>.md` |
| `past-releases-report` | `Documentation/reports/*.html` |
| `team-exec-briefing` | `Documentation/reports/TeamExec-*.md/.html` (if requested) |
| API/page docs | `Documentation/api/*.md`, `Documentation/pages/*.md` per `api-docs-required` / `page-docs-required` |

## Hygiene enforcement

- **Stage 8.5 Doc sign-off** — scores 5 surfaces (user/admin/tech/release-notes/known-issues) + `api/`/`pages/` when routes/pages ship.
- **Build:** `node scripts/docs-build.js` — MD → HTML for guides.
- **Verify:** `bash scripts/docs-verify.sh` — stale paths, broken links, build.
- **CI gate:** `documentation-consistency.mdc` fails if product docs written outside `Documentation/`.
