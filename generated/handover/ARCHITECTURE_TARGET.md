# Architecture Target — NDB Ops Webapp

Status: **v2 (locked direction)** 2026-05-20. Supersedes the multi-surface plan
written earlier today. Pairs with `CONSOLIDATION.md` (port tracker) and
`DECISIONS.md` (rationale log).

> **D43 (2026-08-26):** Hard constraint 1 (NDB-only / one team in
> `teamBoardConfig.json`) is **lifted**. The rest of this document is
> historical context for the 2026-05-20 freeze. Multi-team onboarding is
> the current rule — see D1 and D43.

## North star (one sentence)

**A single React webapp at one URL that does everything an NDB ops person
needs in their day — release health, payload, sprint velocity, gate moves,
status email, executive snapshot — and nothing else.**

## Quality bar: fusion of React + Streamlit

This monorepo is the **fusion** of two predecessor apps, not a port of one
into the other:

- **React `ndb-status-sender`** brought: Gantt (loved), Release Versions table,
  date-mover with audit, email sender, auth + permissions, multi-team context.
- **Streamlit chatbot app** brought: 3-stream velocity with gate chips,
  landing forecast, burn trajectory, insights engine, NAI chatbot.

For every analytics surface, check the per-surface fusion map in
[`STREAMLIT_PARITY.md`](./STREAMLIT_PARITY.md) — it lists what each side
contributes and what the fused result should be. Surfaces aren't "done" until
the fused result is in place. If something is intentionally dropped from
either side, log it in the doc's "What we deliberately drop" table — never
silently.

The fusion order is also in that file; the first item — **Landing-Forecast
card on `/release/:name/brief`** — is the next concrete build target.

## Hard constraints (the pivot)

1. **~~NDB-only.~~** **Superseded by D43.** `teamBoardConfig.json` is a
   multi-team registry. NDB is the default tenant, not the only team.
   ProductService resolves whatever teams Admin has saved. Do not drop
   product-agnostic work (D1) from new code.
2. **Speed > preservation.** When a legacy feature blocks the new shape,
   delete it. Don't migrate code that nobody is using.
3. **Five routes max.** If a feature can't be expressed inside one of the
   five routes below, the question is "do we actually need it" — not
   "where should we put a sixth route".
4. **One JIRA path.** Every new and migrated endpoint goes through
   `shared/connectors/JiraConnector`. The 47-endpoint
   `routes/jira/index.js` shrinks as endpoints port; new ones never land
   there.

## Target surface — five routes

| Route | Owns | Replaces (today) |
|---|---|---|
| `/` | Auto-redirect to `/release/NDB-2.11/brief` (the active release) | — |
| `/release/:name/{brief,payload,gantt,velocity,gates}` | The whole single-release view: KPIs, payload composition, ticket table, sprint Gantt, 3-stream velocity, date moves | `ReleaseVersionTab` (1,582 LOC), `ReleaseVersionGantt` (1,425 LOC), `SprintReportPage` (1,589 LOC), `ReleaseConfigPage` (894 LOC), `KPIPage` (787 LOC, counts only) |
| `/team-exec` | Generate exec markdown/HTML, optional chatbot, predictions | `CrystalBallIChat` (chat) + AI-flavored leftovers |
| `/email/{compose,history}` | Send any status email; view history. One form, swappable templates. | `EmailSender/`, `GenericEmailer` (692 LOC), `ReleaseVersionEmailForm`, `EmailHistoryTab` (337 LOC) |
| `/admin` | Team settings, KPI definitions, gate calendar, audit, bin-packing link | `AdminPanel/`, `KPIPage` (definitions only), `ReleaseConfigPage` (calendar) |

Total: **5 top-level routes** vs today's **9 nav items**.

## Kill list

### Safe deletes (executed in this commit — no imports outside themselves)

- `client/src/components/CrystalBallInsights.js` (243 LOC) — commented out in ReleaseTrendsPage, not rendered
- `client/src/components/ReleaseDatePrediction.js` (208 LOC) — commented out in ReleaseTrendsPage
- `client/src/components/ReleaseRiskForecast.js` (134 LOC) — commented out in ReleaseTrendsPage
- `client/src/components/ExecutiveSummaryEditor.js` (228 LOC) — no imports
- `client/src/components/ConfluenceExtractor.js` (162 LOC) — no imports
- `client/src/components/JiraQuery.js` (277 LOC) — no imports
- `client/src/services/jiraQueryService.js` — only used by JiraQuery
- `client/src/services/confluenceService.js` — only used by ConfluenceExtractor
- `teamBoardConfig.json` entries for DataLens, NCM

Subtotal: **1,252 LOC + 2 service files + 2 config entries** gone, zero risk.

### Pending deletes (awaiting one explicit OK from the user)

