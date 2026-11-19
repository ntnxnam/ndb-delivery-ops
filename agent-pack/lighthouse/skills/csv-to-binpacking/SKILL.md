---
name: csv-to-binpacking
description: Convert any user-supplied file (PDF / XLSX / DOCX / JIRA export / pasted TSV) into the canonical bin-packing Sheet1 CSV so apps/bin-packing can render it. Product-agnostic alias resolution, sizing ceiling, dependency syntax, duration priority, and RowNumber fallback per shared services.
version: 1.0.0
owner: dependency-tracker-specialist
audience: portfolio_mgr
---

# CSV → Bin-Packing Skill — Canonical Sheet1 Converter (D1, D44)

> **Bin-packing ≠ Lighthouse.** Bin-packing is the **static vanilla-JS capacity planner** served at `/bin-packing/*` (`apps/bin-packing/`) with its own deterministic `js/csv-parser.js` + `js/sizing.js` pipeline [source: `apps/bin-packing/js/csv-parser.js:1-10`, `apps/bin-packing/js/sizing.js:1-8`].
> Lighthouse is the **product MCP server** (`mcp/lighthouse/`, bin `lighthouse-mcp`, 2 product-only + 8 shared tools) [source: `mcp/lighthouse/src/index.ts`, `DECISIONS.md` D44/D45].
> This skill is **prompt/orchestration only** for bin-packing; it is **loadable via `loadAgentPack('lighthouse')`** per D44 tenancy and auto-discoverable via `agent-pack/harness/` symlinks (`.cursor/skills`, `.claude/skills`, `.codex/skills`, `.agents/skills`) [source: `agent-pack/harness/cursor.json`, `agent-pack/harness/install.sh`]. Implementation stays in `shared/src/services/csvConverterService.ts` and `shared/src/constants/binPackingSizing.ts` — no code duplication in the skill [source: `shared/src/services/csvConverterService.ts:1-16`, `shared/src/constants/binPackingSizing.ts:1-11`].

## When to Invoke

Trigger this skill whenever the user wants **any file prepared for bin-packing** — the Portfolio Manager is the primary consumer (paste, upload, or export → canonical Sheet1 CSV):

| User intent (examples) | Input shape | Why this skill |
|---|---|---|
| "Convert this JIRA export for bin-packing" | CSV / XLSX from JIRA filter export | Headers use JIRA names (`Issue Key`, `Summary`) → alias map resolves to `FEAT NUMBER` / `SUMMARY` [source: `shared/src/services/productColumnAliases.ts:22-25`] |
| "I pasted a table / TSV from Confluence" | Pasted TSV / CSV / HTML-table copy | Delimiter-flexible parse → canonical reorder [source: `shared/src/services/csvConverterService.ts:115-164`] |
| "Turn this PDF / DOCX into bin-packing CSV" | PDF / DOCX upload | Extract text/tables via isolated extractor → same alias + validation loop |
| "My XLSX has blockers and missing Sl No" | XLSX with `Dependency Numbers` + blank `Sl No` | XLSX extractor + blocker regex + `9000+index` fallback [source: `apps/bin-packing/js/csv-parser.js:73`, `apps/bin-packing/js/csv-parser.js:192-193`] |
| "Import last quarter's sheet" | Any prior Sheet1 variant / dated snapshot | Synonym-tolerant header normalisation (`Sl. No` / `Row Number` → `Sl No`) [source: `shared/src/services/productColumnAliases.ts:22-23`] |

**Do not invoke** for: pure JIRA queries that stay in JIRA (use `dependency-walk` instead [source: `agent-pack/lighthouse/skills/dependency-walk/SKILL.md`]), or for editing an already-canonical Sheet1 CSV in place (direct file edit, no conversion).

## Canonical Header Contract

### Source of truth

- **Canonical header order** is `CANONICAL_HEADERS` — 26 columns in Sheet1 order [source: `shared/src/services/productColumnAliases.ts:114-115`, `apps/bin-packing/data/sheet1.csv:1`] exported by `productColumnAliases.ts` [source: `shared/src/services/productColumnAliases.ts:114`].
- **Mandatory subset** is `MANDATORY_CANONICALS = ['FEAT NUMBER', 'SUMMARY']` [source: `shared/src/services/productColumnAliases.ts:118`, `apps/bin-packing/js/csv-parser.js:128-130`].
- Runtime enforcement is `csv-parser.js:128` (`if (iFeat < 0 || iSummary < 0) return error`) [source: `apps/bin-packing/js/csv-parser.js:128-130`] mirrored by `CsvConverterService.validateViaRowsToProjects` → `rowsToProjectsCore:347-354` [source: `shared/src/services/csvConverterService.ts:347-354`].

