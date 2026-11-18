### POST /api/jira/release-versions
**Purpose**: List unreleased versions in the team's JIRA project (`GET /project/{projectKey}/versions`).
**Auth**: required (`releaseVersions`)

### POST /api/jira/discover-versions
**Purpose**: Discover candidate versions from JIRA projects.
**Auth**: required (`releaseVersions`)

### POST /api/jira/release-items
**Purpose**: Live Feature/Initiative items for Project Status. Always JIRA; wrap with `team.baseFilter`. Disk cache ignored.
**Auth**: required (`releaseVersions`)

### POST /api/jira/release-items-tcms
**Purpose**: Fetch release items with TCMS enrichment for quality views.
**Auth**: required (`releaseVersions`)

**Response shape (per item)**: includes `tcmsQuality` (4 tables) and
`tcmsQI` (legacy). `tcmsQuality`:
```
{
  releaseOverall: { functional: {manual,automation}, system: {manual,automation} } | null,
  releaseLast4Weeks: same shape | null,   // primary
  releaseLast3Weeks: same shape | null,   // deprecated alias (back-compat; remove after 2 sprints)
  masterOverall: same shape | null,
  masterLast4Weeks: same shape | null,    // primary
  masterLast3Weeks: same shape | null     // deprecated alias
}
```
Each row (`functional`/`system`) has `{ manual, automation }`, each cell
`{ qi, run, passed, failed, rate }`. `overall` key is not emitted (legacy
`overall` data falls back to `system` row in renderers). Functional/System
rows currently share source metrics (clone) until TCMS `test_category`
filter lands — see `../tcms-rows-followup.md`.

**Caching**: TCMS cache per `featKey:milestone` (TTL per simpleCache).
**Error responses**: TCMS down → tables null, `tcmsQueryUrl` still set.

### POST /api/jira/risk-indicator-changes
**Purpose**: Return risk-indicator change history for release snapshots.
**Auth**: required (`releaseVersions`)

### PUT /api/jira/update-executive-summary
**Purpose**: Persist user-edited executive summary content.
**Auth**: required (`releaseVersions`)

### GET /api/jira/executive-summary-unified
**Purpose**: Return unified summary data for release dashboard render.
**Auth**: required

### GET /api/jira/p0-bugs
**Purpose**: Fetch P0 bugs for release health surfacing.
**Auth**: required
