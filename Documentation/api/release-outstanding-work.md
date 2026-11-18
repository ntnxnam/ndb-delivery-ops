# Release Outstanding Work API

Legacy mount `/api/deferral-workbench` serves the same router (compat alias).

### GET /api/release-outstanding-work/workbench

**Purpose**: Load deferral candidates, awaiting-deferral queue, and must-fix list for a release.

**Auth**: required (`releaseVersions`)

**Request**
- Query: `teamId` (string), `release` (string, required)

**Server flow**
Route → `releaseOutstandingDeferralService.getWorkbench` → JIRA search + version list + optional changelog for must-fix authors

**Response shape**
```json
{
  "success": true,
  "data": {
    "release": "NDB-2.12",
    "labels": { "deferred": "ndb-2.12-deferred", "mustFix": "ndb-2.12-mustfix" },
    "jql": { "needsJustification": "...", "candidates": "...", "awaitingDeferral": "...", "mustFix": "..." },
    "needsJustification": [{ "key": "ERA-72362", "missingJustification": true, "justificationQueueScope": "leftRelease", "lastComment": { "author": "…", "body": "…", "age": "2d ago" } }],
    "candidates": [{ "key": "ERA-1", "deferralJustification": "…", "canMove": true, "targetExists": true, "rulebook": {}, "lastComment": null }],
    "awaitingDeferral": [{ "key": "ERA-3", "deferralJustification": "…", "lastComment": { "author": "…", "body": "…", "age": "1h ago" } }],
    "mustFix": [{ "key": "ERA-2", "mustFixOrg": "QA", "mustFixAuthor": "…", "needsStatusUpdate": true, "lastActivityAge": "14h ago", "statusStaleHours": 12 }],
    "orgCounts": { "QA": 1, "Serv": 0, "PM": 0, "Other": 0 }
  }
}
```

**Caching**: No

---

### POST /api/release-outstanding-work/move

**Purpose**: Set issue fixVersion to rulebook target (P0/P1 → next dot; else next major). Fails if target version missing.

**Auth**: required

**Request body**: `{ teamId, release, issueKey }`

**Error**: `409` with `code: TARGET_VERSION_MISSING` when target not created

---

### POST /api/release-outstanding-work/defer

**Purpose**: Add `{release}-deferred` label.

**Request body**: `{ release, issueKey }`

---

### POST /api/release-outstanding-work/mustfix

**Purpose**: Add `{release}-mustfix` and remove that same release’s `{release}-deferred` only (other releases’ deferred labels stay).

**Request body**: `{ release, issueKey, comment? }`

---

### POST /api/release-outstanding-work/comment

**Purpose**: Post a free-form JIRA comment from the workbench. Always opens with `Hi [~assignee],` when assignee exists, and appends `cc` Dev/QA DRIs for `release` plus `commentAlwaysCc` from `releaseOutstandingWorkConfig.json`.

**Auth**: required (`releaseVersions`)

**Request body**: `{ release, issueKey, comment }` (`release` used for DRI resolution)

**Response shape**
```json
{
  "success": true,
  "data": {
    "key": "ERA-72362",
    "commented": true,
    "lastComment": { "author": "You", "body": "…", "created": "…", "age": "just now" }
  }
}
```

---

### POST /api/release-outstanding-work/chase-justification

**Purpose**: When Deferral Justification is empty, post a JIRA comment tagging assignee and Assignee Manager (`customfield_19262`), plus Dev/QA DRIs and always-CC (`namratha.singh`). Used on the **Justification** queue only — not Must-fix.

**Auth**: required (`releaseVersions`)

**Request body**: `{ release, issueKey }` (`release` used in comment text and DRI CC)

**Server flow**
Route → `releaseOutstandingDeferralService.chaseMissingJustification` → getIssue → addComment

**Response shape**
```json
{
  "success": true,
  "data": {
    "key": "ERA-1",
    "commented": true,
    "tagged": {
      "assignee": "Ada",
      "assigneeManager": "Grace",
      "cc": ["akshay.chandak", "srikanth.cg", "namratha.singh"]
    }
  }
}
```

**Error responses**
| HTTP | When |
|---|---|
| 400 `NO_MENTION_TARGETS` | No assignee and no Assignee Manager |
| 409 `JUSTIFICATION_PRESENT` | Field already filled |

---

### POST /api/release-outstanding-work/chase-status-update

**Purpose**: Must-fix only — when last activity (comment / `updated`) is older than `mustFixStatusStaleHours` (default 12), post a JIRA comment asking for a status update. Tags assignee + Assignee Manager; CCs Dev/QA DRIs + `commentAlwaysCc`. Does **not** ask for deferral justification.

**Auth**: required (`releaseVersions`)

**Request body**: `{ release, issueKey }`

**Server flow**
Route → `releaseOutstandingDeferralService.chaseMustFixStatusUpdate` → getIssue + comments → addComment

**Response shape**
```json
{
  "success": true,
  "data": {
    "key": "ERA-1",
    "commented": true,
    "needsStatusUpdate": false,
    "lastStatusNudgeAt": "…",
    "tagged": {
      "assignee": "Ada",
      "assigneeManager": "Grace",
      "cc": ["akshay.chandak", "srikanth.cg", "namratha.singh"]
    }
  }
}
```