### Mandatory vs optional

| Cardinality | Canonical header(s) | Semantics |
|---|---|---|
| **2 mandatory** | `FEAT NUMBER`, `SUMMARY` | Every data row must supply at least one of these; missing both → `skipped` + `invalidRows` with `Missing FEAT NUMBER and SUMMARY` [source: `apps/bin-packing/js/csv-parser.js:128-130`, `shared/src/services/csvConverterService.ts:408-411`]. `SUMMARY` normalises whitespace (`replace(/\s+/g,' ')`) and truncates to 120 chars (`summary.slice(0,120)`) [source: `apps/bin-packing/js/csv-parser.js:183`, `shared/src/services/csvConverterService.ts:483`] |
| **24 optional** (spec shorthand: "21 core scheduling optional") | Remaining 24 of `CANONICAL_HEADERS` (26 total) — `Sl No`, `Priority`, `STATUS`, `How much of this is Completed in % …`, `3.0 Commitment Status`, `Target Month`, `Comment`, `DRI`, `Total Months Needed for 1 person by Dev (…)`, `Dev Resources required for max parallization`, `Dev Resources required for max parallization and 60% productivity`, `Num of QA required(rule: 3:1, 1 QA for 3 dev)`, `Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity`, `Number of Months (Dev)`, `Total resources required`, `sizing (refer sheet 2 for guidance)`, `Additional Resources`, `Sizing Comment`, `Dependency Numbers (Comma Separated List)`, `DEPENDENCY`, `One line dependency description`, `Resourcing done?`, `Any new software needed?`, `Comments` | Absent columns are emitted as empty in `convertToCanonicalCsv` and handled with defaults in `rowsToProjects` (e.g. `Priority || 'P0'`, `devResources` defaults to `0`) [source: `shared/src/services/csvConverterService.ts:634-647`, `shared/src/services/csvConverterService.ts:418-419`, `apps/bin-packing/js/csv-parser.js:173-185`]. Helpful-but-missing optional warnings are emitted via `generateReport` for `Dev Resources`, `sizing`, `Dependencies` [source: `shared/src/services/csvConverterService.ts:676-682`] |

**Full 26-column table** (canonical order, alias examples, mandatory flag):

| # | Canonical header | Example aliases (non-exhaustive) | Mandatory |
|---|---|---|---|
| 1 | `Sl No` | `Sl. No`, `Row Number`, `S.No`, `#` | No |
| 2 | `FEAT NUMBER` | `Issue Key`, `Key`, `FEAT`, `Feature Key` | **Yes** |
| 3 | `SUMMARY` | `Summary`, `Title`, `Description`, `Name` | **Yes** |
| 4 | `Priority` | `Prio`, `PRI` | No |
| 5 | `STATUS` | `Status`, `State` | No |
| 6 | `How much of this is Completed in % (do not add %, just put a number)` | `Progress`, `Completed %`, `% Complete` | No |
| 7 | `3.0 Commitment Status` | `Commitment Status`, `Commitment` | No |
| 8 | `Target Month` | `Due Date`, `Target`, `Target Date` | No |
| 9 | `Comment` | `Comments`, `Notes`, `Remarks` | No |
| 10 | `DRI` | `Owner`, `Assignee`, `Lead` | No |
| 11 | `Total Months Needed for 1 person by Dev (Everything from start to finish)` | `Total Person Months`, `Person Months`, `Effort (person-months)` | No |
| 12 | `Dev Resources required for max parallization` | `Dev Resources`, `Resources`, `Dev Team Size` | No |
| 13 | `Dev Resources required for max parallization and 60% productivity` | `Dev Resources (60%)`, `Resources (60%)` | No |
| 14 | `Num of QA required(rule: 3:1, 1 QA for 3 dev)` | `QA Resources`, `QA Required` | No |
| 15 | `Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity` | `QA Resources (60%)` | No |
| 16 | `Number of Months (Dev)` | `Duration (months)`, `Duration` | No |
| 17 | `Total resources required` | `Total Resources` | No |
| 18 | `sizing (refer sheet 2 for guidance)` | `Sizing`, `Size`, `T-Shirt Size`, `Estimate` | No |
| 19 | `Additional Resources` | `Extra Resources` | No |
| 20 | `Sizing Comment` | `Sizing Notes`, `Estimate Comment` | No |
| 21 | `Dependency Numbers (Comma Separated List)` | `Dependencies`, `Depends On`, `Depends` | No |
| 22 | `DEPENDENCY` | `Dependency Text`, `Dependency Name` | No |
| 23 | `One line dependency description` | `Dependency Description`, `Dep Description` | No |
| 24 | `Resourcing done?` | `Resourced?`, `Staffed?` | No |
| 25 | `Any new software needed?` | `New Software?`, `Infra Needed?` | No |
| 26 | `Comments` | `Extra Comments`, `Additional Comments` | No |

