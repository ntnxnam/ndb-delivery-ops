# Corrections Log — Past Release Report (Live Jira-Verified)

**Date:** 2026-11-13T02:48:00Z → corrected 2026-11-13T12:40:00Z
**Report:** NDB-2.10 / NDB-2.11 / NDB-2.12 — Feature/Initiative/KPI/Gantt slide-deck
**Generator:** `scripts/generate-past-release-report.mjs`
**Evidence:** `apps/delivery-ops/reports/_verify-2026-11-13-jql-totals.json` (updated)

## Correction #1 — Missing `fixVersion` in KPI JQL (CRITICAL)

**Reported by:** user correction — `filter="NDB-2.10-All" AND (...) AND status=Closed and fixversion=NDB-2.10`
**Example given:** `Product Criticals: project=ERA and priority="Critical - P1" and issuetype=Bug`

**Mistake:** All 13 KPI JQLs used `filter="VER-All" AND (KPI) AND status=Closed` without explicit `AND fixVersion="VER"`.

**Impact:** `filter="VER-All"` is a saved filter that overlaps but does not strictly equal `fixVersion="VER"` scope. Without `fixVersion`, KPI counts include linked work from other releases that share the filter scope, inflating totals:
- NDB-2.10 Product Criticals: 507 (without fixVersion) → 338 (with fixVersion) delta 169
- NDB-2.11 Product Criticals: 765 → 584 delta 181
- NDB-2.12 Product Criticals: 281 → 241 delta 40

**Root cause:** Assumed base filter already implied fixVersion; did not cross-check `releaseVersionsColumnsConfig.json` + `getReleaseBaseFilter()` semantics.

**Fix applied:** Every KPI JQL now: `filter="VER-All" AND (KPI baseQuery normalized) AND status=Closed AND fixVersion="VER"` — verified live at 2026-11-13T12:40Z, totals updated in `LIVE_KPI_CLOSED`.

**Prevention — checklist for all future queries:**
1. For any release-scoped KPI, JQL MUST contain explicit `fixVersion="VER"` (quoted, exact) in addition to `filter="VER-All"` base filter.
2. Normalize `type=` → `issuetype=` before execution (Jira alias, flagged as Blocking in QA).
3. Execute live via `GET /rest/api/2/search?jql=<enc>&maxResults=0` and compare `total` to displayed count — delta 0 required, timestamp cited.
4. For all other report queries (Feature/Initiative/commit set), audit: `fixVersion="VER" AND issuetype=Feature` etc. already correct; verify via filter audit dual-check.
5. Record verification JSON with JQL + total + timestamp for every displayed number; never ship cache-only counts.

## Correction #2 — JQL alias `type=` vs `issuetype=`

**Mistake:** Original `kpiConfig.json` contains `type=Bug`/`type=CVE` (3 occurrences). Previous generator reproduced verbatim.
**Fix:** Normalize via `.replaceAll('type=','issuetype=')` before execution and in displayed JQL links. Flag `type=` as Blocking in QA per `multi-agent-delivery-pipeline.mdc:206`.

## Correction #3 — Stat-card ternary bug

**File:** `scripts/generate-past-release-report.mjs:144` — `Via filter: ${i.viaFilter===f.viaFilter?f.viaFilter:f.viaFilter}` always returned `f.viaFilter`.
**Fix:** Direct `f.viaFilter` / `i.viaFilter` separately; removed dead ternary.

## Correction #4 — Integrated Version field 11360 (customfield_11360)

**Reported:** Integrated version custom field number is 11360 — use `"Integrated Version"` (cf11360) for KPIs, not `fixVersion`.

**Mistake:** Previous KPI JQLs used `AND fixVersion="VER"` after Correction #1. Correct field for KPI closed counts is the integrated-version field, not fixVersion. JQL field is `"Integrated Version"` (quoted), backed by `customfield_11360`, not `fixVersion`.

**Impact:** fixVersion vs Integrated Version yields different totals (fixVersion is commitment, Integrated Version is actually shipped/integrated):
- NDB-2.10 Product Criticals: fixVersion=338 → Integrated Version=251 delta 87
- NDB-2.11 Product Criticals: 584 → 346 delta 238
- NDB-2.12 Product Criticals: 241 → 183 delta 58