**Error responses**
| HTTP | When |
|---|---|
| 400 `NO_MENTION_TARGETS` | No assignee and no Assignee Manager |
| 409 `NOT_MUSTFIX` | Issue missing `{release}-mustfix` label |
| 409 `NOT_STALE` | Activity within the stale window |

---

### GET /api/release-outstanding-work/outstanding

**Purpose**: Load outstanding-work buckets — headline (Dev open / Must-fix) + Dev / Test / KPI heroes (Task·Bug·CVE·other / Verification·Test open / Regression·System-Test·CFI-CFD) + By-project chips + hygiene strip.

**Auth**: required (`releaseVersions`)

**Request**
- Query: `teamId` (string), `release` (string, required)

**Server flow**
Route → `outstandingWorkbenchService.getOutstandingBuckets` → JIRA `searchCount` + one-page sample per bucket; By-project discovery via `(All OR fixVersion) AND statusCategory != Done` excluding home + FEAT

**Response shape**
```json
{
  "success": true,
  "data": {
    "release": "NDB-2.12",
    "story": "65 Dev open (15 must-fix) · 12 awaiting verification · 18 Test open · 7 hygiene",
    "buckets": {
      "toBeResolved": { "id": "toBeResolved", "label": "Awaiting Verification", "count": 12, "jql": "…", "sample": [] },
      "dev": { "count": 65, "mustFixCount": 15, "jql": "…deferred excluded…", "sample": [] },
      "devTasks": { "count": 20, "jql": "…", "sample": [] },
      "devBugs": { "count": 30, "jql": "…", "sample": [] },
      "devCve": { "count": 5, "jql": "…", "sample": [] },
      "devOther": { "count": 10, "jql": "…", "sample": [] },
      "qa": { "count": 18, "jql": "…", "sample": [] },
      "regressionProduct": { "count": 9, "mustFixCount": 2, "mustFixJql": "…", "jql": "…filter=ndb-product-regressions…", "sample": [{ "key": "ERA-1", "isMustFix": true, "qaContact": "…", "affectedVersions": ["NDB-2.12"], "fixVersions": ["NDB-2.12"], "labels": ["…-mustfix"], "components": ["…"], "dueDate": "2026-12-01", "created": "2026-10-30T…" }] },
      "regressionTest": { "count": 4, "mustFixCount": 0, "jql": "…filter=ndb-test-regressions…", "sample": [] },
      "systemTest": { "count": 6, "mustFixCount": 1, "jql": "…filter=NDB-System-Test…", "sample": [] },
      "mustFixRegressionProduct": { "count": 2, "jql": "…", "sample": [] },
      "mustFixRegressionTest": { "count": 0, "jql": "…", "sample": [] },
      "mustFixSystemTest": { "count": 1, "jql": "…", "sample": [] },
      "mustFix": { "count": 15, "jql": "…labels=…-mustfix AND fixVersion = \"NDB-2.12\"…", "sample": [] }
    },
    "hygiene": {
      "hyDeferredOnRelease": { "count": 3, "jql": "…" },
      "hyOnMaster": { "count": 2, "jql": "…" },
      "hyDeferredWrongTarget": { "count": 1, "jql": "…" },
      "hyMustFixWrongFv": { "count": 1, "jql": "…" }
    },
    "byDiscipline": {
      "TECHPUBS": { "projectKey": "TECHPUBS", "label": "TECHPUBS", "count": 4, "jql": "…" }
    },
    "meta": { "hygieneTotal": 7, "nextDot": "NDB-2.12.1", "nextMajor": "NDB-3.0" },
    "jql": { "toBeResolved": "…", "dev": "…", "mustFix": "…", "hyDeferredOnRelease": "…" }
  }
}
```

**Caching**: No

---

### POST /api/release-outstanding-work/outstanding-report

**Purpose**: Preview or send outstanding-work exec email — hero cards + JIRA links only.

**Auth**: required (`releaseVersions`)

**Request body**: `{ teamId, release, to?: string[], cc?: string[], previewOnly?: boolean }`

**Server flow**
Route → `outstandingWorkbenchService.previewOrSendOutstandingReport` → (optional) `getOutstandingBuckets` → HTML (headline + Dev / Test / KPI hero rows + MUST FIX / CVE / REGRESSION / SYSTEM TEST / CFI-CFD ticket tables) → `emailService.sendEmailDirect` when not preview. CC is server-owned (current DRIs + ndb-tech-leads@ + ndb-managers@).

**Response shape**
```json
{
  "success": true,
  "data": {
    "preview": true,
    "subject": "NDB-2.12 - outstanding work - post PG gate report - 2026-11-04",
    "to": ["ndb-exec-updates@nutanix.com"],
    "cc": ["…dri…", "ndb-tech-leads@nutanix.com", "ndb-managers@nutanix.com"],
    "html": "<div>…hero cards + ticket tables…</div>",
    "story": "…"
  }
}
```

**Error responses**
| HTTP | When |
|---|---|
| 400 | missing release / empty To on send |