| Item | LOC / size | Why kill | If kept |
|---|---|---|---|
| `apps/delivery-ops/crystalball-i/` (npm pkg with own node_modules) | ~2k LOC + deps | "Self-learning AI release prediction" — aspirational; the only live touchpoint is the React `CrystalBallIChat`, which can talk to any chat backend | Fold the prediction logic into `shared/services/releaseInsightsService.ts` over time; nuke the separate package now |
| `apps/tpm-confluence-tools/` (Python/Streamlit) | separate runtime | Different language, used ≤1× per release for bulk Confluence page creation | Keep but unlink from sidebar; document as standalone tool |
| Bin-packing sidebar tile (the static app itself stays mounted at `/bin-packing/`) | nav item | Quarterly capacity-planning tool; doesn't belong in daily nav | Move into `/admin` as a link, not a top-level tile |
| `ReleaseTrendsPage.js` (1,609 LOC) | huge | Trends become a tab on `/release/:name/trends` rebuilt from scratch; this file is mostly chart bloat + the chat shell | Migrate the 2–3 useful charts, delete the rest |
| `EmailSender/`, `GenericEmailer.js`, `ReleaseVersionEmailForm.js` | ~1k LOC | Three composers for the same conceptual action ("send email from JIRA data") | Merge into one `/email/compose` form with a template selector |
| `KPIPage.js` (787 LOC) | medium | Counts already shown on `/release/:name/brief`; only the admin/definitions piece needs to survive | Move definitions UI to `/admin/kpis` (~150 LOC), delete the rest |

If all six are OK'd: roughly **5,500 LOC removed**, one npm package killed, one
Python sub-app unlinked, ~50 endpoints in `routes/jira/index.js` available for
rationalization (most exist only to feed pages we're deleting).

## What survives, what gets rebuilt

| Today | Status | Action |
|---|---|---|
| `client/design-system/` (today) | KEEP | Foundation for everything |
| `client/release/ReleaseBriefPage.js` (today) | KEEP, EXTEND | Becomes the `brief` tab of `/release/:name/*` |
| `ReleaseVersionGantt.js` (1,425 LOC) | RE-SKIN | Dark-theme port, becomes `gantt` tab. Same data shape; CSS-only diff in v1. |
| `SprintReportPage.js` (1,589 LOC) | REBUILD on Path B | Becomes `velocity` tab. The shared `velocityService` already covers it. |
| `ReleaseVersionTab.js` (1,582 LOC) | REBUILD on Path B | Becomes `payload` tab. New table component composed from design-system primitives. |
| `ReleaseConfigPage.js` (894 LOC) | SPLIT | Per-release gate timeline → `/release/:name/gates`; admin calendar → `/admin/calendar` |
| `EmailSender/` + `GenericEmailer.js` + `ReleaseVersionEmailForm.js` | MERGE | One `/email/compose` page; templates pluggable |
| `EmailHistoryTab.js` | KEEP, MOVE | `/email/history` |
| `AdminPanel/` | KEEP, EXTEND | Becomes `/admin` |
| `dateMoverService` (shared) | KEEP | Wired into `/release/:name/gates` form |
| Sync Hub (header widget) | NEW | Lives in header, present everywhere, backed by `releaseDatasetService.sync` |

## Execution order (three short waves, no big-bang)

### Wave 1 — Foundations + Release surface (in flight)
1. ✅ Design system primitives (`/design`)
2. ✅ Release Brief shell + KPI panel
3. ✅ Engineering Payload synopsis
4. ✅ Sprint Velocity panel (3-stream, Path B end-to-end)
5. Outstanding Work panel (today's next ship)
6. `/release/:name/payload` — rebuilds `ReleaseVersionTab`, deletes it
7. `/release/:name/gantt` — re-skins `ReleaseVersionGantt`, deletes original
8. `/release/:name/gates` — date-mover form + gate timeline; deletes `ReleaseConfigPage`'s per-release half

### Wave 2 — Email + Team-Exec + Admin
9. `/email/compose` — one form, template registry; delete 3 old composers
10. `/email/history` — move `EmailHistoryTab` over
11. `/team-exec` — exec snapshot + chatbot (chatbot only if `crystalball-i` decision is "keep")
12. `/admin` — definitions, calendar, settings; delete the standalone `/kpis`, `/release-config`, `/release-setup` routes
13. Sync Hub header widget

### Wave 3 — Sweep
14. Wrap-or-delete remaining endpoints in `routes/jira/index.js`. Split file into `jira/{releases,sprints,kpis,search}.js` per `minimal-architecture.mdc`.
15. Delete remaining dead config files, scripts, archived docs at repo root.
16. Final pass: every file under its architecture hard limit.

## Non-goals (do not waste time on)

- Multi-product / multi-tenancy. NDB only.
- Multi-language. English only.
- Mobile / tablet. Desktop only (13″+ per `ui-density.mdc`).
- ESM-vs-CJS perfection. Lazy dynamic-import in the Express routes works.
- Backward-compat for users who bookmarked old URLs — add a one-line redirect when we delete, no archaeology.
- Preserving anything in `_archive/` (it's archived for a reason).

## Operating principle

When in doubt, **delete first, then build clean**. The codebase is at 20k+
LOC of React components and 6k LOC of one route file. We've earned the right
to shrink before we grow.
