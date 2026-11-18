---
report_type: LLD
module: Release Dataset & Sync Pipeline
version: "2.0"
generated: 2026-08-04
status: current
---

# Low-Level Design: Release Dataset & Sync Pipeline

---

## 1. Overview

The Release Dataset is the platform's single source of truth for JIRA data. It is a pre-fetched, disk-cached JSON bundle. Pages read from cache; the Portfolio Manager manually triggers syncs. This avoids repeated JIRA API calls per page view and provides fast page loads even with 500+ tickets per release (D11).

---

## 2. Two Payload Concepts (D36)

| Concept | JQL Scope | Used by |
|---|---|---|
| **Engineering Payload** | `project = ERA AND (6-bucket union)` | Sprint report, KPI, team-scoped views |
| **Release Payload** | `(6-bucket union)` — no project filter | Release status, retrospective, feature dashboard |

---

## 3. The 6 Buckets (Group 1 — Committed)

| Bucket | JQL Pattern |
|---|---|
| `top_level_projects` | `fixVersion={release} AND status not in (Cancelled, Backlog) AND issueType in (Feature, Initiative, Epic, X-FEAT, Capability)` |
| `epics_of_projects` | `portfolioChildrenOf({top_level_projects_JQL}) AND issueType = Epic` |
| `work_toward_project` | `issuesInEpics({epics_of_projects_JQL})` |
| `standalone_epics` | `type=Epic AND fixVersion={release} AND "Parent Link" is EMPTY` |
| `work_toward_standalone_epic` | `issuesInEpics({standalone_epics_JQL})` |
| `direct_tickets` | `issueType not in (Feature, Initiative, Epic, X-FEAT, Capability) AND (fixVersion was {release} OR fixVersion={release} OR affectedVersion={release}) AND "Epic link" is EMPTY` |

**Group 2 (Moved Out):** `fixVersion was {release} AND fixVersion not in ({release})`
**Group 3 (Long-term Funded):** items with label `{release}-long-term-funded`

> ⚠️ JQL edit approval required (jql-edit-approval rule): no bucket JQL may be changed without showing a before/after diff and receiving explicit approval.

---

## 4. Cache Structure on Disk

```
shared/.cache/release-dataset/
└── {productId}/                       e.g., "ndb"
    ├── bundle.json                    Union of all active releases
    ├── bundle.meta.json               { lastSynced, releaseCount, bucketCounts }
    └── per_release/
        ├── {release}.json             e.g., NDB-2.12.json
        └── {release}.meta.json        { lastSynced, ticketCount, buckets }
```

### 4.1 bundle.json Top-Level Structure

```json
{
  "productId": "ndb",
  "releases": {
    "NDB-2.12": {
      "committed": [ ...ticket objects ],
      "longTermFunded": [ ...ticket objects ],
      "movedOut": [ ...ticket objects ],
      "bucketCounts": {
        "top_level_projects": 18,
        "epics_of_projects": 47,
        "work_toward_project": 312,
        "standalone_epics": 5,
        "work_toward_standalone_epic": 89,
        "direct_tickets": 23
      }
    }
  }
}
```

### 4.2 Ticket Object (56 Canonical Fields)

```json
{
  "key": "ERA-66381",
  "summary": "...",
  "issueType": "Feature",
  "status": "In Progress",
  "resolution": "Unresolved",
  "assignee": "user.name",
  "qaContact": "qa.user",
  "tpmOwner": "tpm.user",
  "pmOwner": "pm.user",
  "testLead": "test.user",
  "guiLead": "gui.user",
  "codeCompleteDate": "2026-09-15",
  "commitGateDate": "2026-10-01",
  "promotionGateDate": "2026-10-15",
  "dueDate": null,
  "sprintId": 1234,
  "sprintName": "S24",
  "storyPoints": 8,
  "riskIndicator": "Yellow",
  "statusUpdate": "ADF content...",
  "execStatusUpdate": "extracted summary...",
  "requirementsLink": "https://...",
  "designDocLink": "https://...",
  "testPlanLink": "https://...",
  "tcmsLink": "https://...",
  "labels": ["NDB-2.12-mustfix"],
  "parentKey": "FEAT-16821",
  "fixVersions": ["NDB-2.12"],
  "affectedVersions": []
}
```

---

## 5. Sync Pipeline

### 5.1 Full Sync

```
POST /api/release-dataset/sync { productId }

releaseDatasetService.syncBundle(productId):

  1. Load product config: gate dates, active releases list
  2. For each active release:
     a. For each of 6 buckets:
        i.  Build JQL (jiraQueryUtils.buildBucketJQL)
        ii. jiraConnector.searchAll(jql) → paginate until all pages done
        iii. Transform tickets (56-field mapping)
        iv. Emit SSE progress event: { release, bucket, count, percent }
     b. Also fetch Group 2 (moved-out) and Group 3 (long-term-funded)
     c. Write per_release/{release}.json + .meta.json
  3. Merge all releases into bundle.json + bundle.meta.json
  4. Emit SSE done event: { totalTickets, releases, elapsed }
```

