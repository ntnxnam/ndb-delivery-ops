# Sync Hub — Data Layer

**Route**: `/sync-hub`  
**Component**: `SyncHubPage` (`client/src/release/SyncHubPage.js`)  
**Hooks**: `useTeamDataset` → `TeamDatasetContext`  
**Audience**: `tpm` (implementation)

---

## API endpoints called (client → server)

### 1. `GET /api/release-dataset/sync-status`

**Purpose**: Disk-only status for the grid (bundle meta, per-release meta including per-bucket counts/timestamps, scheduler).

**When called**: On mount; after Sync current & upcoming / row sync ends; after cell sync `finally`; after past-release backfill; on disk Refresh.

**JIRA**: none.

**Caching**: Reads `bundle.meta.json` and `per_release/*.meta.json`.

---

### 2. `POST /api/release-dataset/sync`

**Purpose**: Full or release-scoped sync. SSE progress.

**When called**: Sync current & upcoming (`forceAll=true`) or row refresh (`forceReleases=<one>`).

**Query**: `productId`, `forceAll`, `forceReleases`, `skipChangelog` (true unless the user checks Include changelog).

**Server flow**:  
`releaseDataset.js` → acquire product + per-release locks → `syncReleaseDataset` → `fetchReleaseData` (Wave 1 indexed buckets, then Parent Link / Epic Link chunks for epics and work; `moved_out` still uses `fixVersion was`) → optional changelog → `saveRelease` → `processMaster` → `saveBundle`

**Timeouts**: `moved_out` uses 120s/page with one retry. Nested ScriptRunner is not used at fetch time. JIRA `/search` and changelog `getIssue` run **one at a time** (250ms pause between searches) so a wave does not trip HTTP 429. SSE comments (`: ping`) every 15s so nginx `proxy_read_timeout 300s` does not kill a quiet wait.

**Queued SSE**: emitted only for releases in `forceReleases` (not every cached release).

---

### 3. `POST /api/release-dataset/sync/bucket`

**Purpose**: Cell sync — one bucket, one release. Allowed for current and past.

**When called**: Cell refresh button.

**Query**: `productId`, `release`, `bucket`

**Server flow**:  
`releaseDataset.js` → per-release lock → `syncReleaseBucket` → `fetchReleaseData({ bucketFilter: [bucket] })` (child cells do a key-only precursor fetch of parent Features/Epics; those tickets are not merged unless that parent bucket is also in the filter) → if fetch error, **do not merge** (keep cache) → else merge by `Components` tag → `saveRelease(..., { stampBuckets: [bucket] })` → rebuild bundle

**Meta**: only the synced bucket's `fetchedAtIso` advances. Release-level `fetchedAtIso` (History age) is unchanged. Group-1 zero counts are persisted so the UI shows `0`.

---

### 4. `POST /api/release-dataset/backfill-meta`

**Purpose**: Disk-only: derive bucket counts for past releases whose meta predates per-bucket tracking.

**When called**: "Fix missing counts" on Past Releases.

**JIRA**: none.

---

## Data shapes

`releaseMeta[rel].buckets[bucketName] = { count: number, fetchedAtIso: string }`

History column uses `releaseMeta[rel].ticketCount` + `fetchedAtIso` (full-release stamp).

## Error handling

- Cell timeout / JIRA error: SSE `error`; previous tickets kept; cell shows failed; sibling timestamps unchanged.
- Row/Full Sync partial bucket failure: failed buckets restored from prior cache; successful buckets stamped; error listed in the rollup card.
- Client abort: `AbortController` on the cell fetch; UI clears spinner. Server work may continue until the socket closes.

## Caching strategy

No TTL. Invalidation is force-list / `jqlHash` / schema. Cell sync is the targeted invalidation path.

## Out of scope on this page

`POST /api/release-dataset/refresh-now` remains for other dashboards (Project Status, Sprint Report). Sync Hub does not call it — it duplicated Full Sync without SSE and with changelog forced on.
