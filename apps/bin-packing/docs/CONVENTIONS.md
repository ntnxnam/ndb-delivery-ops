# Conventions

## Canonical CSV (Sheet1) — converter target

The bin-packing app ingests a **26-column canonical CSV** whose header is Sheet1's header [source: apps/bin-packing/data/sheet1.csv] in `CANONICAL_HEADERS` order [source: shared/src/services/productColumnAliases.ts:115]. The converter (`POST /api/bin-packing/convert` [source: apps/bin-packing/js/csv-converter-agent.js:getConvertUrl]) accepts any alias header and emits this form. Guide: `docs/product/CSV_CONVERTER_GUIDE.md`.

| # | Canonical header | Required | Notes |
|---|---|---|---|
| 1 | `Sl No` | Optional | Numeric row id; blank → `9000 + index` synthetic [source: apps/bin-packing/js/csv-parser.js:189] |
| 2 | `FEAT NUMBER` | **Required** | JIRA key; `rowsToProjects` rejects file if missing [source: apps/bin-packing/js/csv-parser.js:128] |
| 3 | `SUMMARY` | **Required** | Title; falls back to `FEAT NUMBER` if blank |
| 4 | `Priority` | Optional | `P0` default when blank |
| 5 | `STATUS` | Optional | `In Progress` detection via `/in\s*progress/i` |
| 6 | `How much of this is Completed in % (do not add %, just put a number)` | Optional | Completion % |
| 7 | `3.0 Commitment Status` | Optional | Commitment tier |
| 8 | `Target Month` | Optional | Target/Due Date |
| 9 | `Comment` | Optional | Free text |
| 10 | `DRI` | Optional | Owner/assignee |
| 11 | `Total Months Needed for 1 person by Dev (Everything from start to finish)` | Optional | Person-months; feeds duration priority 2 [source: apps/bin-packing/js/csv-parser.js:207] |
| 12 | `Dev Resources required for max parallization` | Optional | FTE; 0 → 1 when Total Months known |
| 13 | `Dev Resources required for max parallization and 60% productivity` | Optional | 60% capacity variant |
| 14 | `Num of QA required(rule: 3:1, 1 QA for 3 dev)` | Optional | QA headcount |
| 15 | `Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity` | Optional | QA 60% variant |
| 16 | `Number of Months (Dev)` | Optional | Explicit duration — priority 1 [source: apps/bin-packing/js/csv-parser.js:207] |
| 17 | `Total resources required` | Optional | Computed total |
| 18 | `sizing (refer sheet 2 for guidance)` | Optional | T-shirt: `XS=1, S=3, M=5, L=8, XL=13, XXL=21, 3L=34, 4L=55` [source: shared/src/constants/binPackingSizing.ts:13] |
| 19 | `Additional Resources` | Optional | Extra resources |
| 20 | `Sizing Comment` | Optional | Sizing notes |
| 21 | `Dependency Numbers (Comma Separated List)` | Optional | `33 (dev-blocker)` syntax; split `,`/`;` [source: apps/bin-packing/js/csv-parser.js:73] |
| 22 | `DEPENDENCY` | Optional | Dependency text |
| 23 | `One line dependency description` | Optional | Dependency description |
| 24 | `Resourcing done?` | Optional | Staffing flag |
| 25 | `Any new software needed?` | Optional | Infra flag |
| 26 | `Comments` | Optional | Extra comments |

**Alias resolution**: `canonicalHeaderFor(cell, productId)` — exact alias match first (case-insensitive, BOM/quote/trim-tolerant), then substring fallback [source: shared/src/services/productColumnAliases.ts:144]. Unknown productId → NDB default, never throws [source: shared/src/services/productColumnAliases.ts:136].

**Duration priority** (do not reorder [source: apps/bin-packing/js/csv-parser.js:207]): `Number of Months (Dev)` → `ceil(Total Months / Dev Resources)` → `SIZING_MONTHS[sizing]` [source: shared/src/constants/binPackingSizing.ts:13] → `0`.

**Dependencies**: `33 (dev-blocker)` → `devBlockers=[33]`, `6 (rel-blocker)` → `relBlockers=[6]` [source: apps/bin-packing/js/csv-parser.js:73]. Deduplicated per row.

---

Terms used in the data and the app.