Alias matching is **case-insensitive, BOM/quote/trim-tolerant, substring-fallback for Excel variations** [source: `shared/src/services/productColumnAliases.ts:122-167`]. First occurrence of each canonical wins [source: `shared/src/services/productColumnAliases.ts:173-183`]. Unmatched columns are flagged as `Unrecognized headers (passed through as-is)` warnings [source: `shared/src/services/csvConverterService.ts:686-687`].

## Sizing Map (9 Bands)

Single source of truth is `shared/src/constants/binPackingSizing.ts:13-23` ported from `apps/bin-packing/js/sizing.js:8-18` [source: `shared/src/constants/binPackingSizing.ts:1-11`, `apps/bin-packing/js/sizing.js:8-18`]. Do not duplicate the map outside these two files [source: `shared/src/constants/binPackingSizing.ts:8-11`].

| # | Sizing label (canonical) | Ceiling months (`SIZING_MONTHS`) | Duration interpretation |
|---|---|---|---|
| 1 | `None` | `0` | No estimate / unscoped [source: `shared/src/constants/binPackingSizing.ts:14`, `apps/bin-packing/js/sizing.js:9`] |
| 2 | `XS (1 month)` | `1` | ≤1 month [source: `shared/src/constants/binPackingSizing.ts:15`, `apps/bin-packing/js/sizing.js:10`] |
| 3 | `S (1-3 months)` | `3` | 1–3 months ceiling [source: `shared/src/constants/binPackingSizing.ts:16`, `apps/bin-packing/js/sizing.js:11`] |
| 4 | `M (3-5 months)` | `5` | 3–5 months ceiling [source: `shared/src/constants/binPackingSizing.ts:17`, `apps/bin-packing/js/sizing.js:12`] |
| 5 | `L (5-8 months)` | `8` | 5–8 months ceiling [source: `shared/src/constants/binPackingSizing.ts:18`, `apps/bin-packing/js/sizing.js:13`] |
| 6 | `XL (8-13 months)` | `13` | 8–13 months ceiling [source: `shared/src/constants/binPackingSizing.ts:19`, `apps/bin-packing/js/sizing.js:14`] |
| 7 | `XXL (13+ months)` | `21` | 13–21 months ceiling [source: `shared/src/constants/binPackingSizing.ts:20`, `apps/bin-packing/js/sizing.js:15`] |
| 8 | `3L (21+ months)` | `34` | 21–34 months ceiling [source: `shared/src/constants/binPackingSizing.ts:21`, `apps/bin-packing/js/sizing.js:16`] |
| 9 | `4L (34+ months)` | `55` | 34–55 months ceiling [source: `shared/src/constants/binPackingSizing.ts:22`, `apps/bin-packing/js/sizing.js:17`] |

Normalisation via `sizingToMonths(label)` — trims, returns `0` for unknown/empty [source: `shared/src/constants/binPackingSizing.ts:32-38`]. Duration fallback uses this ceiling only when higher-priority duration signals are absent [source: `apps/bin-packing/js/csv-parser.js:215-226`, `shared/src/services/csvConverterService.ts:459-471`].

## Dependency Syntax

