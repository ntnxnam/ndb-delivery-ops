---
name: csv-to-binpacking-examples
description: Worked examples and anti-patterns for the csv-to-binpacking skill.
audience: portfolio_mgr
---

# CSV → Bin-Packing — Examples

> **Context:** Bin-packing is the **static vanilla-JS capacity planner** (`apps/bin-packing/` at `/bin-packing/*`); Lighthouse is the **product MCP server** (`mcp/lighthouse/`, bin `lighthouse-mcp`) [source: `ARCHITECTURE.md`, `mcp/shared/tools/convertToBinPackingCsv.ts:1-12`]. This skill is loadable via `loadAgentPack('lighthouse')` with harness symlinks auto-generating `.cursor/skills` etc. [source: `agent-pack/harness/cursor.json`]. Deterministic impl is `shared/src/services/csvConverterService.ts` + `shared/src/constants/binPackingSizing.ts` [source: `shared/src/services/csvConverterService.ts:1-16`].

## Example 1 — Alias Happy Path (JIRA export → canonical CSV)

**Scenario:** User drags a JIRA CSV export where the headers are JIRA-native aliases, not Sheet1 names. Product is `ndb`.

**Input file** (`{filePath}` contains, productId=`ndb`):

```csv
Issue Key,Summary,Priority,Status,Assignee,Dev Resources,Duration (months),Dependencies,Sizing
FEAT-101,Storage write path,P0,In Progress,jane.doe,3,5,"","M (3-5 months)"
ERA-55,Rebuild QP cache,P1,Not Started,bob,2,6,"","L (5-8 months)"
```

**Alias resolution** via `getColumnAliases('ndb')` / `canonicalHeaderFor` [source: `shared/src/services/productColumnAliases.ts:22-101`]:

| Raw header | Canonical | Alias entry |
|---|---|---|
| `Issue Key` | `FEAT NUMBER` | `NDB_COLUMN_ALIASES['FEAT NUMBER']: ['Issue Key','Key',…]` [source: `shared/src/services/productColumnAliases.ts:24`] |
| `Summary` | `SUMMARY` | `['Summary','Title',…]` [source: `shared/src/services/productColumnAliases.ts:25`] |
| `Assignee` | `DRI` | `['DRI','Owner','Assignee',…]` [source: `shared/src/services/productColumnAliases.ts:45`] |
| `Dev Resources` | `Dev Resources required for max parallization` | alias [source: `shared/src/services/productColumnAliases.ts:55-58`] |
| `Duration (months)` | `Number of Months (Dev)` | alias [source: `shared/src/services/productColumnAliases.ts:69-74`] |
| `Dependencies` | `Dependency Numbers (Comma Separated List)` | alias [source: `shared/src/services/productColumnAliases.ts:91-97`] |
| `Sizing` | `sizing (refer sheet 2 for guidance)` | alias [source: `shared/src/services/productColumnAliases.ts:82-88`] |

**5-step flow** [source: `agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md` Step 1-5]:

1. `extractRawRows({filePath})` → `rows = parseCSV(text)` → 3 rows (1 header + 2 data) [source: `shared/src/services/csvConverterService.ts:572-577`].
2. `buildHeaderIndex(headerRow,'ndb')` maps 9 of 9 raw headers; `stats.mappedCols=9 / unmappedCols=0` [source: `shared/src/services/productColumnAliases.ts:173-183`, `mcp/shared/tools/convertToBinPackingCsv.ts:236-242`].
3. `validateViaRowsToProjects(rows)` → 2 projects, no error (both have FEAT NUMBER+SUMMARY) [source: `shared/src/services/csvConverterService.ts:607-613`, `apps/bin-packing/js/csv-parser.js:128-130`].
4. No repair needed.
5. `convertToCanonicalCsv(rows)` emits 26-col header (`CANONICAL_HEADERS`) + 2 data rows, unmapped canonicals empty; `generateReport` warns about missing useful optionals (`Target Month`, etc.) [source: `shared/src/services/csvConverterService.ts:634-688`].

**Output** (`csvText` head, warnings, validation):

```csv
Sl No,FEAT NUMBER,SUMMARY,Priority,STATUS,"How much of this is Completed in % (do not add %, just put a number)",3.0 Commitment Status,Target Month,Comment,DRI,"Total Months Needed for 1 person by Dev (Everything from start to finish)",Dev Resources required for max parallization,"Dev Resources required for max parallization and 60% productivity","Num of QA required(rule: 3:1, 1 QA for 3 dev)","Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity",Number of Months (Dev),Total resources required,sizing (refer sheet 2 for guidance),Additional Resources,Sizing Comment,Dependency Numbers (Comma Separated List),DEPENDENCY,One line dependency description,Resourcing done?,Any new software needed?,Comments
,FEAT-101,Storage write path,P0,In Progress,10,,,"",jane.doe,,3,,0,,5,,M (3-5 months),,,,,
,ERA-55,Rebuild QP cache,P1,Not Started,,,,,bob,,2,,0,,6,,L (5-8 months),,,,,
```

