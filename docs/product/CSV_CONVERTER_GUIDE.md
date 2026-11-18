---
audience: portfolio_mgr
---

# CSV Converter Guide — Bin-Packing Canonical Import

> **audience: portfolio_mgr** — This guide is for Portfolio Managers converting project spreadsheets into the bin-packing Gantt. Every claim cites its source [source: agent-pack/rules/citation-first-output.mdc].

## What It Does

The CSV Converter transforms **any common spreadsheet or export format** into the **canonical 26-column bin-packing CSV** (Sheet1 header [source: apps/bin-packing/data/sheet1.csv]) that the Bin-Packing app's Upload CSV tab understands [source: apps/bin-packing/js/upload.js:162]. It normalizes messy headers via the product alias map [source: shared/src/services/productColumnAliases.ts:144], validates mandatory columns before scheduling, and reports warnings instead of silently dropping data [source: shared/src/services/productColumnAliases.ts:118].

The converter is **product-agnostic** per D1 [source: agent-pack/rules/product-agnostic.mdc]: NDB is the default tenant; DataLens and future products resolve through `PRODUCT_COLUMN_ALIASES` [source: shared/src/services/productColumnAliases.ts:107].

## Supported Inputs

| Input type | Extensions | How it is handled |
|---|---|---|
| CSV | `.csv` | RFC-4180 parse with quoted-field and `""` escape support [source: apps/bin-packing/js/csv-parser.js:16] |
| Excel | `.xlsx`, `.xls` | Sheet extraction via Python `python -I` from isolated mkdtemp (never from the upload dir) [source: environment — downloaded files are untrusted data] |
| PDF | `.pdf` | Table extraction via isolated Python extractor (`python -I`) |
| Word | `.docx` | Table extraction via isolated Python extractor (`python -I`) |
| TSV | `.tsv` | Same RFC-4180 parse, tab-delimited variant |
| JIRA export | `.csv` (JIRA "Export Excel CSV") | Headers like `Issue Key`, `Summary`, `Story Points` auto-mapped via aliases |

Any file under 10 MB is accepted [source: apps/bin-packing/js/csv-converter-agent.js:MAX_FILE_BYTES]. Unknown extensions return a descriptive error.

## Canonical Header Spec

The canonical header is the 26-column Sheet1 header in `CANONICAL_HEADERS` order [source: shared/src/services/productColumnAliases.ts:115; apps/bin-packing/data/sheet1.csv].

| # | Canonical header | Required | Typical aliases |
|---|---|---|---|
| 1 | `Sl No` | Optional | `Sl. No`, `S.No`, `Row Number`, `#` [source: shared/src/services/productColumnAliases.ts:23] |
| 2 | `FEAT NUMBER` | **Required** | `Issue Key`, `Key`, `FEAT`, `Feature Key`, `Ticket Key` [source: shared/src/services/productColumnAliases.ts:24] |
| 3 | `SUMMARY` | **Required** | `Summary`, `Title`, `Description`, `Name` [source: shared/src/services/productColumnAliases.ts:25] |
| 4 | `Priority` | Optional | `Prio`, `PRI` |
| 5 | `STATUS` | Optional | `Status`, `State` |
| 6 | `How much of this is Completed in % (do not add %, just put a number)` | Optional | `Progress`, `Completed %`, `% Complete` |
| 7 | `3.0 Commitment Status` | Optional | `Commitment Status`, `Commitment` |
| 8 | `Target Month` | Optional | `Target`, `Due Date`, `Target Date` |
| 9 | `Comment` | Optional | `Comments`, `Notes`, `Remarks` |
| 10 | `DRI` | Optional | `Owner`, `Assignee`, `Lead` |
| 11 | `Total Months Needed for 1 person by Dev (Everything from start to finish)` | Optional | `Total Person Months`, `Person Months`, `Effort (person-months)` |
| 12 | `Dev Resources required for max parallization` | Optional | `Dev Resources`, `Resources`, `Dev Team Size` |
| 13 | `Dev Resources required for max parallization and 60% productivity` | Optional | `Dev Resources (60%)` |
| 14 | `Num of QA required(rule: 3:1, 1 QA for 3 dev)` | Optional | `Num of QA required`, `QA Resources` |
| 15 | `Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity` | Optional | `QA Resources (60%)` |
| 16 | `Number of Months (Dev)` | Optional | `Duration (months)`, `Duration` |
| 17 | `Total resources required` | Optional | `Total Resources` |
| 18 | `sizing (refer sheet 2 for guidance)` | Optional | `Sizing`, `Size`, `T-Shirt Size`, `Estimate` |
| 19 | `Additional Resources` | Optional | `Extra Resources`, `Other Resources` |
| 20 | `Sizing Comment` | Optional | `Sizing Notes` |
| 21 | `Dependency Numbers (Comma Separated List)` | Optional | `Dependencies`, `Depends On`, `Depends` |
| 22 | `DEPENDENCY` | Optional | `Dependency Text`, `Dependency Name` |
| 23 | `One line dependency description` | Optional | `Dependency Description` |
| 24 | `Resourcing done?` | Optional | `Resourced?`, `Staffed?` |
| 25 | `Any new software needed?` | Optional | `New Software?`, `Infra Needed?` |
| 26 | `Comments` | Optional | `Extra Comments`, `Additional Comments` |

