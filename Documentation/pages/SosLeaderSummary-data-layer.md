# SoS by Leader — Data Layer

## API Endpoints Called (client → server)

### 1. `GET /api/config/ndb-leader-org`

**Purpose**: Load the maintainable NDB eng-leader org map (Anil / Naveen / Jovan / Ashish + managers).

**When called**: Once on page mount.

**Response**: See [`docs/api/config.md`](../api/config.md) — `GET /api/config/ndb-leader-org`.

**Caching**: File re-read each request; client holds in component state.

---

### 2. `POST /api/jira/sos-items`

**Purpose**: Same Feature/Initiative payload as SoS Summary.

**When called**: On team change and Refresh All (`forceLive: true`).

**Client**: `useSosItems` → `authenticatedPost('/api/jira/sos-items', { teamId, forceLive })`.

**Server flow**: `sos.js` → `releaseItemsDataService.fetchSosItems()` (live JIRA; disk on 429).

**Attribution field**: `assigneeManager` (from `customfield_19262.displayName`).

---

### 3. `GET /api/release-dataset/gates?release=…`

**Purpose**: Gate strip (CC / CG / PG / GA) under each release card.

**When called**: After SoS items load, once per distinct fixVersion key.

**Failure**: Ignored per release; table still renders without strip.

---

### 4. `POST /api/ai/sos-leader-coaching`

**Purpose**: Per-leader coaching Asks (release + sprint packet).

**When called**: Auto after enrichment ready (once per load signature); also manual Generate Asks / Generate All Asks.

**Client**: `useSosLeaderCoaching` → body includes `items`, `gateDataByRelease`, `breakdownDataMap`, `checkpointHistory`.

**Server**: `sosLeaderCoachingService.generateLeaderCoaching` → `naiService.generateSosLeaderCoaching` (rule fallback on NAI failure).

See [`docs/api/ai.md`](../api/ai.md).

---

### 5. `POST /api/email/send-sos`

**Purpose**: Send Leader → Release HTML snapshot (preview or send).

**When called**: Email Leader SoS after enrichment ready (manual; not auto on load).

**HTML**: `buildSosLeaderSnapshotHtml` — Leader outer loop, includes coaching Asks when present.

**Recipients**: `server/config/sosEmailConfig.json` `defaultTo` / `defaultCC` + dialog overrides (`@nutanix.com` only).

---

## Client transforms

| Step | Module | Behaviour |
|------|--------|-----------|
| Org lookup map | `client/src/utils/sosLeaderGrouping.js` → `buildManagerToLeaderMap` | Flattens leaders + managers + nested `reports` into normalized name → `leaderId` |
| Regroup | `regroupByLeader(byVersion, orgConfig)` | `{ byLeader, unmapped }` each with `byVersion` + `itemCount` |
| Match | case-insensitive trimmed Assignee Manager vs `matchNames` / `displayName` | Empty / unknown → Unmapped |
| Per-release UI | `ReleaseSection` from `SosSummaryPage` | Same body as SoS: Gantt, KPIs, charts, tables |
| Tier AI store key | `tierSummaryStoreKey(release, scopeKey)` | `release::leaderId` so leaders do not overwrite each other |
| Component donuts | `suppressComponentCounts` | Chart row omitted; RAG + gate sit inline with stale chip via `SosInlineReleaseCharts` |

## Enrichment

| Call | Purpose |
|------|---------|
| `useSosHistory` / `POST /api/jira/sos-items-history` | Struck-through prior gate dates + risk history |
| `useReleaseKpiBreakdown` with `jqlExtra` | KPI chips scoped per leader via `"Assignee Manager" in (…)` |
| `useSosTierSummary` + `scopeKey` | Tier AI boxes keyed per leader |
| `GET /api/release-dataset/gates` | Gate timeline / Gantt |
| Task breakdowns via `useSosItems.fetchBreakdowns` | Breakdown column |
| `useSosLeaderCoaching` | Per-leader Asks |

No new JQL. No JIRA write.

---

## Config source of truth

- Org map: `apps/delivery-ops/server/config/ndbLeaderOrgConfig.json`
- Email recipients: `apps/delivery-ops/server/config/sosEmailConfig.json`

---

## Error handling

| Failure | UI |
|---------|-----|
| Org config 500 | Banner error; no leader sections |
| sos-items error | Banner error via `getUserFacingMessage` |
| Gates fail | Silent; release block without strip |
| Coaching NAI fail | Rule-based Asks fallback |
| Email before enrichment | Send button disabled |

---

## Out of scope (follow-on)

- Cron Friday 09:30 `Asia/Kolkata` (same HTML/send pipeline once manual path is stable)
- Auto-SMTP on every browser page load