Parsed by `parseDependencyNumbersAndBlockers(raw)` [source: `apps/bin-packing/js/csv-parser.js:73-94`, `shared/src/services/csvConverterService.ts:168-191`].

- **Input column:** `Dependency Numbers (Comma Separated List)` [source: `apps/bin-packing/js/csv-parser.js:138`, `shared/src/services/csvConverterService.ts:365`]
- **Splitter:** `raw.split(/[,;]/)` — comma **or** semicolon [source: `apps/bin-packing/js/csv-parser.js:78`, `shared/src/services/csvConverterService.ts:175`]
- **Number extraction:** `trimmed.match(/\d+/)` + `parseInt(...,10)` — first integer in segment [source: `apps/bin-packing/js/csv-parser.js:81-83`]
- **Blocker classification via regex** [source: `apps/bin-packing/js/csv-parser.js:85-86`, `shared/src/services/csvConverterService.ts:182-183`]:

| Regex | Meaning | Example input → parsed |
|---|---|---|
| `/\d+\s*\(\s*dev-blocker\s*\)/i` | **dev-blocker** — upstream engineering dependency | `33 (dev-blocker)` → `rowNumbers:[33], devBlockers:[33]` [source: `apps/bin-packing/js/csv-parser.js:85`] |
| `/\d+\s*\(\s*rel-blocker\s*\)/i` | **rel-blocker** — release-blocking dependency | `6 (rel-blocker)` → `rowNumbers:[6], relBlockers:[6]` [source: `apps/bin-packing/js/csv-parser.js:86`] |
| *(no parenthetical)* | Plain dependency | `6, 27` → `rowNumbers:[6,27], devBlockers:[], relBlockers:[]` [source: `apps/bin-packing/js/csv-parser.js:73-94`] |

- **Deduplication:** `[...new Set(rowNumbers)]` etc. [source: `apps/bin-packing/js/csv-parser.js:89-92`, `shared/src/services/csvConverterService.ts:186-188`]

### Examples

```
"33 (dev-blocker)"                → { rowNumbers: [33], devBlockers: [33], relBlockers: [] }
"6, 27"                          → { rowNumbers: [6, 27], devBlockers: [], relBlockers: [] }
"6 (rel-blocker)"                → { rowNumbers: [6], devBlockers: [], relBlockers: [6] }
"6 (rel-blocker), 27, 33 (dev-blocker)" → { rowNumbers: [6,27,33], devBlockers:[33], relBlockers:[6] }
"6; 27 ( dev-blocker )"          → { rowNumbers: [6,27], devBlockers:[27], relBlockers:[] }  // whitespace-tolerant
```

## Duration Priority (4 Levels)

Deterministic ladder in `csv-parser.js:207-228` [source: `apps/bin-packing/js/csv-parser.js:207-228`], mirrored in `CsvConverterService.rowsToProjectsCore:459-471` [source: `shared/src/services/csvConverterService.ts:459-471`]:

| Priority | Signal (column) | Formula / value | When it wins |
|---|---|---|---|
| **1** | `Number of Months (Dev)` (`iNumberMonthsDev`) | Direct: `durationMonths = numMonthsDev` (parsed float, `>0`) | Explicit calculated duration present [source: `apps/bin-packing/js/csv-parser.js:216-217`, `shared/src/services/csvConverterService.ts:460-461`] |
| **2** | `Total Months Needed for 1 person by Dev (…) / Dev Resources required for max parallization` | `ceil(totalPersonMonthsNum / devResources)` | Total person-months >0 **and** devResources >0 [source: `apps/bin-packing/js/csv-parser.js:218-219`, `shared/src/services/csvConverterService.ts:462-463`] |
| **2b** | `Total Months Needed …` with `devResources == 0` | `ceil(totalPersonMonthsNum)` + `devResources = 1` fixup (handles `#DIV/0!` in sheet formula) | Total person-months >0 but no dev count [source: `apps/bin-packing/js/csv-parser.js:220-223`, `shared/src/services/csvConverterService.ts:464-466`] |
| **3** | `sizing (refer sheet 2 for guidance)` | `monthsFromSizing = SIZING_MONTHS[sizingLabel] ?? 0` ceiling | Higher signals absent but sizing label known [source: `apps/bin-packing/js/csv-parser.js:224-225`, `shared/src/services/csvConverterService.ts:467-468`] |
| **4** | *None of the above* | `0` (packer treats blank as 1-month bar downstream, not here) | No sizing data → `durationMonths: 0` [source: `apps/bin-packing/js/csv-parser.js:226-228`, `shared/src/services/csvConverterService.ts:469-471`] |

