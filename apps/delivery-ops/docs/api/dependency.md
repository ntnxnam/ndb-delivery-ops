# Dependency API

Read-only dependency overview for Dependency View. No mutate endpoints.

---

### GET /api/dependency/overview

**Purpose**: Fetch partnership, companion, and train-label dependency sections for a team release, with clickable JQL and ask/committed classification.

**Auth**: required (JIRA token middleware)

**Request**
- Method + path: `GET /api/dependency/overview`
- Query params:
  - `teamId` (string, optional) — defaults to NDB via team board config
  - `release` (string, optional) — NDB fixVersion name; defaults from `dependencyViewConfig.defaultRelease`
- Body: none
- Headers: JIRA auth as used by other `/api/*` routes

**Server flow**
Route `routes/dependency.js` → `dependencyViewService.getOverview` → `runSearchByJql` (JIRA) + `dependencyViewConfig.json` + `releaseVersionsEmailConfig.json`

**Response shape**

```json
{
  "success": true,
  "teamId": "ndb",
  "release": "NDB-3.0",
  "jiraBaseUrl": "https://jira.nutanix.com",
  "asOf": "2026-10-08T12:00:00.000Z",
  "alignedTrain": { "train": "Kronos.1", "trainSlug": "kronos.1", "status": "aligned" },
  "ndbGates": {},
  "sections": {
    "partnershipBlockedBy": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "partnershipBlocks": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "trainLabels": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "companions": []
  },
  "releases": ["NDB-2.11", "NDB-2.12", "NDB-3.0", "NDB-3.1"]
}
```

**Error responses**

| HTTP | When | Client should |
|------|------|---------------|
| 401 | Missing/invalid JIRA token | Re-authenticate |
| 403 | User lacks release_versions_view mapping | Show access denied |
| 500/502 | JIRA or service failure | Show error + retry |

**Caching**: No — live on each request.