**Fix applied (2026-11-13T12:45Z):** Every KPI JQL now: `filter="VER-All" AND (KPI) AND status=Closed AND "Integrated Version"="VER"` — verified live via `GET /rest/api/2/search?jql=filter="VER-All" AND (KPI) AND status=Closed AND "Integrated Version"="VER"&maxResults=0`. Totals updated: NDB-2.10 sum 1319→946, NDB-2.11 2112→1280, NDB-2.12 475→323. Feature/Initiative counts remain `fixVersion`-based (per `jiraQueryUtils.js:buildCommitItemsJQL`), only KPIs use Integrated Version.

**Prevention:** For KPI closed counts, always use `"Integrated Version" = "VER"` (cf11360), not `fixVersion`. Feature/Initiative planning counts use `fixVersion`. Document field mapping in generator header and verification JSON.

## Correction #4b — Integrated Version OR fixVersion (2026-11-13T14:30Z)

**Reported:** User clarified correct KPI JQL is `("Integrated Version" = NDB-2.10 OR fixVersion = NDB-2.10)` — not Integrated Version alone.

**Mistake:** Correction #4 applied `AND "Integrated Version"="VER"` only, omitting `OR fixVersion="VER"` fallback. Some KPI tickets are versioned via fixVersion only (legacy), others via Integrated Version.

**Impact (verified live):**
- NDB-2.10 Product Criticals: Integrated only 251 → OR 365 (+114 legacy fixVersion-only)
- NDB-2.11: 346 → 599 (+253)
- NDB-2.12: 183 → 245 (+62)
- Totals: NDB-2.10 946→1365, NDB-2.11 1280→2131, NDB-2.12 321→414

**Fix applied (2026-11-13T14:30Z):** Every KPI JQL now: `filter="VER-All" AND (KPI) AND status=Closed AND ("Integrated Version"="VER" OR fixVersion="VER")` — 39 queries re-verified live, totals updated in verification JSON.

**Prevention:** KPI version clause MUST be `AND ("Integrated Version" = "VER" OR fixVersion = "VER")` to capture both versioning mechanisms. Audit: every KPI JQL must contain `Integrated Version` + `OR` + `fixVersion`.

## Audit of all other queries in report

- Feature counts: `fixVersion="VER" AND issuetype=Feature` — correct, live verified 12/16/10
- Initiative counts: `fixVersion="VER" AND issuetype=Initiative` — correct, 13/11/8
- Commit set: `fixVersion="VER" AND issuetype in (Feature,Initiative) AND status != Cancelled` + POR variant with `labels not in ("ndb-not-por")` — correct per `server/utils/jiraQueryUtils.js:14`, dual links present
- Gantt gates: config-driven from `releaseVersionsEmailConfig.json`, not JQL — no fixVersion needed, verified 9/11/10 gates
- All KPI JQLs now audited: 13×3 = 39 queries, each with `filter="VER-All"`, `issuetype`, `status=Closed`, `("Integrated Version"="VER" OR fixVersion="VER")` — verified live at 2026-11-13T14:30Z, totals 1365/2131/414 in verification JSON.

**Action for future reports:** Before declaring DONE, run exhaustive test suite (see `tests/past-release-report.test.js`) which checks: headers = NDB-2.10/2.11/2.12, rows = 13 KPIs, every cell JQL contains `"Integrated Version"` (cf11360) and `issuetype` and `status=Closed`, every link has `target="_blank" rel="noreferrer"`, and displayed totals match verification JSON at timestamp.

## Correction #5 — EC gate label (Execute Commit, not Early Commitment)

**Reported:** EC is "Execute Commit" (user clarification 2026-11-13; clarified before).

**Mistake:** Generator `scripts/generate-past-release-report.mjs:103` and `shared/src/services/gateTimelineService.ts:11,97,140` labeled EC as "Early Commitment" / "Early Commit".

**Impact:** Gantt gate label and gate table showed wrong gate name; senior exec would see incorrect gate (Early Commitment vs Execute Commit) for EC date (e.g., NDB-2.10 ecDate 2025-03-31, NDB-2.11 2025-12-09, NDB-2.12 2026-05-14).

**Fix applied (2026-11-13T12:55Z):** All EC labels changed to "Execute Commit" — `gateTimelineService.ts` KIND_LABELS EC, comment header, and `ecDate` push label; generator `parseGates` push label. Regenerated reports show EC = Execute Commit in Gantt.

**Prevention:** Gate acronym glossary for future reports: EC=Execute Commit, CCM=Code Complete Milestone, CG=Commit Gate, PG=Promotion Gate, GA=General Availability. Cross-check `releaseVersionsEmailConfig.json` gate keys and user clarifications before labeling.

---
*Recorded per user correction — to be checked on every future past-release report.*
