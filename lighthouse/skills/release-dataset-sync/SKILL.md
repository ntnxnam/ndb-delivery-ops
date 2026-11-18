---
name: release-dataset-sync
description: Manage the JIRA release dataset sync pipeline — 3-group/6-bucket fetch model, field validation, bundle rebuild, and SyncHubPage UI. Use when the user asks to sync data, refetch releases, add Group 2 (moved-out) or Group 3 (long-term funded) data, fix missing fields, update the field list, simplify the sync UI, or verify that hierarchy link fields (Portfolio Parent Key, Epic Link) are being returned by JIRA.
---

# Release Dataset Sync

## When to Use This Skill

- User asks to sync or refetch release data
- User asks about "moved out" tickets or hygiene analysis (Group 2)
- User asks about "long-term funded" or future-release work (Group 3)
- User asks about the 6-bucket model or `epics_of_projects`
- Parent link fields (`Portfolio Parent Key`, `Epic Link Key`) are null in the cache
- User asks what fields are being fetched
- User wants to verify or update `RELEASE_DATASET_FIELDS` in `releaseDatasetService.ts`
- User reports hierarchy reconstruction not working (epics not linking to features, tasks not linking to epics)

## Core Rules

1. **One sync operation** — fetch from JIRA + rebuild bundle is always one atomic action. Never expose bundle-only reset or per-release reset to end users.
2. **Every field must be named** — no field ID in `RELEASE_DATASET_FIELDS` without a comment naming it. Cross-reference with `jiraFieldsConfig.json`.
3. **Validate before assuming** — if hierarchy fields return null, verify the field IDs against JIRA's `/rest/api/2/field` endpoint before changing code.
4. **No `project = ERA` scope on any bucket fetch** — Features/Initiatives live in FEAT, docs in TECHPUBS, engineering in ERA. All bucket JQLs run cross-project (Release Payload, D36).
5. **Fetch uses indexed Parent Link / Epic Link** — `fetchReleaseData` does **not** execute ScriptRunner `portfolioChildrenOf` / `issuesInEpics`. Wave 1 loads features/standalone epics; Wave 2 is `"Parent Link" in (...)`; Wave 3 is `"Epic Link" in (...)`, chunked 75 keys. Click-through URLs in `getComponentQueries` may still use ScriptRunner.
6. **One JIRA search at a time** — never fan out `/search` or changelog `getIssue`. Parallel calls trip HTTP 429. Sequential with a short pause between searches.
7. **JQL-only for hyperlinks** — hierarchy reconstruction (epics→features, tasks→epics) is done in-memory from the flat cache. JQL strings are only generated for click-through URLs, never executed at serve time.
8. **Group 2 "hygienic vs needs cleanup" is in-memory** — the `moved_out` bucket is a single broad JQL. The distinction between a correctly-moved ticket and an orphaned one is computed from `Portfolio Parent Key` / `Epic Link Key` after the flat dump lands.
9. **Group 3 is non-fatal** — if the JIRA versions API fails, sync proceeds with Group 1 + 2 only. Never block a sync because future releases couldn't be determined.

## Complete Required Field List

`RELEASE_DATASET_FIELDS` in `shared/src/services/releaseDatasetService.ts` must contain ALL of these:

### Core identity (all issue types)
```
summary, issuetype, status, statusCategory, resolution,
resolutiondate, created, updated, fixVersions, labels,
components, priority, assignee
```

### Effort / velocity
```
customfield_10002   Story Points
```

### Date fields (per jira-date-hierarchy.mdc)
```
duedate             Epic Due Date
customfield_11067   Code Complete Date
customfield_35863   Commit Gate Ready Estimation Date
customfield_35864   Promotion Gate Ready Estimation Date
customfield_11068   Test Plan Date
customfield_13861   FS/DS Done Date
customfield_45660   Status Update Last Updated Date
```

### Hierarchy links — CRITICAL for in-memory reconstruction
```
parent              Immediate parent (sub-tasks, direct children)
customfield_20363   Portfolio Parent Link — Epic → FEAT/Initiative
customfield_10361   Epic Link — Task/Bug/Test → Epic (Nutanix field, NOT customfield_10017)
```