Note: `devResources` and `totalPersonMonthsNum` are parsed with comma stripping (`String(v).replace(/,/g,'')`) and `parseFloat`, clamped to `≥0` [source: `apps/bin-packing/js/csv-parser.js:173-174`, `shared/src/services/csvConverterService.ts:418-419`].

## RowNumber Fallback

- **Primary:** `Sl No` (or `Sl. No` / `Sl No`-containing) column parsed as `parseInt(rowNumRaw,10)` [source: `apps/bin-packing/js/csv-parser.js:188-189`, `shared/src/services/csvConverterService.ts:431-433`] — resolution order `idx('Sl No') → idx('Sl. No') → idxContains('Sl No')` [source: `apps/bin-packing/js/csv-parser.js:124`, `shared/src/services/csvConverterService.ts:341-343`], with `iFirstCol = iSlNo >=0 ? iSlNo : 0` fallback to column 0 [source: `apps/bin-packing/js/csv-parser.js:125`, `shared/src/services/csvConverterService.ts:343`].
- **Fallback:** When blank / non-numeric → `assignedRowNumber = 9000 + projects.length` (i.e. `9000+index` among already-emitted projects, not raw row index) [source: `apps/bin-packing/js/csv-parser.js:192-193`, `shared/src/services/csvConverterService.ts:440`]. Comment: `Every row is a project. Rows without Sl No get assigned row number 9000 + index.` [source: `apps/bin-packing/js/csv-parser.js:192`]
- **Identity:** `id: row-${assignedRowNumber}` [source: `apps/bin-packing/js/csv-parser.js:237`, `shared/src/services/csvConverterService.ts:480`]. Continuation rows (`rowNumber >= 9000`) participate in resource-group bucketing via `isContinuationRow` [source: `shared/src/services/csvConverterService.ts:249-251`].

## Product Alias Map (D1 Product-Agnostic)

**No hardcoded NDB-only column names outside config** per `product-agnostic.mdc` [source: `agent-pack/lighthouse/rules/product-agnostic.mdc`]:

- Config lives in `shared/src/services/productColumnAliases.ts` [source: `shared/src/services/productColumnAliases.ts:12-119`]:
  - `NDB_COLUMN_ALIASES` — canonical Sheet1 header → accepted synonyms (first entry is canonical itself) [source: `shared/src/services/productColumnAliases.ts:22-101`]
  - `PRODUCT_COLUMN_ALIASES` registry: `ndb` / `default` = `NDB_COLUMN_ALIASES`; future tenants (e.g. `datalens`) override per-canonical entries [source: `shared/src/services/productColumnAliases.ts:107-112`]
  - Lookup: `getColumnAliases(productId)` (unknown → NDB fallback, never throws) [source: `shared/src/services/productColumnAliases.ts:133-137`], `canonicalHeaderFor(rawHeader, productId)` (exact alias → substring fallback for Excel variants like `"Total Months … - v2"`) [source: `shared/src/services/productColumnAliases.ts:144-167`], `buildHeaderIndex(headerRow, productId)` (first occurrence wins) [source: `shared/src/services/productColumnAliases.ts:173-183`]
- Consumer pattern: `loadAgentPack('lighthouse').prompts` / `pack.context` resolve `{productId}` placeholder; skill calls `canonicalHeaderFor(h, productId)` / `buildHeaderIndex(row, productId)` / `CsvConverterService(productId)` [source: `shared/src/services/csvConverterService.ts:538-539`, `mcp/shared/tools/convertToBinPackingCsv.ts:104-112`]
- Examples of product divergence: `Sl No` also accepts `Row Number` / `#`; `FEAT NUMBER` accepts `Issue Key` / `Key`; `SUMMARY` accepts `Title` / `Description` [source: `shared/src/services/productColumnAliases.ts:23-26`]; `NDB` default is Sheet1 names; other products supply `PRODUCT_COLUMN_ALIASES[productId]` overrides [source: `shared/src/services/productColumnAliases.ts:107-112`].

## Security Note — Untrusted Uploads