### 5.2 Cell-Level Sync

```
POST /api/release-dataset/sync/bucket { productId, release, bucket }

Same pipeline but for one release × one bucket only.
Merges result back into bundle.json without touching other releases.
```

### 5.3 SSE Event Format

```javascript
// Progress event
data: { "type": "progress", "release": "NDB-2.12", "bucket": "work_toward_project", "count": 312, "percent": 45 }

// Done event
data: { "type": "done", "totalTickets": 894, "elapsed": 42000 }

// Error event
data: { "type": "error", "release": "NDB-2.12", "bucket": "epics_of_projects", "message": "JIRA 429 after 3 retries" }
```

---

## 6. Changelog Pagination (Critical Path)

The JIRA changelog API paginates when a ticket has more history entries than the default limit. Silent truncation causes incorrect Gantt charts. Three-strategy fallback prevents data loss:

```
Strategy 1: maxResults=total
  GET /rest/api/2/issue/{key}?expand=changelog&maxResults={changelog.total}
  Attempt to get everything in one call.
  → If histories.length < total: fall through to Strategy 2.

Strategy 2: Issue ID endpoint
  GET /rest/api/2/issue/{issueId}/changelog?startAt=X&maxResults=100
  Loop: startAt += 100 until startAt >= total.
  Requires issue.id from initial fetch.
  → If fails: fall through to Strategy 3.

Strategy 3: Multiple expand calls
  Iterative calls with increasing maxResults until stable.
  Least efficient; last resort.

All strategies fail:
  Return partial data with warnings[].
  Never block page render or throw unhandled error.
```

**Rate control between pagination calls:** 500ms delay.
**Per-call timeout:** 30 seconds.
**Known test case:** `FEAT-18452` (has paginated changelog; use for regression testing).

---

## 7. API Endpoints (`/api/release-dataset/*`)

| Method | Path | Description |
|---|---|---|
| GET | `/releases` | List all synced releases with metadata |
| GET | `/per-release/:release` | Full bundle for one release from disk |
| GET | `/synopsis` | 5-bucket count-only query (live JIRA, fast) |
| GET | `/velocity` | Sprint velocity (3 streams) — cache-first on trunk |
| GET | `/forecast` | Landing date forecast + confidence — cache-first on trunk |
| GET | `/gates` | Gate dates from config |
| GET | `/outstanding` | Open issues bucketed by severity |
| GET | `/project-status` | Per-project issue-group breakdown matrix |
| GET | `/burndown` | Cumulative closed-issue burndown over time |
| GET | `/retrospective` | Full gate compliance analysis (live JIRA) |
| GET | `/retrospective/bootstrap` | Fast gate-check summary from bundle |
| GET | `/retrospective/projects` | Paginated naughty list |
| GET | `/retrospective/project/:key` | Per-project violation detail |
| GET | `/sync-status` | Bundle + per-release cache metadata |
| DELETE | `/cache` | Wipe bundle cache |
| POST | `/sync` | Full SSE-streamed sync for a product |
| POST | `/sync/bucket` | Cell-level sync (one bucket × one release) |
| POST | `/backfill-meta` | One-time meta migration |

---

## 8. Sprint Velocity Calculation

Three streams per sprint — never collapse:

| Stream | Filter | Measurement |
|---|---|---|
| **Dev** | `issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, Test)` | Story points or count |
| **QA-Verification** | `issueType in (Bug, Improvement) AND status changed to Closed during sprint window` | `count × 0.33` (adjusted; 1:3 ratio; not story points) |
| **QA-Test Tasks** | `issueType = Test` | Story points or count |

**Sprint boundaries:** 3-week Wednesday cadence; S1 starts 2024-10-09.
**Sprint chart ordering:** extract `S(\d+)` → sort numerically → use sorted names as `category_orders`. Never rely on alphabetical sort (produces S1, S10, S11, S2… — wrong).

---

## 9. Issue Type Groups

| Group | Issue Types | Velocity treatment |
|---|---|---|
| Project Hierarchy | Feature, Initiative, Epic, X-FEAT, Capability | Excluded from velocity |
| Bug | Bug | Dev velocity |
| Improvement | Improvement | Dev velocity |
| Dev Code | Task, Unit Test | Dev velocity |
| Test | Test | QA-Test Tasks velocity |
| Everything Else | All others | Dev velocity (default) |