```json
{ "csvText": "<above>", "warnings": ["Optional column missing: \"Target Month\" — related features will use defaults.", "…"], "stats": { "rows":2,"cols":9,"mappedCols":9,"unmappedCols":0 }, "validation": { "projectsParsed":2,"errors":[],"warnings":["Optional column missing: \"…\""] } }
```

**Why it works:** Product-agnostic alias map resolved JIRA-native headers without hardcoding `NDB` strings outside config [source: `agent-pack/lighthouse/rules/product-agnostic.mdc`].

---

## Example 2 — XLSX with Blockers + `9000+` Fallback (JIRA export pasted as XLSX)

**Scenario:** User uploads an XLSX exported from JIRA with blocker-annotated dependencies and no `Sl No` column (blank first column). Product `ndb`.

**Input file** (`report.xlsx`, productId=`ndb`):

| Row | FEAT NUMBER | SUMMARY | Dev Resources required for max parallization | Dependency Numbers (Comma Separated List) | sizing (refer sheet 2 for guidance) |
|---|---|---|---|---|---|
| 1 *(header)* | FEAT NUMBER | SUMMARY | Dev Resources required for max parallization | Dependency Numbers (Comma Separated List) | sizing (refer sheet 2 for guidance) |
| 2 | FEAT-200 | API layer | 2 | *(blank)* | M (3-5 months) |
| 3 | FEAT-201 | UI shell | 2 | `3 (dev-blocker)` | M (3-5 months) |
| 4 | ERA-300 | Docs + perf notes | 1 | `3 (rel-blocker), 4` | L (5-8 months) |

Note: The upload has **no `Sl No` column at all** — `iFirstCol` falls back to `0` (which holds `FEAT NUMBER`) [source: `apps/bin-packing/js/csv-parser.js:124-125`, `shared/src/services/csvConverterService.ts:341-343`]; row numbers are then assigned via fallback.

**5-step flow:**

1. `detectFileType({filePath})` → `xlsx` via extension/magic `PK` [source: `shared/src/services/csvConverterService.ts:542-556`]. Extraction is via isolated extractor (`python -I` or SheetJS from a different dir, path passed as arg) → `rows: string[][]` with same header + 3 data rows [source: `shared/src/services/csvConverterService.ts:584-592`, env `isolated_python`].
2. Alias map `buildHeaderIndex(headerRow,'ndb')` — all 5 present headers map; `stats.mappedCols=5` [source: `shared/src/services/productColumnAliases.ts:173-183`].
3. `validateViaRowsToProjects(rows)`:
   - **Dependency parse:** Row 3 raw `"3 (dev-blocker)"` → `parseDependencyNumbersAndBlockers` splits on `[,;]`, `/\d+/` extracts `3`, regex `/\d+\s*\(\s*dev-blocker\s*\)/i` tags it `devBlockers:[3]` [source: `apps/bin-packing/js/csv-parser.js:73-94`, `shared/src/services/csvConverterService.ts:168-191`, `apps/bin-packing/js/csv-parser.js:85`]. Row 4 `"3 (rel-blocker), 4"` → `rowNumbers:[3,4], relBlockers:[3]` [source: `apps/bin-packing/js/csv-parser.js:86`].
   - **RowNumber fallback:** `rowNumRaw = row[iFirstCol] || ''` holds `FEAT NUMBER` values (`FEAT-200`), `parseInt('FEAT-200',10)` → `NaN` → fallback `assignedRowNumber = 9000 + projects.length` [source: `apps/bin-packing/js/csv-parser.js:188-193`, `shared/src/services/csvConverterService.ts:431-440`] — yields `9000`, `9001`, `9002` for the three data rows respectively (not `9000+rowIdx`; index is among already-emitted projects [source: `apps/bin-packing/js/csv-parser.js:193`]).
   - Produces 3 projects with ids `row-9000`…`row-9002`.
4. No repair needed (mandatory cols present).
5. `convertToCanonicalCsv` emits 26-col CSV; `stats.rows=3, cols=5, mappedCols=5`.

**Output `validation` excerpt:**

