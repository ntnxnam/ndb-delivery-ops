# Fusion Map — React + Streamlit "chatbot app" → one webapp

Two predecessors fuse into this monorepo:

1. **`ndb-status-sender/`** (now `apps/delivery-ops/`) — a React + Express app
   with strong **interactive UI for release management**: a much-loved Gantt,
   the Release Versions payload table, date-mover with audit, the email
   sender, auth + permissions, multi-team context.
2. **`ndb-release-sprint-analysis-with-chatbot/`** (now in
   `_archive/`) — a Streamlit dashboard with strong **analytics + AI**:
   3-stream velocity with gate chips, landing forecast, burn trajectory,
   insights engine, NAI chatbot.

Both are good at different things. The user's directive on 2026-05-20:
*"What is there is good, but what is in the other app also is nice so find a way
to bring them together."*

This file is the fusion map. For every target surface in `ARCHITECTURE_TARGET.md`,
it lists **what the React side contributes**, **what the Streamlit side
contributes**, and **what the fused result looks like**. Surfaces aren't done
until the fused result is in place — partial ports don't count.

## Fusion principle

Never just port. Always fuse. If a React surface already does X well, **keep
it** and let the Streamlit insight enhance it. If the Streamlit version of Y
is the gold standard, **bring its algorithm verbatim** and dress it in the
React design system.

## Per-surface fusion map

### `/release/:name/brief` — Release Brief (extending today's page)

| From React | From Streamlit | Fused result |
|---|---|---|
| KPI panel (live) — already shipped | 5-bucket Engineering Payload synopsis | Both rendered side-by-side ✅ (already shipped) |
| Team KPIs grid (live) | 3-stream Sprint Velocity (current vs prior) | Both rendered ✅ (already shipped) |
| Active release detection from JIRA | Landing-forecast card (`compute_landing_forecast` — predicted GA + Green/Yellow/Red confidence + one-line explanation) | ✅ **MVP shipped 2026-05-20** — verdict chip + one-liner + recommended action + 4 KPI tiles (Forecast GA / Planned GA / Unresolved / Recent Velocity). `_classify_confidence` + `_classify_verdict` + `_gap_phrase` + `_build_one_liner` ported verbatim. **TODO(parity)**: curve-based forecast (`historical_tail_forecast`), phase-aware inflow (`project_inflow_to_ga`), per-release comparison strip, timing-curve sparkline. |
| — | Burn-trajectory mini-chart (`release_burn`) | Small inline burn-down with projected-completion-sprint overlay, slotted below the forecast card |
| Outstanding-work selector (currently in `/all-status` Release Versions table) | Outstanding-work ranked list with assignee + age | ✅ **Tile-form shipped 2026-05-20** — Outstanding & Deferred panel (5 tiles: Open / Closed in release, Deferred-by-label, Pushed-out via fixVersion-history, Blocked) sits between Engineering Payload and Sprint Velocity. JQL approved per the new `jql-edit-approval.mdc` rule. **TODO(parity)**: drilldown ranked list with assignee + age, click-row → Release Versions table deep-link. |
| — | Insights rail (subset of `insights.py`: late-arrivals after CC, descope patterns, velocity anomaly) | Right-side rail with 2–4 cards, each linking to JIRA |

### `/release/:name/payload` — Payload tab (replaces today's `/all-status`)

| From React | From Streamlit | Fused result |
|---|---|---|
| The existing Release Versions table (`ReleaseVersionTab` + cell renderers + task-breakdown column + JIRA hyperlinks) — keep as-is, this is the workhorse | 5-bucket payload synopsis at top | Synopsis row sits above the table; clicking a bucket count filters the table to those rows |
| Right-rail email composer (`ReleaseVersionEmailForm`) — Sakthi's, untouched | Per-row mini-Gantt cell pattern (`mini_gantt.py`) | Optional column showing inline mini-Gantt per epic, off by default |
| Date columns in table | Date-history popover from Streamlit `5_Release_Analysis.py` | Hover/click a date cell → popover with full history (`getDateHistory` already exists server-side) |

### `/release/:name/gantt` — Gantt tab (re-skinned, the user *loves* this)

