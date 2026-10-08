# SoS by Leader (temp) — Data Layer

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

## Client transforms

| Step | Module | Behaviour |
|------|--------|-----------|
| Org lookup map | `client/src/utils/sosLeaderGrouping.js` → `buildManagerToLeaderMap` | Flattens leaders + managers + nested `reports` into normalized name → `leaderId` |
| Regroup | `regroupByLeader(byVersion, orgConfig)` | `{ byLeader, unmapped }` each with `byVersion` + `itemCount` |
| Match | case-insensitive trimmed Assignee Manager vs `matchNames` / `displayName` | Empty / unknown → Unmapped |
| Per-release UI | `ReleaseSection` from `SosSummaryPage` | Same body as SoS: Gantt, KPIs, charts, tables |

## Enrichment (same as SoS Summary)

| Call | Purpose |
|------|---------|
| `useSosHistory` / `POST /api/jira/sos-items-history` | Struck-through prior gate dates + risk history |
| `useReleaseKpiBreakdown` with `jqlExtra` | KPI chips scoped per leader via `"Assignee Manager" in (…)` (counts + click-through links) |
| `useSosTierSummary` + `fetchProjectStatus` | Tier AI boxes + component donuts |
| `GET /api/release-dataset/gates` | Gate timeline / Gantt |
| Task breakdowns via `useSosItems.fetchBreakdowns` | Breakdown column |

No new JQL. No JIRA write.

---

## Config source of truth

`apps/delivery-ops/server/config/ndbLeaderOrgConfig.json`

Edit managers here; refresh the page (no redeploy required — route clears require cache).

---

## Error handling

| Failure | UI |
|---------|-----|
| Org config 500 | Banner error; no leader sections |
| sos-items error | Banner error via `getUserFacingMessage` |
| Gates fail | Silent; release block without strip |

---

## Out of scope (next phase)

- HTML email (`buildSosSnapshotHtml` leader outer loop)
- `POST /api/email/send-sos` for leader digest
- Cron Friday 09:30 `Asia/Kolkata`