```json
{
  "projectsParsed": 3,
  "errors": [],
  "warnings": ["Optional column missing: \"Sl No\" — related features will use defaults. (RowNumber fallback applied: 9000+index) [source: apps/bin-packing/js/csv-parser.js:192-193]"]
}
```

**Dependency fields in parsed projects** (from `validation`/`projects` internals):

```json
[
  { "rowNumber": 9000, "feat":"FEAT-200", "dependencyRowNumbers":[], "dependencyDevBlockers":[], "dependencyRelBlockers":[] },
  { "rowNumber": 9001, "feat":"FEAT-201", "dependencyRowNumbers":[3], "dependencyDevBlockers":[3], "dependencyRelBlockers":[] },
  { "rowNumber": 9002, "feat":"ERA-300",  "dependencyRowNumbers":[3,4], "dependencyDevBlockers":[], "dependencyRelBlockers":[3] }
]
```

Note: Dependency row numbers refer to `Sl No` (or its fallback); consumer `dependency-walk` resolves them via `dependencyService` with citation per edge [source: `agent-pack/lighthouse/skills/dependency-walk/SKILL.md#core-rules`]. Cross-reference owner is `dependency-tracker-specialist` [source: `agent-pack/lighthouse/identity/specialists/dependency-tracker-specialist.md`].

---

## Example 3 — Missing Mandatory Column (with Remediation)

**Scenario:** User pastes a TSV from Confluence that has a `Title` column but the header row spells the feature key as `Ticket` (not in alias map as typed — capitalisation is fine but the actual cell holds `JIRA-1` with no alias for bare `Ticket` in this variant? Actually `Ticket Key` is an alias — so to trigger the error we use a truly unmatched header `TicketID`).

**Input file** (pasted TSV → normalised to CSV rows, productId=`ndb`):

```csv
TicketID,Title,Priority
JIRA-1,Do the thing,P0
JIRA-2,Do the other thing,P1
```

**5-step flow:**

1. `extractRawRows` → `rows` with header `["TicketID","Title","Priority"]` [source: `shared/src/services/csvConverterService.ts:558-596`].
2. `buildHeaderIndex(["TicketID","Title","Priority"],'ndb')`: `Title`→`SUMMARY`, `Priority`→`Priority`, but `TicketID` matches **no** canonical via `canonicalHeaderFor` (exact alias miss + substring miss: needle `ticketid` does not contain canonical `feat number` etc., alias `ticket key` requires space) [source: `shared/src/services/productColumnAliases.ts:144-167`] → `mappedCols=2 / unmappedCols=1`; `generateReport` will emit `Unrecognized headers: TicketID` [source: `shared/src/services/csvConverterService.ts:686-687`].
3. `validateViaRowsToProjects(rows)` → `error: 'Sheet must include "FEAT NUMBER" and "SUMMARY" columns. Check the header row.'` because `iFeat <0` [source: `apps/bin-packing/js/csv-parser.js:128-130`, `shared/src/services/csvConverterService.ts:347-354`]; `projects=[]`.
4. **Repair once:** Normalise headers via `normalizeHeaderCell` (BOM/quote/trim) and re-attempt alias substring mapping — still no match [source: `shared/src/services/csvConverterService.ts:193-198`]. Repair reports still erroring (single-repair loop, no second retry) [source: `agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md#step-4-repair-once-if-validation-error-then-re-validate-single-repair-loop`].
5. `generateReport` + `validation` surface actionable remediation [source: `shared/src/services/csvConverterService.ts:661-701`]:

**Output (error case):**

```json
{
  "csvText": "",
  "warnings": ["Mandatory column missing: \"FEAT NUMBER\"","Mandatory column missing: \"SUMMARY\" (matched Title→SUMMARY but TicketID unmapped)","Unrecognized headers (passed through as-is): TicketID"],
  "stats": { "rows":2,"cols":3,"mappedCols":2,"unmappedCols":1 },
  "validation": {
    "projectsParsed": 0,
    "errors": ["Sheet must include \"FEAT NUMBER\" and \"SUMMARY\" columns. Check the header row. [source: apps/bin-packing/js/csv-parser.js:128-130]"],
    "warnings": ["Unrecognized headers (passed through as-is): TicketID","Mandatory column missing: \"FEAT NUMBER\"","Optional column missing: \"Dev Resources required for max parallization\" — related features will use defaults."]
  }
}
```

**Remediation offered to user:**