| Term | Meaning |
|------|--------|
| **People allocated (per project)** | Number of people on that project. **= 1**: only one person; adding more people won't help (no parallelization within the project). **> 1**: the team has chosen to parallelize within the project (multiple people on it). |
| **Max parallelization** | More people → shorter calendar time, up to the point work can't be split. Not all projects can be fully parallelized. |
| **60% capacity** | Only 60% of a person's time is counted for this planning; the rest is other work. |
| **3 devs : 1 QA** | One QA per three developers. Reflected in the source CSV's "Total resources required". |
| **Sizing "up to"** | Each band (XS, S, M, L, XL, XXL, 3L, 4L) means the project will take **up to** that many months. |

Bar **length** = duration (months). Bar **thickness** = people allocated (1 = no parallelization, >1 = parallelization chosen).

## IAMv2-style (bucket) bars: big bar + children + separate-project exception

When the same value in **column B (FEAT)** repeats and **only row 1** of that group has numeric data (Dev Resources, Total Months, etc.) and the rest of the rows have no numbers, the app treats it as one **pool** (e.g. IAMv2):

1. **Big bar**  
   One wide bar labeled from the **name in column B** (e.g. IAMv2). Its **width** (duration) and **resource** (people) come **only from row 1** of that group.

2. **Bar width from sizing**  
   The "sizing (refer sheet 2 for guidance)" column drives the month range used for that bar:
   - **< L** (e.g. XS, S, M): use the **lower end** of the range for month calculation.
   - **L and XL**: use the **mid** of the range.
   - **> XL** (e.g. XXL, 3L, 4L): use the **higher end** of the range.

3. **Child bars below the big bar**  
   Below the big bar, show **one bar per sub-row** (rows 2, 3, ...) for items like "IAMv2 - User onboarding", "IAMv2 - Session management", "IAMv2 - Design schema", etc. They are **stacked and ordered by dependency rules** (e.g. "B before A" means B must finish before A starts), not by table order. Only the big bar uses row 1's values; child bars are placed by dependencies.

4. **Resource allocation**  
   The pool is identified by: **same column B (bucket)** + **only the first row has numbers**; the rest have no numbers. That first row's data defines how resources are allocated for the whole group (big bar + children share that pool).

5. **Separate-project exception**  
   If a row in that same bucket has **its own people accounting** (e.g. "IAMv2 - UI Workflow integration" with its own Dev Resources / numbers), it is **not** a child of the big bar. Show it as a **separate project row** (own bar in the chart), same as any other standalone project.

## Scheduling philosophy: capacity-constrained with dependency enforcement

The scheduler places projects at the **earliest month** their dependencies allow **and** headcount capacity permits. It will not allocate beyond the configured Number of FTEs at the given Capacity per FTE (%).

1. **Capacity-constrained**  
   Projects slide forward until there is enough remaining headcount in each month of their duration. This prevents over-allocation.

2. **Strict dependency sequencing**  
   A project cannot start until **all** its dependencies (dev-blocker, rel-blocker, or plain) have finished.

3. **Scheduling priority**  
   When multiple projects are ready, the scheduler picks by: (1) in-progress first, (2) priority tier, (3) projects that block the most others, (4) longest duration first, (5) row number.

4. **Duration calculation**  
   `effectiveDurationMonths = totalPersonMonths / (devResources x capacityPct)`. For example, 9 person-months with 3 people at 60% capacity = `9 / (3 x 0.6)` = 5 months.

## Display ranking: 3-tier Gantt layout

The Gantt chart groups projects into three visual tiers, separated by lightweight dividers:

| Tier | Label | What it contains | Sort within tier |
|------|-------|-----------------|-----------------|
| 0 | **In Progress** | Projects already started (have completion %). Finish these first to free capacity. | End date ascending (soonest completion first) |
| 1 | **Ready to Start** | All dependencies met, can begin immediately. | Blocker count descending (unblocks most work first), then duration descending (longest first) |
| 2 | **Waiting on Dependencies** | Start is gated by an unfinished dependency. | Start date ascending (pipeline order), then blocker count descending |

This ordering maximises throughput by:
- Reducing WIP (finish before starting new work)
- Prioritising projects that unblock the most downstream work
- Surfacing the longest jobs early (Longest Processing Time first) to avoid late-stage surprises
- Making the dependency pipeline visible so leadership can see schedule risks