### People fields (Feature/Initiative level)
```
customfield_10860   QA Contact
customfield_27764   TPM Owner
customfield_11065   Test Lead
customfield_11861   GUI Lead
customfield_51460   Team Members
customfield_11260   PM Owner
```

### Content / indicators (Feature/Initiative level)
```
customfield_23073   Status Update
customfield_38460   Executive Status Update (ADF — use extractTextFieldValue)
customfield_23560   Risk Indicator
customfield_47780   Risk Assessment
customfield_55664   Path to Green
```

### Links (Feature/Initiative level)
```
customfield_14463   Link to Requirements
customfield_31460   TCMS Link
customfield_14464   Link to Design Doc
customfield_14465   Link to Test Plan
customfield_55662   Link to CG checklist
customfield_55663   Link to PG checklist
```

### Sprint (NDB board uses non-standard field)
```
customfield_10360   Sprint (NDB board — NOT customfield_10020)
```

## Field Validation — When Hierarchy Fields Return Null

If `Portfolio Parent Key` or `Epic Link Key` are null across all tickets after a fresh fetch:

**Step 1 — Verify the field IDs exist in this JIRA instance:**
```
GET https://jira.nutanix.com/rest/api/2/field
```
Search the response for `"name": "Epic Link"` and `"name": "Parent Link"`. Note their actual `id` values.

**Step 2 — Spot-check a known ticket:**
```
GET https://jira.nutanix.com/rest/api/2/issue/{ERA-XXXXX}?expand=names
```
Pick an Epic you know has a parent Feature. Check what field carries the parent key.

**Step 3 — Update `jiraFieldsConfig.json` if IDs are wrong:**
- `relationships.epicLink.id` — must match the actual Epic Link field ID
- `relationships.parentLink.id` — must match the actual Portfolio Parent Link field ID

**Step 4 — Update `RELEASE_DATASET_FIELDS` with corrected IDs, then force-refetch.**

## Fetch Model — 3 Groups, 6 Buckets

Every sync walks three waves (`FETCH_STRATEGY` = `indexed-parent-epic-v1`). Nested ScriptRunner is **not** executed at fetch time.

### Group 1 — Currently in release (6 disjoint buckets, no project filter)

| Bucket | `Components` tag | Fetch JQL (axios) |
|---|---|---|
| 1A | `top_level_projects` | `fixVersion={release} AND status not in (Cancelled,Backlog) AND issuetype in (Feature, Initiative)` |
| 1B | `epics_of_projects` | `issuetype = Epic AND "Parent Link" in (1A keys)` (chunked 75) |
| 2 | `work_toward_project` | `"Epic Link" in (1B keys)` (chunked 75) |
| 3 | `standalone_epics` | `type=Epic AND fixVersion={release} AND "Parent Link" is EMPTY` |
| 4 | `work_toward_standalone_epic` | `"Epic Link" in (3 keys)` (chunked 75) |
| 5 | `direct_tickets` | `(fixVersion = OR affectedVersion=) AND "Epic Link" is EMPTY AND not container` |

Direct Tickets no longer include `fixVersion was` — Group 2 `moved_out` owns that history. Counts for bucket 5 will drop vs the old catch-all; historical orphans appear only in Group 2.

Click-through URLs in `getComponentQueries` still use ScriptRunner `portfolioChildrenOf` / `issuesInEpics` for 1B / 2 / 4 so a JIRA hyperlink can run without collecting parent keys first.

### Group 2 — Moved out (1 broad query, classified in-memory)

| Bucket | `Components` tag | JQL pattern |
|---|---|---|
| — | `moved_out` | `fixVersion was {release} AND fixVersion not in ({release}) AND status not in (Cancelled)` |

**In-memory classification:** after fetch, each moved-out ticket's `issuetype` + `Portfolio Parent Key` + `Epic Link Key` determines which of the 6 bucket types it "was", and whether it's **hygienic** (parent was also moved) or **needs cleanup** (parent still in release).

### Group 3 — Long-term funded (3 buckets, requires `futureReleases`)

| Bucket | `Components` tag | Fetch JQL (axios) |
|---|---|---|
| 3A | `long_term_projects` | `issuetype in (Feature, Initiative) AND fixVersion in ({futureReleases}) AND status not in (Cancelled)` |
| 3B | `long_term_epics` | `issuetype = Epic AND "Parent Link" in (3A keys)` (chunked 75) |
| 3C | `long_term_work` | `"Epic Link" in (3B keys)` (chunked 75) |