Uploaded / extracted archives are **untrusted data** and must be isolated:

- **Isolated mkdtemp per file** — each upload is placed in its own new, empty directory (`fs.mkdtemp`) — do not reuse a shared temp dir and do not place scripts in the upload dir [source: `mcp/shared/tools/convertToBinPackingCsv.ts:29-42` isolation pattern + env instruction].
- **Python `-I` (isolated mode)** — any Python extractor that reads XLSX/PDF/DOCX runs with `python -I` so `import json` does not load a planted `json.py` from the upload dir / CWD [source: env instruction `isolated_python`].
- **No exec from upload dir** — never `cd` into the upload dir and run an interpreter; always **pass absolute paths as arguments** to scripts that live in a different directory [source: env instruction `no_execution_from_upload_dir`].
- **Additional controls** (implemented in `mcp/shared/tools/convertToBinPackingCsv.ts` for the MCP surface):
  - Path traversal rejected (`..` segments / non-absolute) [source: `mcp/shared/tools/convertToBinPackingCsv.ts:82-88`]
  - 10 MiB payload limit (on-disk `stat` or base64 decoded length) [source: `mcp/shared/tools/convertToBinPackingCsv.ts:31`, `mcp/shared/tools/convertToBinPackingCsv.ts:165-181`]
  - MIME allowlist enforced when `mimeType` supplied [source: `mcp/shared/tools/convertToBinPackingCsv.ts:33-41`, `mcp/shared/tools/convertToBinPackingCsv.ts:136-142`]
  - `fileName` sanitised to basename, control chars stripped [source: `mcp/shared/tools/convertToBinPackingCsv.ts:90-94`]

## Validation Loop

Canonical procedure via `CsvConverterService` [source: `shared/src/services/csvConverterService.ts:535-736`]:

```
1. extractRawRows(absolutePath)            // CSV: parseCSV(text); XLSX: isolated extractor → rows
     → { rows, error, fileType }           // [source: shared/src/services/csvConverterService.ts:558-596]
2. validateViaRowsToProjects(rows)         // = rowsToProjectsCore(rows) port of csv-parser.js:111-266
     → { projects, error, skipped, invalidRows }  // [source: shared/src/services/csvConverterService.ts:607-613]
3. if (error && repairPossible)            // e.g. missing mandatory cols but aliases could be injected
     → repair once: normalizeHeaders / alias-inject missing canonicals via PRODUCT_COLUMN_ALIASES
     → re-validate (single repair, no loop)        // [source: shared/src/services/csvConverterService.ts:615-658 convertToCanonicalCsv repair pattern]
4. generateReport({ rows, validated, fileType }) // warnings for missing useful optionals + unrecognized headers
     → { warnings, totalDataRows, converted, skipped, ... } // [source: shared/src/services/csvConverterService.ts:661-701]
```

`rowsToProjects` skips rows where both `FEAT NUMBER` and `SUMMARY` are blank (both `skipped` and `invalidRows`) [source: `shared/src/services/csvConverterService.ts:408-411`, `apps/bin-packing/js/csv-parser.js:165-168 (implied)`]. Resource-group detection (`detectResourceGroupsInline`) runs post-parse but is best-effort and never fails the conversion [source: `shared/src/services/csvConverterService.ts:506-511`].

## Output Format

`CsvConverterService.convertFile` / `convertToCanonicalCsv` + `generateReport` return [source: `shared/src/services/csvConverterService.ts:615-736`, `mcp/shared/tools/convertToBinPackingCsv.ts:244-286`]:

```typescript
{
  csvText: string,          // canonical Sheet1 CSV: CANONICAL_HEADERS header + rows with escapeCsvCell [source: shared/src/services/csvConverterService.ts:517-524, 634-650]
  warnings: string[],       // extractError? + missing useful optionals + mandatory missing + unrecognized headers [source: shared/src/services/csvConverterService.ts:673-688, mcp/shared/tools/convertToBinPackingCsv.ts:255-256]
  stats: {                  // caller-computed from header mapping
    rows: number,           // data rows (rows.length-1) [source: shared/src/services/csvConverterService.ts:671]
    cols: number,           // raw header width
    mappedCols: number,     // headers matching canonicalHeaderFor(productId) [source: mcp/shared/tools/convertToBinPackingCsv.ts:236-242]
    unmappedCols: number
  },
  validation: {
    projectsParsed: number, // validated.projects.length [source: mcp/shared/tools/convertToBinPackingCsv.ts:258-268]
    errors: string[],       // validated.error + invalidRows[].reason [source: mcp/shared/tools/convertToBinPackingCsv.ts:260-263]
    warnings: string[]      // skipped[].reason + report.warnings [source: mcp/shared/tools/convertToBinPackingCsv.ts:264-267]
  }
}
// Structured MCP return also includes structuredContent: { csvText, warnings, stats, validation } [source: mcp/shared/tools/convertToBinPackingCsv.ts:283-286]
```

