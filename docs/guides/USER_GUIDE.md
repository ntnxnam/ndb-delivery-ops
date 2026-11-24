---
product: NDB Delivery Ops
lastUpdated: 2026-11-24
coversVersion: "3.1"
source: doc-user-guide @ 2026-11-24
---

# User Guide

> For IC / TPM / FEAT / QA personas. Maintained by `doc-specialist` via `doc-user-guide`.

## Table of Contents
- [Getting Started](#getting-started)
- [Sprint Report](#sprint-report)
- [Release Brief](#release-brief)
- [Quality Column (TCMS)](#quality-column-tcms)
- [Bin-Packing CSV Converter](#bin-packing-csv-converter)
- [OnCalls V2](#oncalls-v2)
- [Tips & FAQ](#tips--faq)

## Getting Started

1. Log in at `/login` (RBAC via `allowedUsers.json` — see [ADMIN_GUIDE.md#rbac) (see Documentation)).
2. Pick product + release in the header.
3. Use sidebar tabs per your permission.

## Sprint Report

**Who:** TPM, FEAT owners
**Steps:** Open Sprint Report → select sprint → review burndown/burnup.
**Tips:** Use `?` filter help for JQL-backed counts.

## Release Brief

**Who:** Team Exec / Director
**Steps:** Open Release Brief → check RAG + blockers → drill into FEAT.

## Risk Details (Project Status)

**Who:** Portfolio Manager, TPM, Director
**Steps:** Open Project Status → select release → scan the Risk Details column.
**What it shows:** Risk Indicator pill (Deep Red/Red/Green/Yellow) + Risk Assessment + Path to Green. Rich-text values authored in JIRA (ADF) render as plain text; URLs render as Link; empty stays Not Set. Previously cached HTML values strip on next fetch.
**Risk movement trail:** When Risk Indicator has changed during the release, the badge is followed by a trail `Current ← Prior` (e.g. `Red ← Yellow ← Green`) with prior values struck-through. The trail is derived from `POST /api/jira/release-items-history` `checkpointHistory[key].riskIndicator` and rendered via `client/src/utils/riskHistoryDisplay.js` (SoT `RAG_COLORS`). Single-value history shows no trail. The same trail appears in SoS Summary table + SoS/release-versions emails; Feature Dashboard and Email Sender are intentionally out of scope (see `docs/pages/FeatureDashboard-data-layer.md#risk-trail-disposition`).

## Quality Column (TCMS)

**Who:** TPM, FEAT owners, QA

The Quality column on the Project Status table shows TCMS test results per
feature.

- **Four tables per feature**: `Release — Overall`, `Release — Last 4
  weeks`, `Master — Overall`, `Master — Last 4 weeks`.
- **Each table is a 2×2 grid**:
  - Rows: **Functional**, **System**
  - Columns: **Manual**, **Automation**
  - Cells: QI / Run / Passed / Failed / Rate
- **Last 4 weeks** window reflects runs in the most recent 4-week window;
  shows "Not Set" when there are no runs in that window (it does not fall
  back to Overall). Time-filtered runs now come from the corrected TCMS
  metrics endpoint (`/api/v1/all_test_cases/aggregate/metrics` with
  `time_filter=four_weeks`).
- **Caveat:** Functional and System rows currently share the same source
  metrics until TCMS exposes a `test_category` filter. Do not read
  distinctness into the two rows yet. See [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md).

## Bin-Packing CSV Converter

**Who:** Portfolio Manager, TPM, Release Manager

Convert any JIRA export, spreadsheet, or pasted table into the canonical 26-column bin-packing CSV that the Bin-Packing capacity planner understands.

**Steps:**

1. Open **Bin-Packing** from the sidebar (opens in a new tab at `/bin-packing/`).
2. Go to the **Upload CSV** tab and click **Convert any file (AI)** above the existing file picker.
3. Select a file (`.csv`, `.xlsx`, `.xls`, `.pdf`, `.docx`, `.tsv` — up to 10 MB). You can also paste TSV/CSV text copied from Confluence or JIRA.
4. Wait for conversion — the preview shows **mapped** headers (green), **unmapped** headers (yellow), and a **missing-mandatory** warning if `FEAT NUMBER` or `SUMMARY` could not be resolved. Warnings explain which alias to use.
5. Click **Download CSV** to save the canonical file, or **Replace & Repack** to render the converted rows directly in the Gantt without a download step.

**Details:** See [CSV Converter Guide](../product/CSV_CONVERTER_GUIDE.md) for the full 26-column header contract, alias table, sizing labels, dependency syntax, and duration priority rules. The legacy CSV/XLSX upload continues to work unchanged — the converter is additive.

**Tips:**

- JIRA-native headers (`Issue Key`, `Summary`, `Assignee`) resolve automatically via the product alias map — no manual renaming needed.
- If a mandatory column is missing, the converter shows which aliases are accepted for that column — rename and retry.
- The chat panel can also convert files: ask the ops assistant to convert a file and it delegates to the `csv-to-binpacking` skill (prompt/orchestration only — deterministic logic stays in `shared`).

## OnCalls V2

**Who:** Team Executive / VP, TPM, Director, EM  
**Route:** `/oncalls` (V2) — legacy pulse view at `/oncalls-legacy`

This is the VP-first OnCalls dashboard — one timeframe pill controls every number so you can skim *what's hot, too-long, and what to fix*.

**At a glance — timeframe pills (global)**

Pick a pill at the top (sticky): `7d` · `15d` · `1M` · `1Q` · `2Q` · `1Y` · `18M` · `Overall`. Every hero, health strip, age table, graph, and gap taxonomy recomputes for that window. `Overall` shows all closed history (no date clause). The drawer inherits the pill — it never resets.

**What you see**

1. **AI Concern** (~100 words) — fuses quant (open / MTTR / net) + qual (hotspot: top 2 components like Upgrade/MSSQL + gap% + workflow view). It auto-generates after metrics load and regenerates when you change pill, click a hero, or open a taxonomy. Use **Regenerate AI Concern** to refresh.
2. **Hero row (5):** `Open now` · `Aged >Nd` · `Need Info` · `Waiting for Customer` · `Closed in window`. Each card shows count + one-line explainer + **Open in JIRA ↗** (exact JQL). Clicking a count opens the in-app drill; the JIRA link opens the JQL search.
3. **Health row (4):** `MTTR median` · `MTTR p90` · `Throughput` (with net) · `Aged share`. Click to drill into throughput/MTTR (past scope).
4. **How-long-open table:** bucket / count / median age / oldest / JQL proof.
5. **Pulse graph:** weekly Created→Resolved for the pill window (Overall → default 2Q); toggle flow vs snapshot.
6. **Gap taxonomy (3 cards):** `Duds` (duplicate/Won't Do/Cannot Reproduce/no linked fix) · `NDB gaps` (our gaps) · `Other-team gaps`. Double-click **NDB gaps** to expand the 4 sub-cards: `TH linked` · `Bugs` · `Improvements` · `Other`.
7. **Drill drawer:** clicking any count/taxonomy opens the ticket list for that view with a per-view AI 2-liner + fix suggestion. The drawer keeps the pill.

**Dual-click rule (all heroes):** **Count → in-app drill**, **Open in JIRA ↗ → exact JQL** — never both external.

See [Oncalls requirements](../pages/Oncalls-requirements.md) and [Oncalls data-layer](../pages/Oncalls-data-layer.md) for JQL contracts, gap rules, and config. Legacy `/oncalls-legacy` keeps the pulse-only comparison.

## CFD / CFI
**Who:** TPM, QA Lead
**Steps:** Open KPIs → CFD/CFI → Top / Non-Top → check created vs resolved.
**Tips:** Use MTTR and status-dwell to spot aging items.

## Dependency View
**Who:** FEAT owner, TPM
**Steps:** Open Dependency View → select release → review blockers.
**Tips:** Links show upstream/downstream tickets.

## KPI Pulse
**Who:** TPM, Director
**Steps:** Open KPIs → last 2 quarters strip → toggle cumulative / point-in-time.
**Tips:** Compare trend vs snapshot.

## Tips & FAQ

- Missing tab? Check permissions in [ADMIN_GUIDE.md](./ADMIN_GUIDE.md).
- Need to convert a spreadsheet for bin-packing? See [Bin-Packing CSV Converter](#bin-packing-csv-converter) and the detailed [CSV Converter Guide](../product/CSV_CONVERTER_GUIDE.md).
- Commit scope labels (deferred/mustfix/wishlist…) come from central taxonomy in `jiraFieldsConfig.json` — contact admin to change, don't edit JQL inline (`client/src/utils/jiraFields` + fieldConfig).
- Caveats? See [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md).
