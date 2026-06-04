# Decommission record

Forward-looking plan turned out, by 2026-05-20, to be largely a history. This
file is the recovery map.

## What's already gone

The original legacy folders under `~/` have been deleted and tarballed.
`~/NDB-Ops-Tools/_archive/` holds 17 tarballs (~173 MB compressed). Recovery
takes seconds.

| Original folder | Tarball | Imported / ported into |
|---|---|---|
| `~/ndb-status-sender/` | `ndb-status-sender.tar.gz` | `apps/delivery-ops/` |
| `~/Confluence-Page-Creator/` | `Confluence-Page-Creator.tar.gz` | `apps/tpm-confluence-tools/` |
| `~/ndb-date-mover/` | `ndb-date-mover.tar.gz` | `mcp-server/` + `shared/services/dateMoverService.ts` |
| `~/ndb-story-point-calculator/` | `ndb-story-point-calculator.tar.gz` | folded into shared velocity service |
| `~/ndb-say-vs-do/` | `ndb-say-vs-do.tar.gz` | folded into shared insights (delivery-vs-plan) |
| `~/ndb-projects-bin-packing/` | `ndb-projects-bin-packing.tar.gz` | `apps/bin-packing/` (static mount) |
| `~/Release-Timelines-Visualizer/` | `Release-Timelines-Visualizer.tar.gz` | folded into `ReleaseVersionGantt` (now `/release/:name/gantt`) |
| `~/ndb-capacity-planner/` | `ndb-capacity-planner.tar.gz` | folded into bin-packing |
| `~/GitHub-Commits/` | `GitHub-Commits.tar.gz` | not yet ported (low value) |
| 8× Tier-D experiments | various | archived only, not ported |

## What's been removed *inside* the monorepo

The architecture pivot on 2026-05-20 (see `ARCHITECTURE_TARGET.md` v2) deleted
substantial overhead that was carried in from the imports but never reached
production usefulness:

| Removed | Size | Reason |
|---|---|---|
| `apps/delivery-ops/crystalball-i/` | 57 MB + ~2k LOC | "Self-learning AI release prediction" — aspirational, never wired to real data; the chat shell was the only live touch and it's gone too |
| `apps/delivery-ops/server/routes/crystalball.js` | 285 LOC | Routes for the above |
| `client/src/components/ReleaseTrendsPage.js` | 1,609 LOC | Chart bloat + chat shell; trends will return as a small tab on `/release/:name/trends` |
| `client/src/components/CrystalBallIChat.{js,css}` | 565 LOC | Bound to deleted backend |
| `client/src/components/ReleaseVersionTrends.js` | 365 LOC | Dead — never imported |
| `client/src/components/JiraAuth.{js,css}` | 165 LOC | Superseded by `AuthContext` |
| 6 dead AI/utility components (Insights, DatePrediction, RiskForecast, ExecutiveSummaryEditor, ConfluenceExtractor, JiraQuery) + 2 orphan services + CSS | ~1,250 LOC | Zero imports anywhere |
| DataLens + NCM entries in `teamBoardConfig.json` | 2 config blocks | NDB-only (see D1 revision in `DECISIONS.md`) |
| KPIs sidebar tile (route remains; UI moves to `/admin/kpis` in Wave 2) | nav cleanup | KPI counts already on `/release/:name/brief` |

Server boot log is now ~3 lines instead of the previous ~12. No more
CrystalBallI / VooDoo / Agent-registered spam.

## Recovery

If anything in the kill list above needs to come back:

```bash
cd ~/NDB-Ops-Tools/ndb-delivery-ops
git log --oneline --all -- <path>          # find the deletion commit
git show <sha>:<path>                      # see the deleted content
git checkout <parent-sha> -- <path>        # restore if needed
```

For the legacy imports:

```bash
cd ~
tar -xzf ~/NDB-Ops-Tools/_archive/<project>.tar.gz
```

## What's still pending

See `ARCHITECTURE_TARGET.md` § "Execution order" — three short waves. The
remaining work is to migrate, not decommission. No more legacy folders to
delete.
