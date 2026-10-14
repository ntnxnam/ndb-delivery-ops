# Dependency API

Dependency overview for Dependency View. No JIRA mutates. Local wishlist
config can be updated via PUT (writes `dependencyViewConfig.json`).

---

### GET /api/dependency/overview

**Purpose**: Fetch partnership, companion, train-label, and wishlist/pre-commit dependency sections for a team release, with clickable JQL and ask/committed classification.

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
    "wishlist": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "wishlistLinked": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "wishlistUnlinked": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "partnerOrphans": { "jql": "...", "jiraUrl": "...", "count": 0, "issues": [] },
    "companions": []
  },
  "wishlistMeta": {
    "releaseSlug": "3.1",
    "wishlistLabel": "ndb-3.1-wishlist",
    "partnerLabels": ["ndb-leto-dependency"],
    "linkTypeFilter": null,
    "labelSuffix": "wishlist",
    "partnerLabelSuffixes": ["dependency"],
    "linkTypePresets": ["", "is blocked by", "blocks", "relates to"]
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

---

### GET /api/dependency/wishlist-config

**Purpose**: Return current wishlist Q7 settings from `dependencyViewConfig.json`.

**Auth**: required (`releaseVersions`)

**Request**
- Method + path: `GET /api/dependency/wishlist-config`
- Query/body: none

**Server flow**
Route → `dependencyViewService.getWishlistConfig` → read JSON config

**Response shape**

```json
{
  "success": true,
  "wishlist": {
    "labelSuffix": "wishlist",
    "partnerLabelSuffixes": ["dependency"],
    "linkTypeFilter": null,
    "linkTypePresets": ["", "is blocked by", "blocks"]
  }
}
```

**Error responses**

| HTTP | When | Client should |
|------|------|---------------|
| 401/403 | Auth | Re-auth / access denied |
| 500 | Config read failure | Show error |

**Caching**: No

---

### PUT /api/dependency/wishlist-config

**Purpose**: Persist wishlist Q7 settings to `server/config/dependencyViewConfig.json` until the next Save. Does not mutate JIRA.

**Auth**: required (`releaseVersions`)

**Request**
- Method + path: `PUT /api/dependency/wishlist-config`
- Body (any subset):
  - `linkTypeFilter` (string|null) — empty/null = all link types for Q7b
  - `labelSuffix` (string) — default `wishlist`
  - `partnerLabelSuffixes` (string[] or comma-separated string)
- Headers: JIRA auth as other `/api/*` routes

**Server flow**
Route → `dependencyViewService.saveWishlistConfig` → write `dependencyViewConfig.json`

**Response shape**

```json
{
  "success": true,
  "wishlist": {
    "labelSuffix": "wishlist",
    "partnerLabelSuffixes": ["dependency"],
    "linkTypeFilter": "is blocked by",
    "linkTypePresets": ["", "is blocked by", "blocks"]
  }
}
```

**Error responses**

| HTTP | When | Client should |
|------|------|---------------|
| 400 | Empty body / bad partnerLabelSuffixes type | Fix payload |
| 401/403 | Auth | Re-auth / access denied |
| 500 | Config write failure | Show error + retry |

**Caching**: No — next overview reload uses the new file.