> **Fix:** Rename `TicketID` → `FEAT NUMBER` (or `Issue Key` / `Key` / `Feature Key` per alias map [source: `shared/src/services/productColumnAliases.ts:24`]) and retry. If your export cannot be edited, pass `originalHeaders: ["FEAT NUMBER","SUMMARY","Priority"]` override to `convert_to_bin_packing_csv` [source: `mcp/shared/tools/convertToBinPackingCsv.ts:115-117`] or supply `productId` that has an alias for `TicketID` via `PRODUCT_COLUMN_ALIASES[productId]` [source: `shared/src/services/productColumnAliases.ts:107-112`].

**Lesson:** Citation `csv-parser.js:128` contract is non-negotiable — 2 mandatory cols must resolve [source: `apps/bin-packing/js/csv-parser.js:128`].

---

## Example 4 — Duration Priority (4 Levels)

**Scenario:** Portfolio Manager uploads a sheet where duration signals overlap. Must show the 4-level ladder wins [source: `apps/bin-packing/js/csv-parser.js:207-228`] to avoid mispacking.

**Input file** (productId=`ndb`):

```csv
FEAT NUMBER,SUMMARY,Total Months Needed for 1 person by Dev (Everything from start to finish),Dev Resources required for max parallization,Number of Months (Dev),sizing (refer sheet 2 for guidance)
FEAT-10,Explicit wins,12,3,5,L (5-8 months)
FEAT-11,Derived wins,12,3,,M (3-5 months)
FEAT-12,Zero-dev fixup,12,0,,S (1-3 months)
FEAT-13,Sizing only,,,,XL (8-13 months)
FEAT-14,Empty fallback,,,,None
```

**Alias mapping:** All 6 headers are canonical [source: `shared/src/services/productColumnAliases.ts:114-115`].

**Duration ladder application** [source: `apps/bin-packing/js/csv-parser.js:207-228`, `shared/src/services/csvConverterService.ts:459-471`]:

| Row | Signals present | Ladder pick | Calculation | `durationMonths` |
|---|---|---|---|---|
| FEAT-10 | `Number of Months (Dev)=5` (+ total 12/3, sizing L) | **Lv1:** explicit `Number of Months (Dev)` | direct `5` | **5** [source: `apps/bin-packing/js/csv-parser.js:216-217`] |
| FEAT-11 | Total=12, Dev=3, sizing M, no explicit | **Lv2:** `ceil(Total/Dev)` | `ceil(12/3)=4` | **4** [source: `apps/bin-packing/js/csv-parser.js:218-219`] |
| FEAT-12 | Total=12, Dev=0 (blank→0), sizing S — sheet had `#DIV/0!` style error for Lv2 | **Lv2b:** `ceil(Total)` + `devResources=1` fixup | `ceil(12)=12`, `devResources` corrected to `1` | **12** (and `totalResources:1`) [source: `apps/bin-packing/js/csv-parser.js:220-223`] |
| FEAT-13 | Only `sizing=XL (8-13 months)` | **Lv3:** sizing ceiling | `SIZING_MONTHS['XL (8-13 months)']=13` | **13** [source: `shared/src/constants/binPackingSizing.ts:19`, `apps/bin-packing/js/sizing.js:14`] |
| FEAT-14 | `sizing=None` (→0, unknown) | **Lv4:** default | `0` (packer renders 1-month greyed bar downstream) | **0** [source: `apps/bin-packing/js/csv-parser.js:226-228`] |

**Validation flow:**

1. `extractRawRows` → 6 rows [source: `shared/src/services/csvConverterService.ts:572-577`].
2. `buildHeaderIndex` → `mappedCols=6` [source: `shared/src/services/productColumnAliases.ts:173-183`].
3. `validateViaRowsToProjects` computes durations per ladder, sizes via `sizingToMonths(sizingRaw)` clamped `>0` check [source: `shared/src/services/csvConverterService.ts:416`, `shared/src/constants/binPackingSizing.ts:32-38`].
4. No repair.
5. `convertToCanonicalCsv` emits canonical CSV; `projects` carry `durationMonths` above plus `totalResources`/`sizingLabel` for downstream `apps/bin-packing/js/sizing.js:monthsFromSizingBand` bar-width rendering [source: `apps/bin-packing/js/sizing.js:42-52`].

**Output `validation` excerpt:**

```json
{
  "projectsParsed": 5,
  "errors": [],
  "warnings": ["Optional column missing: \"Dependency Numbers (Comma Separated List)\" — related features will use defaults."]
}
```

---

## Anti-Patterns