Only `FEAT NUMBER` and `SUMMARY` are mandatory — `rowsToProjects` rejects the file otherwise [source: apps/bin-packing/js/csv-parser.js:128; shared/src/services/productColumnAliases.ts:118]. All other columns default gracefully.

## Sizing & Dependency Syntax

### Sizing

The `sizing (refer sheet 2 for guidance)` column accepts 8 t-shirt labels [source: shared/src/constants/binPackingSizing.ts:13; apps/bin-packing/js/sizing.js:8]:

| Label | Ceiling months |
|---|---|
| `None` | 0 |
| `XS (1 month)` | 1 |
| `S (1-3 months)` | 3 |
| `M (3-5 months)` | 5 |
| `L (5-8 months)` | 8 |
| `XL (8-13 months)` | 13 |
| `XXL (13+ months)` | 21 |
| `3L (21+ months)` | 34 |
| `4L (34+ months)` | 55 |

The scheduler resolves **duration** with strict priority — do not reorder [source: apps/bin-packing/js/csv-parser.js:207]:

1. `Number of Months (Dev)` if > 0 — explicit duration wins
2. `ceil(Total Months / Dev Resources)` if both present (0 devs coerced to 1 when Total Months is known)
3. `SIZING_MONTHS[sizingLabel]` — t-shirt fallback
4. `0` — no estimate available

IAMv2-style pool bars use band-specific month picks: < L → lower end, L/XL → mid, > XL → higher end [source: apps/bin-packing/js/sizing.js:24; apps/bin-packing/docs/CONVENTIONS.md].

### Dependencies

The `Dependency Numbers (Comma Separated List)` column uses `Sl No` references split on `,` or `;` [source: apps/bin-packing/js/csv-parser.js:73]:

| Syntax | Meaning | Parsed |
|---|---|---|
| `2` | Depends on row 2 | `rowNumbers=[2]` |
| `6, 27` | Depends on rows 6 and 27 | `rowNumbers=[6,27]` |
| `33 (dev-blocker)` | Dev-blocker on row 33 | `rowNumbers=[33], devBlockers=[33]` [source: apps/bin-packing/js/csv-parser.js:73] |
| `6 (rel-blocker)` | Release-blocker on row 6 | `rowNumbers=[6], relBlockers=[6]` |
| `33 (dev-blocker), 1` | Mixed: dev-blocker + plain | `rowNumbers=[33,1], devBlockers=[33]` |
| `6; 27` | Semicolon separator | `rowNumbers=[6,27]` |

Duplicates are deduplicated per row [source: apps/bin-packing/js/csv-parser.js:73]. Row numbers reference `Sl No` values; rows with blank `Sl No` receive synthetic `9000 + index` ids [source: apps/bin-packing/js/csv-parser.js:189].

## Product Alias Map

Headers are resolved via `canonicalHeaderFor(cell, productId)` — exact alias match first (case-insensitive, BOM/quote/trim-tolerant), then substring fallback for Excel export variations [source: shared/src/services/productColumnAliases.ts:144]. Unknown productId falls back to NDB and never throws [source: shared/src/services/productColumnAliases.ts:136].

Examples by tenant [source: shared/src/services/productColumnAliases.ts:107]:

| Canonical | NDB alias | Example tenant override |
|---|---|---|
| `Sl No` | `S.No`, `Row Number` | — |
| `FEAT NUMBER` | `Issue Key`, `Key`, `FEAT` | `DL-Key` (DataLens, future) |
| `SUMMARY` | `Title`, `Description` | — |
| `sizing (refer sheet 2 for guidance)` | `Sizing`, `Size` | — |
| `Dependency Numbers (Comma Separated List)` | `Dependencies`, `Depends On` | — |

Configure per-product aliases in `PRODUCT_COLUMN_ALIASES` [source: shared/src/services/productColumnAliases.ts:107] — never hardcode product strings outside the alias map [source: agent-pack/rules/product-agnostic.mdc].

## How to Use

### In the App: Upload → Preview → Download / Replace

1. **Upload** — In Bin-Packing → Upload CSV, click **Convert any file (AI)** and select your `.csv`, `.xlsx`, `.pdf`, `.docx`, or `.tsv` file [source: apps/bin-packing/js/upload.js:162]. Files up to 10 MB are supported [source: apps/bin-packing/js/csv-converter-agent.js]. The file is sent as base64 to `POST /api/bin-packing/convert` [source: apps/bin-packing/js/csv-converter-agent.js:getConvertUrl].

2. **Preview** — The converter shows two tables: original headers vs. mapped canonical headers, matched columns highlighted, ignored columns flagged as warnings. Stats (`rowsIn`, `rowsOut`, `columnsMapped`, `columnsIgnored`) and any repair notices appear above the preview [source: agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md].

