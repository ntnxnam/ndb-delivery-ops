---
name: csv-import
aliases: [era-csv-jira-import]
description: >-
  Import CSV/Excel rows into Nutanix JIRA (ERA) as Epics and child Tasks with
  Epic Link, labels, components, and idempotent logging. Fail-fast on missing
  mandatory fields before creating anything. Use when creating JIRA tickets
  from a CSV or Excel sheet, AuthZ API ownership lists, bulk epic+task import,
  or re-running/resuming an ERA ticket import.
---

# ERA CSV / Excel → JIRA Import

## When to Use This Skill

- User provides a CSV or Excel of APIs / work items and asks to create ERA Epics + Tasks
- AuthZ / IAMv2 ownership sheets (public or internal) need ticket creation
- Resume, dry-run, or verify a previous bulk import (import logs, labels)
- Bulk update of summaries, labels, or descriptions on a prior import batch

## Quick Start

1. Locate the CSV/Excel path and confirm project (`ERA` unless user says otherwise).
2. **Preflight (mandatory):** validate columns → **fail fast** if required fields missing (see Core Rules). Do not create tickets.
3. Dry-run one epic (controller) and show sample Epic + Task payloads.
4. On user approval (`execute` / `go`): create Phase extras if requested → Epics → Tasks with Epic Link → write import log.
5. Verify with JQL counts + spot-check keys; report Phase 2 / Parent Link if configured.

Reference implementations (scratch, not in repo):

- `~/Downloads/authz-import/jira_importer.py` — public Phase 1 AuthZ
- `~/Downloads/authz-import/internal_import.py` — Internal APIs + Phase 2 disclaimer backfill

## Core Rules

### 1. Fail fast on mandatory fields

**Before any JIRA create/update**, inspect CSV headers (and first data rows). If any mandatory field is missing or cannot be derived, **stop immediately**. Create nothing. Respond with:

1. `FAIL: CSV missing mandatory fields. Nothing created.`
2. **Missing:** comma-separated list
3. **Mandatory for this import:** full catalog (below)
4. **Present:** columns found in the file

Do not invent fake values for mandatory fields. Defaults are allowed only where listed as “default OK”.

#### Mandatory CSV inputs (or clear equivalent column)

| Need | Acceptable column names (examples) | Notes |
|---|---|---|
| Epic grouping key | `Java Controller`, `Controller`, `Epic Name` (controller), `` ` `` | One Epic per distinct value; reuse across sheets |
| Task API identity | `API Endpoint` / `Endpoint` **plus** `Verb` / `HTTP Method` and/or `Java Method` / `Java Method Name` | Enough to build a unique task summary |
| Assignee | `Owner`, `Assignee` | Must resolve to exactly one active JIRA user (use overrides table if needed) |
| Components | `Component/s` **or** `Teams` / `Teams (sheet)` | Must map to ≥1 existing ERA component |

#### Mandatory on create (ERA createmeta — may be defaults)

| JIRA field | Source |
|---|---|
| Project | Default `ERA` OK |
| Issue type | Epic / Task (script) |
| Summary | Derived or CSV — non-empty |
| Epic Name (`customfield_10362`) | Required on Epics — set equal to epic summary unless user specifies otherwise |
| Priority | Default OK (e.g. `Critical - P1`) unless user overrides |
| Fix Version | Default OK (e.g. `NDB-3.0`) unless user overrides |
| Affects Version | Default OK (e.g. `master`) unless user overrides |
| Component/s | From CSV mapping — **not** optional |
| Description | Built from non-empty CSV columns — **not** empty |

#### Optional (preserve if present; never require)

`Labels`, `Notes`, `Exclusion Reason`, `Entity Group`, `Archetype`, `called by UI?`, `Deprecated for 3.0`, `In API Spec`, sheet comments, etc.

**Labels rule:** Attach every label from a CSV `Labels` column as-is. Additive import labels are OK. Do **not** add labels the user forbade (e.g. do not add `ndb-iamv2-phase1-public` on Internal imports unless the sheet already has it).

### 2. Epic / Task creation order

1. Optional catch-all / Phase epics first (if user requested) — capture key for hyperlinks.
2. Group rows by controller; **one Epic per controller** across multiple sheets (do not duplicate).
3. Create or reuse Epic (`summary` + Epic Name); set Parent Link if user named one (e.g. `ERA-67841`).
4. Create Tasks with Epic Link = that epic’s key.
5. Log every created key to an import log CSV; skip rows already logged or already in JIRA (import label + summary).

### 3. Naming (confirm with user if unclear)

- Public-style: Epic `Phase 1 - Public - <Controller>`; Task `Phase 1: <Controller> - <METHOD> <path> (<method>)` (match prior batch conventions).
- Internal-style: Epic `Phase 1 - InternalAPI - <Controller>`; Task `Phase 1 - <VERB> <endpoint> (<method>)`.
- Always confirm naming before `--execute` if this run differs from a prior batch.

### 4. Safety

- Dry-run by default; require explicit execute approval.
- Escape `{` / `}` in descriptions (JIRA wiki macros).
- Resolve assignees via exact displayName match; maintain an overrides map for ambiguous names.
- Map `Teams` tokens → ERA components (`BR-ind` → `NDB-Backup-Restore`, `NDB-LCM-*` → `NDB-DB-LCM-*`, etc.); fail a row or the preflight if a team token cannot map and no Component/s column exists.
- Prefer scratch scripts outside the deployed app unless the user asks to land code in-repo.

### 5. Field IDs (ERA / Nutanix JIRA)

| Field | ID |
|---|---|
| Epic Link | `customfield_10361` |
| Epic Name | `customfield_10362` |
| Parent Link | `customfield_20363` |
| Primary Component | `customfield_15160` |
| DB Engine | `customfield_46263` |

Do not scatter new hardcoded IDs into app source; keep them in the import script/config.

## Output Format

### Preflight failure

```
FAIL: CSV missing mandatory fields. Nothing created.

Missing: <field>, <field>

Mandatory for this import:
  - Controller (or Epic Name / Java Controller)
  - API Endpoint (+ Verb or Java Method Name)
  - Owner (or Assignee)
  - Teams OR Component/s
  - Non-empty Description build (from CSV columns)
  - Epic Name on Epics (derived from controller naming template OK)

Present: <col1>, <col2>, ...
```

### Successful run summary

```
Phase 2 / extras: <key or n/a>
Epics created/reused: <n>
Tasks created: <n>  skipped: <n>  failed: <n>
Import label: <label>
JQL: project = ERA AND labels = "<import-label>"
Log: <path to import_log.csv>
```

## Quality Validation

- [ ] Preflight ran; missing mandatory fields would have aborted with the catalog above
- [ ] Dry-run reviewed (or user waived) before execute
- [ ] No duplicate epics for the same controller across sheets
- [ ] Every task has Epic Link; every requested epic has Parent Link if configured
- [ ] CSV Labels preserved; forbidden labels not added
- [ ] JIRA counts match import log (epics + tasks)
- [ ] Spot-check: one epic + one task summary, labels, description, assignee, components