Preview text is truncated to 6000 chars in `structuredContent` companion (`csvText.slice(0,6000)`) [source: `mcp/shared/tools/convertToBinPackingCsv.ts:280`].

**Implementation reference — skill is orchestration only:** all deterministic transforms live in `shared/src/services/csvConverterService.ts` (`CsvConverterService`, `parseCSV`, `parseDependencyNumbersAndBlockers`, `normalizeHeaderCell`, `escapeCsvCell`) and `shared/src/constants/binPackingSizing.ts` (`SIZING_MONTHS`, `sizingToMonths`) — the skill must not reimplement parsers [source: `shared/src/services/csvConverterService.ts:1-16`, `shared/src/constants/binPackingSizing.ts:1-11`, `agent-pack/rules` D1 tenancy]. The MCP surface `mcp/shared/tools/convertToBinPackingCsv.ts` is the hosted tool wrapper [source: `mcp/shared/tools/convertToBinPackingCsv.ts:1-20`].

## Quality Validation Checklist

- [ ] `audience: portfolio_mgr` declared (frontmatter) per `persona-aware-output.mdc` [source: `agent-pack/lighthouse/rules/persona-aware-output.mdc`]
- [ ] Every claim in output cites a source per `citation-first-output.mdc` (JIRA key / query / `[source: …]` / `[snapshot: …]`) [source: `agent-pack/lighthouse/rules/citation-first-output.mdc`]
- [ ] No hardcoded NDB-only column strings outside `productColumnAliases.ts` / `binPackingSizing.ts` per `product-agnostic.mdc` [source: `agent-pack/lighthouse/rules/product-agnostic.mdc`]
- [ ] Canonical header table present: 2 mandatory vs 24 optional (26 total, spec shorthand 2 vs 21) — cites `csv-parser.js:128` [source: `apps/bin-packing/js/csv-parser.js:128`]
- [ ] Sizing map table present: 9 bands `None=0` through `4L=55` — cites `sizing.js` and `binPackingSizing.ts` [source: `apps/bin-packing/js/sizing.js:8-18`, `shared/src/constants/binPackingSizing.ts:13-23`]
- [ ] Dependency syntax documented: examples `33 (dev-blocker)` / `6, 27` / `6 (rel-blocker)` with regex `\d+\s*\(\s*dev-blocker\s*\)` — cites `csv-parser.js:73` [source: `apps/bin-packing/js/csv-parser.js:73-86`]
- [ ] Duration priority documented: 4 levels `Number of Months (Dev) > ceil(TotalMonths/DevResources) > sizing ceiling > 0` — cites `csv-parser.js:207` [source: `apps/bin-packing/js/csv-parser.js:207-228`]
- [ ] RowNumber fallback documented: `9000+index` — cites `csv-parser.js:192-193` [source: `apps/bin-packing/js/csv-parser.js:192-193`]
- [ ] Product alias map documented: `ndb` default = Sheet1 names, other products via `PRODUCT_COLUMN_ALIASES` [source: `shared/src/services/productColumnAliases.ts:107-112`]
- [ ] Security note present: isolated `mkdtemp` per file, `python -I`, no exec from upload dir, pass paths as args
- [ ] Validation loop present: `rowsToProjects → if error repair once → validate` via `CsvConverterService` [source: `shared/src/services/csvConverterService.ts:607-613`]
- [ ] Output format present: `csvText + warnings + stats + validation` via `convertToBinPackingCsv` structuredContent [source: `mcp/shared/tools/convertToBinPackingCsv.ts:283-286`]
- [ ] Skill references `shared/services/csvConverterService` as impl (no code duplication) [source: `shared/src/services/csvConverterService.ts:1-16`]
- [ ] Bin-packing vs Lighthouse kept distinct (capacity planner vs product MCP server, different apps) [source: `ARCHITECTURE.md`, `DECISIONS.md` D44/D45]
- [ ] Loadable via `loadAgentPack('lighthouse')`; harness symlinks via `agent-pack/harness/` [source: `agent-pack/harness/cursor.json`]

