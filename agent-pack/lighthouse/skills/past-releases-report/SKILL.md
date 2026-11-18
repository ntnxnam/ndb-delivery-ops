---
name: past-releases-report
description: Generate live-verified past-release slide-deck reports for NDB (or any product) with Feature/Initiative counts, closed KPIs by Integrated Version, gate Gantt, and NAI-grouped capability summaries. Use when a senior exec asks for a past-release report, a release comparison deck, or "what did we ship in NDB-2.x".
audience: team-exec, director, portfolio_mgr, rm, tpm
---

# Past Releases Report — Live-Verified Slide Deck (NDB-2.10/2.11/2.12 pattern)

Reusable skill distilled from the Nov 2026 delivery that produced 4 HTML files per release + evidence + corrections for NDB-2.10/2.11/2.12. Every future past-release deck for any product reuses this path — no net-new JQL, no bundle-only counts, no hardcoded product strings.

Base directory for this skill: `agent-pack/skills/past-releases-report`

## When to Use This Skill

- Senior exec asks "report of all NDB's past releases" with Release, Feature count, Initiative count, list of KPIs closed, release Gantt per release, slide-deck files per release
- User says "generate past-release report for X.Y, X.Z" for NDB or any product (D1 product-agnostic; NDB is one tenant)
- User asks for 2D KPI matrix (rows=KPI, cols=release) with Jira links opening in new tab
- User asks for NAI-summarised capability grouping at beginning of page (overall + per-release)
- Any request that needs live-verified counts vs stale bundle cache (lastSync drift)

If the user wants forward-looking gate compliance (will we land?), use `release-retrospective`. If they want forecast probability, use `predictive-team-exec-analytics`. If they want weekly status email, use `weekly-status-email`.

## Quick Start

```text
Input: {
  productId: "ndb",                // per D5, from productService
  releases: ["NDB-2.10","NDB-2.11","NDB-2.12"],  // any length, ordered old→new
  jiraToken: "Bearer <PAT>",       // from Authorization header or server/.env JIRA_PAT
  outputDir: "Documentation/reports",      // slide-deck files per release
  useIntegratedVersion: true,       // D4b correction: KPIs use "Integrated Version" cf11360
  includeGantt: true,
  includeNaiSummary: true,         // NAI beam-1-501b grouped capabilities
  capabilityGroupingHint: "Group by capability area (Upgrade, Provisioning, HA/DR, Backup/Restore, Security, Platform, Storage, Observability, Integration, Networking) or by DB Engine/Platform"
}

Flow (must follow multi-agent pipeline):
1. Goal KPI Card (from ask) → Developer → Code Review → QA (live JQL) → UX → PM → Exec → JIRA Query Check → Fix → Done
2. Developer: fetch live Feature/Initiative via fixVersion direct + filter audit, fetch 13 KPIs via Integrated Version OR fixVersion, fetch gate dates, fetch Feature/Initiative titles for NAI, call NAI, render 4 HTML + _verify JSON + CORRECTIONS.md
3. QA: live JQL verification per mdc:206 (no bundle-only), exhaustive tests (headers, id="kpi-matrix", issuetype, Integrated Version, target="_blank", totals match verify JSON)
4. JIRA Query Check: every number has verifiable JIRA link with target="_blank" rel="noreferrer"
```

## Core Rules

### 1. Count sources are live JQL, never bundle cache alone (D10, mdc:206)
- Feature: `fixVersion = "VER" AND issuetype = Feature` — live `GET /rest/api/2/search?jql=<enc>&maxResults=0 -> total` (NDB-2.10=12, 2.11=16, 2.12=10 at 2026-11-13T14:35Z)
- Initiative: `fixVersion = "VER" AND issuetype = Initiative` (NDB-2.10=13, 2.11=11, 2.12=8)
- Filter audit column optional: `filter="VER-All" AND issuetype = Feature` (shows scope drift NDB-2.10 12 vs 12, 2.11 16 vs 16, 2.12 10 vs 10 for Features; Initiative audit 13 vs 15 for 2.10 drift documented)
- Commit set (optional): `fixVersion="VER" AND issuetype in (Feature, Initiative) AND status != Cancelled` (22/25/18) and POR `AND labels not in ("ndb-not-por")` (20/23/14) per `server/utils/jiraQueryUtils.js:buildCommitItemsJQL`
- NEVER ship counts from `shared/.cache/release-dataset/ndb/bundle.json` without live re-verification — old counts 518/316 were stale (lastSync 2026-07-07) and retracted