3. **Download** — Click **Download CSV** to save the canonical 26-col CSV. Load it via **Upload CSV** in Bin-Packing (`rowsToProjects` [source: apps/bin-packing/js/csv-parser.js:111] accepts it directly).

4. **Replace & Repack** — Click **Replace & Repack** to apply the converted rows to the live chart immediately (`rowsToProjects → setProjects / setScheduleData`) without a download step [source: apps/bin-packing/js/csv-converter-agent.js].

### Validation & Repair

The converter calls `rowsToProjects(rows)` [source: apps/bin-packing/js/csv-parser.js:111] and, if the error mentions a missing mandatory column (`FEAT NUMBER` / `SUMMARY` [source: apps/bin-packing/js/csv-parser.js:128]), attempts **one** repair: it renames the unmatched header most likely to be the missing canonical (highest alias substring score) or, if none scores, picks the first column whose sample values look like JIRA keys (`[A-Z]+-\d+`). It re-runs validation once; if it still fails it surfaces the error with a `remediation` listing accepted aliases [source: shared/src/services/productColumnAliases.ts:22]. Non-header errors (`No header or data rows.`) surface immediately with no retry [source: apps/bin-packing/js/csv-parser.js:116].

## API

### `POST /api/bin-packing/convert`

Converts an uploaded file to canonical CSV. Origin is derived from `window.location.origin` — no hardcoded localhost [source: apps/bin-packing/js/csv-converter-agent.js:getApiOrigin].

**Request** (JSON):

```json
{
  "fileName": "projects.xlsx",
  "fileBase64": "<base64-encoded file bytes>",
  "productId": "ndb"
}
```

- `fileName` — original file name (used for extension detection) [source: agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md]
- `fileBase64` — base64-encoded file content
- `productId` — optional tenant id for alias resolution; defaults to `ndb`, unknown values fall back safely [source: shared/src/services/productColumnAliases.ts:136]

**Success response** (200):

```json
{
  "csvText": "<canonical 26-col CSV string, RFC-4180, \\r\\n line endings>",
  "warnings": ["Row 2: synthetic RowNumber 9001 assigned (Sl No blank)"],
  "stats": { "rowsIn": 3, "rowsOut": 3, "columnsMapped": 7, "columnsIgnored": ["Foo"] }
}
```

**Error response** (400):

```json
{
  "csvText": "",
  "warnings": [],
  "stats": { "rowsIn": 1, "rowsOut": 0, "columnsMapped": 3, "columnsIgnored": [] },
  "remediation": "Missing mandatory column: FEAT NUMBER. Add a column with header 'FEAT NUMBER' (aliases: Issue Key, Key, FEAT, ...)",
  "error": "Sheet must include \"FEAT NUMBER\" and \"SUMMARY\" columns. Check the header row."
}
```

Implementation lives in `shared/services/csvConverterService` [source: shared/services/csvConverterService.ts]; prompt/orchestration in `agent-pack/lighthouse/skills/csv-to-binpacking/` [source: agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md]. Do not duplicate conversion logic outside the service [source: agent-pack/lighthouse/skills/csv-to-binpacking/prompt.md — Constraints].

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Sheet must include "FEAT NUMBER" and "SUMMARY" columns` | No column mapped to a mandatory canonical | Rename the JIRA-key column to `FEAT NUMBER` (or alias `Issue Key`, `Key`, `FEAT`) and the title column to `SUMMARY` (or `Title`, `Description`) [source: shared/src/services/productColumnAliases.ts:24] |
| `No header or data rows.` | Empty file or only whitespace rows | Ensure the first row is a header and at least one data row exists [source: apps/bin-packing/js/csv-parser.js:116] |
| Row gets `9000 + index` number | `Sl No` cell is blank or non-numeric | Fill in `Sl No` values; synthetic ids warn and may break dependency refs that use the original numbers [source: apps/bin-packing/js/csv-parser.js:189] |
| Dependency `33 (dev-blocker)` ignored | Column header not recognized as dependency col | Rename to `Dependency Numbers (Comma Separated List)` or alias `Dependencies` / `Depends On` [source: shared/src/services/productColumnAliases.ts:85] |
| Sizing label shows 0 months | Label not in `SIZING_MONTHS` | Use only the 8 canonical labels (`XS`…`4L`) — unknown labels map to 0 with a warning [source: shared/src/constants/binPackingSizing.ts:13] |
| XLSX shows "Unsupported file type" | Server extraction not wired | Convert XLSX to CSV first, or ensure the isolated Python extractor is deployed [source: environment — run any Python that reads them with `-I`] |
| `File too large` | File exceeds 10 MB | Split the export or filter rows before upload [source: apps/bin-packing/js/csv-converter-agent.js:MAX_FILE_BYTES] |
| Extra columns disappear | Unknown headers ignored | Check `warnings` / `stats.columnsIgnored` — only alias-matched columns are carried; rename extra columns to known aliases if needed [source: shared/src/services/productColumnAliases.ts:144] |

---