## Delegation

- **Owner:** `dependency-tracker-specialist` (`agent-pack/lighthouse/identity/specialists/dependency-tracker-specialist.md`) — graph/blocker-adjacent work per D18 [source: `agent-pack/lighthouse/identity/specialists/dependency-tracker-specialist.md:1-15`].
- **Trigger:** `ops-assistant` (orchestrator) delegates after classification, via `loadAgentPack('lighthouse')` — `pack.skills.get('csv-to-binpacking')` or `read agent-pack/lighthouse/skills/csv-to-binpacking/SKILL.md` [source: `agent-pack/lighthouse/identity/ops-assistant.md:68-86`, `agent-pack/lighthouse/identity/ops-assistant.md:102-116`].
- User-utterance patterns that route here: "convert/upload/import for bin-packing", "normalise headers", "make this sheet load in capacity planner" (vs `dependency-walk` for "what's blocking?" [source: `agent-pack/lighthouse/skills/dependency-walk/SKILL.md:7-13`]).

## Cross-References

- `shared/src/services/csvConverterService.ts` — deterministic impl (parse, alias-resolve, validate, convert, report) [source: `shared/src/services/csvConverterService.ts`]
- `shared/src/constants/binPackingSizing.ts` — sizing ceiling single source of truth [source: `shared/src/constants/binPackingSizing.ts`]
- `shared/src/services/productColumnAliases.ts` — D1 alias map (NDB default + per-product overrides) [source: `shared/src/services/productColumnAliases.ts`]
- `mcp/shared/tools/convertToBinPackingCsv.ts` — hosted MCP tool wrapper (read-only, HITL-gated writes per D26) [source: `mcp/shared/tools/convertToBinPackingCsv.ts`]
- `apps/bin-packing/js/csv-parser.js` — vanilla-JS source logic (parseCSV, rowsToProjects, duration priority, blocker regex, RowNumber fallback) [source: `apps/bin-packing/js/csv-parser.js`]
- `apps/bin-packing/js/sizing.js` — `SIZING_MONTHS` + `SIZING_BAND_MONTHS` + `monthsFromSizingBand` [source: `apps/bin-packing/js/sizing.js`]
- `apps/bin-packing/data/sheet1.csv` — canonical Sheet1 header + sample rows [source: `apps/bin-packing/data/sheet1.csv`]
- `agent-pack/lighthouse/identity/specialists/dependency-tracker-specialist.md` — owner specialist [source: `agent-pack/lighthouse/identity/specialists/dependency-tracker-specialist.md`]
- `agent-pack/lighthouse/identity/ops-assistant.md` — orchestrator delegation [source: `agent-pack/lighthouse/identity/ops-assistant.md`]
- `agent-pack/lighthouse/rules/persona-aware-output.mdc` — `audience: portfolio_mgr` requirement [source: `agent-pack/lighthouse/rules/persona-aware-output.mdc`]
- `agent-pack/lighthouse/rules/citation-first-output.mdc` — every claim cites source [source: `agent-pack/lighthouse/rules/citation-first-output.mdc`]
- `agent-pack/lighthouse/rules/product-agnostic.mdc` — D1 config-driven aliases [source: `agent-pack/lighthouse/rules/product-agnostic.mdc`]
- `agent-pack/harness/` — symlink generation for `.cursor/skills` / `.claude/skills` / `.codex/skills` / `.agents/skills` [source: `agent-pack/harness/cursor.json`, `agent-pack/harness/install.sh`]
- `ARCHITECTURE.md` — 5-layer model: bin-packing is a UI-layer vanilla app, not the MCP layer [source: `ARCHITECTURE.md`]
- `DECISIONS.md` — D1 (product-agnostic), D3 (5 connectors), D16 (orchestrator-workers), D44/D45 (Lighthouse vs Loom tenancy)