| Anti-pattern | What goes wrong | Do this instead |
|---|---|---|
| **Hardcode `NDB` column names** in conversion logic (`if (h==="FEAT NUMBER")` outside config) | Breaks other products (DataLens etc.) — violates D1 [source: `agent-pack/lighthouse/rules/product-agnostic.mdc`] | Read aliases from `getColumnAliases({productId})` / `PRODUCT_COLUMN_ALIASES[{productId}]` [source: `shared/src/services/productColumnAliases.ts:133-137`] |
| **Reimplement `parseCSV` / `SIZING_MONTHS` inline** | Diverges from `apps/bin-packing/js/csv-parser.js` + `sizing.js` → duration/packing mismatches [source: `shared/src/constants/binPackingSizing.ts:1-11`] | Call `CsvConverterService.extractRawRows` / `sizingToMonths` / `SIZING_MONTHS` [source: `shared/src/services/csvConverterService.ts:558-596`, `shared/src/constants/binPackingSizing.ts:32-38`] |
| **Execute `python` from inside the upload dir** (e.g. `cd $UPLOAD && python extract.py`) | Planted `json.py` / `csv.py` in upload executes on `import json` — code execution | Extract from a **different directory**; run `python -I` with absolute `{filePath}` arg in isolated `mkdtemp` per file [source: env `isolated_python` / `no_execution_from_upload_dir`, `mcp/shared/tools/convertToBinPackingCsv.ts:29-42`] |
| **Conflate bin-packing and Lighthouse** ("Lighthouse bin-packing tool") | Repo will be renamed `portfolio-delivery-ops`; bin-packing is the capacity planner at `/bin-packing/*`, Lighthouse is the product MCP server — different apps, different owners [source: `ARCHITECTURE.md`, `DECISIONS.md` D44/D45] | Say "bin-packing capacity planner (`apps/bin-packing/`) via Lighthouse-hosted skill `csv-to-binpacking` (`loadAgentPack('lighthouse')`)" [source: `agent-pack/harness/cursor.json`] |
| **Ignore `9000+index` fallback** and assume `Sl No` always present | Rows without Sl No become invisible or mis-linked dependencies [source: `apps/bin-packing/js/csv-parser.js:192-193`] | Respect `9000 + projects.length` fallback and note it in warnings when triggered [source: `shared/src/services/csvConverterService.ts:440`] |
| **Drop the blocker regex** and treat `"33 (dev-blocker)"` as plain `33` | Loses `dev-blocker` vs `rel-blocker` semantics needed by `dependency-walk` / risk register [source: `apps/bin-packing/js/csv-parser.js:73-86`] | Use `parseDependencyNumbersAndBlockers` with `/\d+\s*\(\s*dev-blocker\s*\)/i` and `rel-blocker` variant [source: `apps/bin-packing/js/csv-parser.js:85-86`] |
| **Loop repair indefinitely** on validation error | Masks structural errors, produces silent bad CSVs | Repair **once** then re-validate; surface remaining errors [source: `agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md#step-4-repair-once-if-validation-error-then-re-validate-single-repair-loop`] |
| **Hardcode sizing ceilings** (`if (label==="M") months=5`) outside `binPackingSizing.ts` | Creates second source of truth — violates `no-defensive-statements.mdc` adjacency and sizing SoT [source: `shared/src/constants/binPackingSizing.ts:1-11`] | Import `SIZING_MONTHS` / `sizingToMonths` [source: `shared/src/constants/binPackingSizing.ts:13-38`] |

## Cross-References

- Skill: `agent-pack/lighthouse/skills/csv-to-binpacking/SKILL.md`
- Prompt: `agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md`
- Impl: `shared/src/services/csvConverterService.ts` — `CsvConverterService` (orchestration, not logic dupe)
- Sizing SoT: `shared/src/constants/binPackingSizing.ts` (port of `apps/bin-packing/js/sizing.js`)
- Alias map (D1): `shared/src/services/productColumnAliases.ts` (`NDB_COLUMN_ALIASES`, `PRODUCT_COLUMN_ALIASES`, `CANONICAL_HEADERS`, `MANDATORY_CANONICALS`)
- MCP wrapper (read-only, D26 HITL): `mcp/shared/tools/convertToBinPackingCsv.ts` → `convert_to_bin_packing_csv`
- Source logic: `apps/bin-packing/js/csv-parser.js:73` (blocker regex), `:128` (mandatory cols), `:192` (9000+ fallback), `:207` (duration ladder)
- Owner: `agent-pack/lighthouse/identity/specialists/dependency-tracker-specialist.md`
- Orchestrator: `agent-pack/lighthouse/identity/ops-assistant.md` via `loadAgentPack('lighthouse')`
- Harness: `agent-pack/harness/` (auto-generates host symlinks)