`futureReleases` is determined at sync time by calling `jira.getProjectVersions(projectKey)` and filtering to unreleased, non-archived versions not in the active release set.

### Sidecars (label-based, NOT in the union)

`wishlist`, `deferred`, `long_term_funded` (label), `extension`

---

## Sync Flow (Single Operation)

```
1. Call jira.getProjectVersions(projectKey) → determine futureReleases for Group 3
2. Delete existing per-release cache files for target releases
3. Wave 1 (sequential, indexed): top_level_projects, standalone_epics, direct_tickets,
   moved_out, long_term_projects, sidecars
   Wave 2: epics_of_projects + work_toward_standalone_epic + long_term_epics
           via "Parent Link" / "Epic Link" IN (parent keys), chunked 75
   Wave 3: work_toward_project + long_term_work via "Epic Link" IN (epic keys)
   — no project scope on any bucket (Release Payload mode)
4. Within-release dedup: parents before children; Group 1 wins over Group 2/3
5. Changelog enrichment for Bug/Improvement/Test tickets (Closed Date, Last Resolved, Reopen Count)
6. Write fresh per-release .json files
7. Run processMaster() across all releases
8. Write bundle.json
```

**Server endpoint:** `POST /api/release-dataset/sync`
```json
{
  "productId": "ndb",
  "forceReleases": ["NDB-2.11"],
  "skipChangelog": false,
  "includeLongTermFunded": true
}
```

## SyncHubPage UI — Correct Shape

One action card only:

```
┌─ Sync Controls ──────────────────────────────────────┐
│ Force-refetch releases (blank = use cache for others) │
│ [ NDB-2.11, NDB-2.12 _____________ ]                  │
│                                                        │
│ [ ] Skip changelog enrichment (faster, less accurate) │
│                                                        │
│ [ ⟳  Sync Now ]                                       │
└────────────────────────────────────────────────────────┘
```

**Remove from user-facing UI:**
- "Reset Bundle" button — implementation detail
- "Full Reset" button — replaced by "Sync Now" with blank force list
- "Refresh from Disk" button — developer debug only, not for TPM/RM

## In-Memory Hierarchy Reconstruction

Once `Portfolio Parent Key` and `Epic Link Key` are non-null:

```javascript
// Build once from flatDump
const epicsByFeature = new Map();  // featureKey → Epic[]
const tasksByEpic = new Map();     // epicKey → Task[]

for (const ticket of flatDump) {
  if (ticket['Portfolio Parent Key']) {
    const k = ticket['Portfolio Parent Key'];
    if (!epicsByFeature.has(k)) epicsByFeature.set(k, []);
    epicsByFeature.get(k).push(ticket);
  }
  if (ticket['Epic Link Key']) {
    const k = ticket['Epic Link Key'];
    if (!tasksByEpic.has(k)) tasksByEpic.set(k, []);
    tasksByEpic.get(k).push(ticket);
  }
}

// JQL for hyperlinks only — never executed in code
const epicKeys = (epicsByFeature.get(featureKey) || [])
  .map(e => e['Issue Key']).join(',');
const cleanupJql = `"Epic Link" in (${epicKeys}) AND fixVersion = "${release}"`;
```

## Quality Validation

- [ ] All fields in the Required Field List are in `RELEASE_DATASET_FIELDS`
- [ ] Every field ID has a name comment in the code
- [ ] `jiraFieldsConfig.json` matches the IDs in `RELEASE_DATASET_FIELDS`
- [ ] After refetch, spot-check: `Portfolio Parent Key` and `Epic Link Key` non-null on Epic and Task tickets
- [ ] After refetch, spot-check: `moved_out` tickets appear in Components column of the cache
- [ ] After refetch, spot-check: `epics_of_projects` bucket has Epics whose parent is a Feature
- [ ] SyncHubPage has one `⟳ Sync Now` button — no reset/bundle split exposed
- [ ] Sync always clears forced per-release caches before writing fresh data
- [ ] Group 3 failure (versions API down) does not abort Group 1 + 2 sync
- [ ] No `project = ERA` or any project filter in any bucket JQL — all cross-project