| From React | From Streamlit | Fused result |
|---|---|---|
| **Current Gantt — kept verbatim, just re-skinned to design-system dark theme.** All interactions, swimlanes, bar shapes, hover cards stay. | Vertical gate-event markers (CC / EC / Code Complete / CG / PG / GA) on the time axis with colored chips | ✅ **Half shipped 2026-05-20** — `GateChipStrip` primitive + `GET /api/release-dataset/gates` + Brief-page strip are live. **TODO(parity)**: mount the same strip above the Gantt's time axis on `/all-status` and wire chip-click → /release-config deep-link with the gate pre-selected. The strip already supports `highlight={kind}` for one-glance verdict alignment with the forecast. |
| Bin-packing static app at `/bin-packing/` | — | Cross-link from Gantt header: "View capacity view →" opens bin-packing in a new tab |

### `/release/:name/velocity` — NEW (replaces standalone `/sprint-report`)

This is **almost entirely a Streamlit port** because React never had the depth here:

| From React | From Streamlit | Fused result |
|---|---|---|
| `SprintReportPage` chart components — strip to bar primitives only | **Everything from `pages/4_Sprint_Analysis.py`**: per-sprint table with gate chips (PRIMARY), 3-stream grouped bars + Sprint Velocity overlay line, vertical gate markers, statistics panel (mean / median / std using robust estimators from `team_velocity_profile.py`), per-release totals (DEMOTED) | Full Streamlit experience inside the React app, dressed in design-system primitives. **All 6 "must survive verbatim" algorithms from this doc preserved.** |
| Team-aware sprint board ID lookup (`useTeams` hook) | Sprint calendar from `milestone_config` | Server still resolves sprint boundaries via `productService`; gate dates fetched from existing JIRA endpoints |

### `/release/:name/gates` — Gates tab (folds in ReleaseConfigPage)

| From React | From Streamlit | Fused result |
|---|---|---|
| **`ReleaseConfigPage` — kept whole.** Date-mover form, gate calendar, full audit trail, the `dateMoverService` Path-B wiring. | Phase-chip styling for visual consistency with /velocity | The existing form gets a top strip showing the same gate chips used on /velocity and /gantt so users see one consistent visual grammar across all three tabs |

### `/release/:name/insights` — NEW tab

Pure Streamlit win — React had nothing here:

| From React | From Streamlit | Fused result |
|---|---|---|
| — | `insights.py` catalog (2,754 LOC of patterns: stuck tickets, late arrivals, descope patterns, owner-anomaly, velocity-spike-or-dip, missing-fields) | One insight card per pattern, each with: (a) the natural-language finding, (b) the JIRA-linked evidence, (c) the recommended action |
| Risk badges on payload table | Risk-classifier output (`analyzeProjectRisk`) | Same risk classification feeds both the badges and the insights — single algorithm, two surfaces |

### `/team-exec` — Team Executive surface (Wave 2)

| From React | From Streamlit | Fused result |
|---|---|---|
| Existing `Layout` + permission gates | **NAI chatbot pane** (`3_Chatbot.py` + `chatbot_router.py`) — talks to the loaded dataset in natural language | Chat pane on left side of the page, replaces the deleted CrystalBallIChat |
| Existing `generateExecutiveSummary` util (the React one we kept) | Streamlit auto-summary generator | Pick the stronger of the two algorithms after a side-by-side comparison; the loser gets deleted |
| Skills already present (`team-exec-release-report`, `predictive-team-exec-analytics`) | Landing-forecast roll-up across all in-flight releases | Top of the page: forecast cards for every Major/Minor ≥ 2.8 release, sourced from same `compute_landing_forecast` as Brief |

### Header / app-wide

| From React | From Streamlit | Fused result |
|---|---|---|
| Existing TopBar with team selector | **Sync Hub widget**: freshness indicator + live sync banner + manual refresh button | Pinned to the TopBar so every page shows "data as of: 2h ago" and offers a refresh |

### `/admin` — Admin (Wave 2)

| From React | From Streamlit | Fused result |
|---|---|---|
| Existing `AdminPanel` (team list, onboarding wizard, KPI defs) | Team profiles page (`6_Team_Profiles.py`): per-team velocity profile cards, capacity vs. demand widget | Each team row in the team list expands to show its velocity profile + capacity card |

### `/email/*` — Email surface

No fusion needed; Streamlit had nothing here. React's existing `EmailSender/` + `GenericEmailer` + `EmailHistoryTab` stay as the source of truth, eventually moved under one `/email/{compose,history}` route family.

## Algorithms that must survive verbatim (from Streamlit)

These are non-obvious heuristics earned through observation. Reimplementing
them poorly is worse than not having them. When porting, copy the Python
verbatim into TypeScript — don't paraphrase:

1. **3-stream velocity definition** with 0.33 QA-Verification adjusted count (not story points). Already in `sprint-velocity-types.mdc` and ported to `shared/services/velocityService.ts`. ✅
2. **Sprint shape classifier** — `classify_shape()` in `team_velocity_profile.py`. Buckets a sprint series into rising / falling / plateau / spike / chaotic via peak-to-mean ratio + local-maxima count.
3. **Landing forecast confidence** — `_classify_confidence(elapsed, velocity_cv)`. Green only when elapsed ≥ 4 sprints AND velocity CV ≤ 0.35.
4. **Landing forecast verdict** — `_classify_verdict(burn_status, gap_sprints)`. Two-signal composition.
5. **First-activity sprint detection** — `first_activity_sprint()`. Burn baselines start where ≥ 5 tickets first move, not at S1.
6. **Baseline pre-BC median velocity** — `_baseline_pre_bc_median()`. Excludes the last 2 sprints before BC to avoid end-of-release crunch contamination.

## What we deliberately drop from each side

| From | Dropped | Reason |
|---|---|---|
| React | `CrystalBallIChat` + the `crystalball-i` npm package | Replaced by the Streamlit chatbot (more developed, real NAI pipeline) |
| React | `CrystalBallInsights`, `ReleaseDatePrediction`, `ReleaseRiskForecast`, `ExecutiveSummaryEditor` (AI components, commented out) | Aspirational, never wired to real data. Streamlit covers all four use cases. |
| React | `ReleaseTrendsPage` | The trends + chat shell are subsumed by `/release/:name/brief` + `/team-exec` |
| Streamlit | The `cache/` JSON layer | Replaced by Node-side `releaseDatasetService` per-release + bundle cache (better atomicity, integrated with sync orchestration). ✅ already done |
| Streamlit | `auth.py` basic-auth | Already covered by React AuthContext + JIRA-token validation |

## Process — for the next person (or me) building any surface

1. **Re-extract the Streamlit source**:
   ```bash
   tar -xzf ~/NDB-Ops-Tools/_archive/ndb-release-sprint-analysis-with-chatbot.tar.gz -C /tmp/
   # Source at /tmp/ndb-release-sprint-analysis-with-chatbot/ndb-release-sprint-analysis/
   ```
2. **Read this file's row for the surface you're building.** Don't skip — you'll miss algorithm subtleties.
3. **Read the matching Python files side-by-side with your React rebuild.** Copy algorithms verbatim, don't paraphrase.
4. **Tick the relevant items in this file when they ship.** Commit the doc change with the feature so it's traceable.
5. **If you intentionally drop a feature, add a row to "What we deliberately drop" with a one-line reason.** Don't silently lose anything.

## Order of fusion (recommendation)

Highest value first:

1. ~~**`/release/:name/brief` Landing-Forecast card**~~ ✅ **MVP shipped 2026-05-20**. Curve / inflow / comparison-strip / sparkline still pending — tracked under the `/release/:name/brief` row above.
2. ~~**Gate-chip primitive + Release Brief gate strip**~~ ✅ **shipped 2026-05-20**. New `shared/gateTimelineService` parses the RM-curated `releaseGateDates` config into a normalised, chronologically sorted `GateEvent[]` (EC + CC + CG + PG + GA, with `dotted`=planned and `solid`=current). New design-system `GateChipStrip` renders the chips with strike-through for planned/superseded and reduced opacity for past. New server route `GET /api/release-dataset/gates`. The Release Brief now also derives `plannedGaIso` from the gate timeline (preferred over the brittle KPI-key regex), so the Landing Forecast verdict engages even when no `ga_date` KPI is configured. **TODO(parity / wave 2)**: slot the same `GateChipStrip` above the `ReleaseVersionGantt` time axis on `/all-status` (the user-loved Gantt) — design-system primitive is in place, the surgery is on the legacy 1.4k-LOC Gantt file.
3. **`/release/:name/velocity` full rebuild** — the "nice sprint reports" the user called out twice; complete rewrite based on `pages/4_Sprint_Analysis.py`. **← next.**
4. **Sync Hub header widget** — app-wide quality-of-life improvement.
5. **`/release/:name/insights` tab** — new surface from `insights.py`.
6. **`/team-exec` with chatbot** — Wave 2.
7. **`/admin/teams` profile expansion** — Wave 2.
8. **Date-history popover on payload table** — small enhancement.

Each item above corresponds to a row in the per-surface map. Pick one, do it
end-to-end (server route + shared service + client service + React component +
parity-checklist tick), don't context-switch until that row is green.