### 2. KPI closed JQL is the hard-won correction (D30/D31, mdc:206)
- Correct KPI JQL (Correction #1 + #4 + #4b): `filter="VER-All" AND (KPI baseQuery normalized) AND status = Closed AND ("Integrated Version" = "VER" OR fixVersion = "VER")`
- Field is `"Integrated Version"` = `customfield_11360` (quoted name, not `customfield_11360` nor `cf[11360]` which is illegal JQL), with `OR fixVersion` fallback for legacy versioning (NDB-2.10 Criticals: fixVersion-only 338 → Integrated-only 251 → OR 365)
- Normalize `type=` → `issuetype=` before JQL (kpiConfig.json has 3 `type=Bug/CVE` — flagged Blocking)
- 13 NDB KPIs in order: Top-CFI, Top-CFD, Non-Top-CFI, Non-Top-CFD, Product Blockers, Product Criticals, OnCalls, System Test, Smokes, NDB PreCommits, CVE, Deferral, Bugs Out of SLA — verified totals at 2026-11-13T14:35Z: NDB-2.10 **1365** (3,19,10,57,97,365,0,0,39,1,10,764,0), NDB-2.11 **2131**, NDB-2.12 **481** (see `_verify-2026-11-13-jql-totals.json`)
- Feature/Initiative planning counts stay `fixVersion`-based; only KPIs use Integrated Version OR fixVersion

### 3. Gate Gantt is config-driven, EC = Execute Commit (D15, mdc correction #5)
- Gates from `apps/delivery-ops/server/config/releaseVersionsEmailConfig.json` `releaseGateDates[VER]`: ecDate, ccm1/2Gate, commitGate1/2, promotionGate1/2/3, ga1..4, conceptCommit1/2 (soft)
- EC label is **Execute Commit** (not Early Commitment) per user clarification 2026-11-13 — fixed in `shared/src/services/gateTimelineService.ts` KIND_LABELS and `scripts/lighthouse/reports/generate-past-release-report.mjs:parseGates`
- Gate name glossary: EC=Execute Commit, CCM=Code Complete Milestone, CG=Commit Gate, PG=Promotion Gate, GA=General Availability, SOFT=Concept Commit etc.
- Gantt uses `gateTimelineService.parseReleaseGateTimeline` visual language (solid=binding, dotted=soft checkpoint), shared axis for cross-release view; clamp pct to 0–98 to avoid negative ruler labels

### 4. 2D KPI matrix is a dedicated new section above Gantt
- Summary page has `<div id="kpi-matrix-section"><h2>KPI Closed — Cross-Release Matrix (Live, New Section)</h2>` + `<table id="kpi-matrix"><thead><tr><th>KPI</th><th>NDB-2.10</th><th>NDB-2.11</th><th>NDB-2.12</th>` — rows 13 KPIs, cols releases, each cell `<strong>count</strong><br><a href="...jql=...">Verify ↗</a>` with `target="_blank" rel="noreferrer"` opening in new tab
- Matrix must be **above** Cross-Release Gantt per move request (2026-11-13)
- Per-release pages have `<div id="kpi-matrix-per-release">` linking to summary matrix `Summary → KPI Matrix ↗` + per-release KPI detail table (13 rows, verification JQL column)

### 5. NAI capability grouping at beginning of page (D8, D9)
- Fetch all Feature/Initiative titles for each release via JQL `filter="VER-All" AND issuetype in (Feature, Initiative) AND ("Integrated Version"="VER" OR fixVersion="VER")` (68 titles across 3 releases: 25/25/18)
- Pass titles to NAI (corp gateway `https://tokens.corp.nutanix.com/enterpriseai/gateway/v1`, model `beam-1-501b`, 8192 max_tokens) with prompt asking hybrid grouping: primary capability area (Upgrade, Provisioning, HA/DR, Backup/Restore, Security, Migration/Upgrade, Platform, Storage, Observability, Integration, Networking) or secondary DB Engine/platform (PostgreSQL, MySQL, SQL Server, MongoDB, Oracle, On-Prem/NC2/GCP/Azure/Hybrid)
- Output JSON `reports/nai-capability-summary.json` with `overall` (2-3 sentences starting "In the last year, NDB delivered..."), `groups` (10 groups with one-liners ≤15 words), `perRelease` summaries (1-2 sentences each starting "In NDB-2.x, we ...")
- Render at beginning of summary `id="capability-overview"` and per-release `id="capability-VER"` — before At-a-Glance; include per-release lens linking to overall

### 6. Slide-deck files per release (D15d three renderers)
- Generator `scripts/lighthouse/reports/generate-past-release-report.mjs` (live-verified edition, 14:35Z) writes:
  - `NDB-2.10-Report.html` (28K, 12F·13I, 1365 KPI hits, 9 gates)
  - `NDB-2.11-Report.html` (28K, 16F·11I, 2131, 11 gates)
  - `NDB-2.12-Report.html` (28K, 10F·8I, 481, 10 gates, in-flight GA 2026-11-30 banner)
  - `NDB-Past-Releases-Summary.html` (48K, capability overview + executive summary + KPI matrix + cross-release Gantt)
  - `_verify-2026-11-13-jql-totals.json` (live JQL + totals + timestamp)
  - `nai-capability-summary.json` (NAI grouped capabilities)
  - `CORRECTIONS.md` (#1 fixVersion, #2 type→issuetype, #3 ternary, #4 Integrated Version, #4b OR fixVersion, #5 EC label)
- Zip via `zip -j NDB-Past-Releases-Reports-YYYY-MM-DD.zip NDB-*-Report.html NDB-Past-Releases-Summary.html _verify*.json nai-capability-summary.json CORRECTIONS.md` (148K → 30K)
- Finder `open .` for handoff

### 7. Exhaustive tests are mandatory before DONE (mdc:206, CORRECTIONS.md:64)
- File: `apps/delivery-ops/tests/past-release-report.test.js` checks: headers NDB-2.10/2.11/2.12, table `id="kpi-matrix"`, 13 KPI rows in order, every cell JQL contains `"Integrated Version"` + `issuetype` + `status=Closed` + `OR fixVersion`, every Jira link `target="_blank" rel="noreferrer"`, displayed totals match `_verify` JSON at timestamp
- Run `node apps/delivery-ops/tests/past-release-report.test.js` — 18/18 PASS required; QA stage fails if bundle-only or fixVersion-only JQL
- Also verify: Gantt present, no localhost/secrets, print CSS (`@media print` + `page-break-inside:avoid`), responsive `@media(max-width:800px)`, EC label correct

## Tool Contract

```
Generator: scripts/lighthouse/reports/generate-past-release-report.mjs
  - Reads: releaseVersionsEmailConfig.json (gates), kpiConfig.json (13 KPIs), jiraConfig.json (baseUrl), nai-capability-summary.json (NAI groups)
  - Writes: reports/NDB-*.html + _verify JSON
  - Helpers: parseGates() via gateTimelineService visual language, ganttHtml(), gateTable(), renderNaiGroups(), renderNaiOverall(), renderNaiPerRelease()

Live verification:
  JQL: filter="VER-All" AND (KPI) AND status=Closed AND ("Integrated Version"="VER" OR fixVersion="VER")
  curl: GET /rest/api/2/search?jql=<enc>&maxResults=0 -> total (JIRA_PAT from server/.env)
  Evidence: _verify JSON with verifiedAt, jiraBase, method, releases{feature, initiative, kpiClosed{totals}}
  Evidence check: grep -c '"Integrated Version" OR fixVersion' reports/*.html == 39 matrix + 39 detail

NAI:
  Fetch: filter="VER-All" AND issuetype in (Feature, Initiative) AND ("Integrated Version"="VER" OR fixVersion="VER") -> titles
  Call: POST https://tokens.corp.nutanix.com/enterpriseai/gateway/v1/chat/completions {model:beam-1-501b, max_tokens:8192, temperature:0.2, messages:[system + user prompt with all 68 titles grouped]}
  Save: reports/nai-capability-summary.json -> rendered at beginning of pages
```

## Output Format

### Summary page (NDB-Past-Releases-Summary.html)
```html
<div id="capability-overview">What We Delivered — In the Last Year (NAI Summarised, Grouped)
  <p><strong>In the last year, NDB delivered 68 features...</strong></p>
  <groups grid 10 groups: Provisioning (3), HA/DR (9), Backup/Restore (4), Security (9), Migration/Upgrade (6), Platform (16), Storage (7), Observability (4), Integration (4), Networking (6)>
  <Per-Release Lens: NDB-2.10 summary ↗, NDB-2.11 summary ↗, NDB-2.12 summary ↗>
</div>
<div>Executive Summary — 3 Past Releases (Live at VERIFIED_AT) — table Release | Features | Initiatives | Commit Set | KPI Closed Sum | Report
<div id="kpi-matrix-section"><h2>KPI Closed — Cross-Release Matrix (Live, New Section)</h2><table id="kpi-matrix"><thead><tr><th>KPI</th><th>NDB-2.10</th><th>NDB-2.11</th><th>NDB-2.12</th> — 13 rows, each cell count + Verify ↗ (target blank)
<div>Cross-Release Gantt — EC=Execute Commit, CCM, CG, PG, GA on shared axis (below matrix)
```

### Per-release page (NDB-2.10-Report.html etc.)
```html
<div id="capability-NDB-2.10">What We Delivered in NDB-2.10 — Capability Summary (NAI Grouped)
  <p><strong>In NDB-2.10, we expanded MongoDB...</strong></p> — 12F·13I=25 items grouped same taxonomy
<div>At a Glance — Features 12, Initiatives 13, Commit 22 (20 POR), KPI sum 1365, narrative (Execute Commit)
<div>Release Gantt — 9 gates EC Execute Commit etc.
<div>KPIs Closed — 13 NDB KPIs (Live at VERIFIED_AT) — table KPI | Closed | Verification JQL (filter+KPI+Closed+Integrated OR fixVersion) — 13 rows with Verify ↗
```

## Quality Validation

- [ ] Live JQL at VERIFIED_AT for every count (not bundle) with JQL + total + timestamp in _verify JSON
- [ ] Feature: fixVersion="VER" AND issuetype=Feature — 12/16/10; Initiative: 13/11/8 — matches live
- [ ] KPI: 13 rows × 3 cols =39 cells, each JQL contains "Integrated Version" (cf11360) OR fixVersion + issuetype + status=Closed, totals 1365/2131/481 match live (not 1682/2528/534 stale, not 946/1280/321 Integrated-only)
- [ ] Every Jira link has target="_blank" rel="noreferrer" opening in new tab (48 summary + 9 per detail, 0 missing) — verified via grep
- [ ] 2D matrix is new dedicated section id="kpi-matrix-section" above Gantt (not below) with table id="kpi-matrix" and headers NDB-2.10/2.11/2.12
- [ ] EC label is Execute Commit (not Early Commitment) in Gantt and gate table (3 occurrences)
- [ ] NAI capability summary at beginning of every page: overall 68 features grouped 10 groups, per-release summaries starting "In the last year..." and "In NDB-2.x, we ..."
- [ ] Gantt per release 9/11/10 gates (EC/CCM/CG/PG/GA) on shared axis, clamp pct 0-98, print CSS, responsive
- [ ] Exhaustive tests pass: tests/past-release-report.test.js 18/18 — headers, id, rows, Integrated Version OR fixVersion, issuetype, target blank, totals match verify
- [ ] No secrets/PAT in HTML (footer says "JIRA PAT-verified" not raw token), no localhost, file sizes <30K per detail, no type= JQL

