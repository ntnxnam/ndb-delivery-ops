/**
 * SyncHubPage — release dataset sync control panel.
 *
 * Two sections: Current Releases | Past Releases
 * Seven columns per release: 6 Group-1 buckets + History (all groups union).
 *
 * Sync granularity:
 *   Full Sync    — re-fetches all 6 buckets for all current (non-past) releases.
 *   Release Sync — re-fetches all 6 buckets for one selected current release.
 *   Cell Sync    — re-fetches one bucket for any release (current or past).
 *
 * Past releases allow cell sync but NOT release-level or full sync.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTeamDataset } from '../hooks/useTeamDataset';
import { useTeam } from '../contexts/TeamContext';
import { getApiBase, getAuthHeaders } from '../utils/api';
import { formatters } from '../shared/utils/formatters';

// ─── Constants ────────────────────────────────────────────────────────────────

const BUCKET_KEYS = [
  'top_level_projects',
  'epics_of_projects',
  'work_toward_project',
  'standalone_epics',
  'work_toward_standalone_epic',
  'direct_tickets',
];

const BUCKET_LABELS = {
  top_level_projects:          'Top-Level Projects',
  epics_of_projects:           'Epics of Projects',
  work_toward_project:         'Work Toward Projects',
  standalone_epics:            'Standalone Epics',
  work_toward_standalone_epic: 'Work Toward Epics',
  direct_tickets:              'Direct Tickets',
};

const BUCKET_SHORT = {
  top_level_projects:          'Projects',
  epics_of_projects:           'Epics',
  work_toward_project:         'Work',
  standalone_epics:            'SA Epics',
  work_toward_standalone_epic: 'SA Work',
  direct_tickets:              'Direct',
};

// ─── SVG icons ────────────────────────────────────────────────────────────────

const RefreshIcon = ({ spinning = false }) => (
  <svg
    width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true"
    style={spinning ? { animation: 'sh-spin 0.9s linear infinite' } : undefined}
  >
    <path d="M2.5 6.5a4 4 0 0 1 7-2.7M10.5 6.5a4 4 0 0 1-7 2.7"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M9.1 2.5l1.2 1.3-1.6.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.9 10.5l-1.2-1.3 1.6-.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SyncAllIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2 7a5 5 0 0 1 9.2-2.7M12 7a5 5 0 0 1-9.2 2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 3l1.5 1.3-1.8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 11L2.5 9.7l1.8-.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ErrorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="#e03131" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return formatters.date(iso) || '—';
}

function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function releaseTypeLabel(name) {
  const dots = (name.match(/\./g) || []).length;
  if (/-EA|-RC|-BETA|-ALPHA/i.test(name)) return 'Pre-rel';
  if (dots === 1) return 'Minor';
  if (dots === 2) return 'Maint.';
  if (dots >= 3) return 'Patch';
  return null;
}

// ─── BucketCell ───────────────────────────────────────────────────────────────

function BucketCell({ release, bucketName, bucketMeta, activeCellSync, onCellSync, isPast }) {
  const key = `${release}::${bucketName}`;
  const isSyncing = activeCellSync === key;
  const count = bucketMeta?.count ?? null;
  const fetchedAt = bucketMeta?.fetchedAtIso ?? null;

  return (
    <div
      className={`sh-cell ${isSyncing ? 'sh-cell--syncing' : ''}`}
      title={`${BUCKET_LABELS[bucketName]}${fetchedAt ? `\nLast synced: ${formatDate(fetchedAt)}` : '\nNot synced yet'}`}
    >
      <span className="sh-cell__count">
        {isSyncing
          ? <RefreshIcon spinning />
          : count !== null ? count.toLocaleString() : '—'}
      </span>
      {fetchedAt && !isSyncing && (
        <span className="sh-cell__age">{timeAgo(fetchedAt)}</span>
      )}
      <button
        className="sh-cell__sync-btn"
        onClick={() => onCellSync(release, bucketName)}
        disabled={isSyncing || (activeCellSync && activeCellSync !== key)}
        title={`Sync ${BUCKET_LABELS[bucketName]} for ${release}`}
        aria-label={`Sync ${bucketName} for ${release}`}
      >
        <RefreshIcon spinning={isSyncing} />
      </button>
    </div>
  );
}

// ─── HistoryCell ─────────────────────────────────────────────────────────────

function HistoryCell({ meta }) {
  const count = meta?.ticketCount ?? null;
  const fetchedAt = meta?.fetchedAtIso ?? null;
  return (
    <div className="sh-cell sh-cell--history" title="Union of all groups (Group 1+2+3). Read-only derived view.">
      <span className="sh-cell__count sh-cell__count--history">
        {count !== null ? count.toLocaleString() : '—'}
      </span>
      {fetchedAt && (
        <span className="sh-cell__age">{timeAgo(fetchedAt)}</span>
      )}
    </div>
  );
}

// ─── ReleaseSection ───────────────────────────────────────────────────────────

function ReleaseSection({
  title,
  releases,
  releaseStates,
  releaseMeta,
  liveReleaseState,
  activeCellSync,
  isSyncing,
  onReleaseSyncClick,
  onCellSync,
  isPast,
  headerAction,
}) {
  if (releases.length === 0) return null;

  return (
    <div className="sh__section">
      <div className="sh__section-header">
        <h2 className="sh__section-title">{title}</h2>
        <span className="sh__count">{releases.length}</span>
        {isPast && (
          <span className="sh__section-hint">Cell sync only — past releases excluded from Full Sync.</span>
        )}
        {headerAction && <div className="sh__section-header-action">{headerAction}</div>}
      </div>

      {/* Column header row */}
      <div className="sh-table">
        <div className="sh-table__header">
          <div className="sh-col sh-col--name">Release</div>
          {BUCKET_KEYS.map((k) => (
            <div key={k} className="sh-col sh-col--bucket" title={BUCKET_LABELS[k]}>
              {BUCKET_SHORT[k]}
            </div>
          ))}
          <div className="sh-col sh-col--history">History</div>
          {!isPast && <div className="sh-col sh-col--action" />}
        </div>

        {releases.map((rel) => {
          const meta = releaseMeta[rel];
          const liveEv = liveReleaseState[rel];
          const isRelSyncing = isSyncing && liveEv && !['done', 'cache_hit', 'error'].includes(liveEv?.status);
          const typeLabel = releaseTypeLabel(rel);

          return (
            <div
              key={rel}
              className={`sh-table__row ${isRelSyncing ? 'sh-table__row--syncing' : ''}`}
            >
              {/* Release name */}
              <div className="sh-col sh-col--name">
                <span className="sh-rel__name">{rel}</span>
                {typeLabel && <span className="sh-rel__type">{typeLabel}</span>}
                {isRelSyncing && (
                  <span className="sh-rel__live" title="Syncing…">
                    <RefreshIcon spinning />
                  </span>
                )}
              </div>

              {/* 6 bucket cells */}
              {BUCKET_KEYS.map((bucketName) => (
                <BucketCell
                  key={bucketName}
                  release={rel}
                  bucketName={bucketName}
                  bucketMeta={meta?.buckets?.[bucketName] ?? null}
                  activeCellSync={activeCellSync}
                  onCellSync={onCellSync}
                  isPast={isPast}
                />
              ))}

              {/* History (union, read-only) */}
              <HistoryCell meta={meta} />

              {/* Release-level sync button — current releases only */}
              {!isPast && (
                <div className="sh-col sh-col--action">
                  <button
                    className="sh-rel__sync-btn"
                    onClick={() => onReleaseSyncClick(rel)}
                    disabled={isSyncing || !!activeCellSync}
                    title={`Sync all buckets for ${rel}`}
                    aria-label={`Sync ${rel}`}
                  >
                    {isRelSyncing ? <RefreshIcon spinning /> : <RefreshIcon />}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SyncHubPage() {
  const { selectedTeam } = useTeam();
  const {
    bundleMeta,
    isSyncing,
    syncProgress,
    syncError,
    triggerSync,
    isReady,
  } = useTeamDataset();

  const productId = selectedTeam?.productId || 'ndb';

  const [syncDetails, setSyncDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [skipChangelog, setSkipChangelog] = useState(false);
  const [syncErrors, setSyncErrors] = useState(null);
  const [isRefreshingNow, setIsRefreshingNow] = useState(false);
  const [localLog, setLocalLog] = useState([]);
  // Key of the cell currently being synced — `${release}::${bucketName}` or null.
  const [activeCellSync, setActiveCellSync] = useState(null);
  const [cellSyncLog, setCellSyncLog] = useState([]);
  const [isBackfilling, setIsBackfilling] = useState(false);

  const logEndRef = useRef(null);

  const fetchDetails = useCallback(async () => {
    setDetailsLoading(true);
    try {
      const headers = getAuthHeaders().headers;
      const res = await fetch(
        `${getApiBase()}/api/release-dataset/sync-status?productId=${encodeURIComponent(productId)}`,
        { headers }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) setSyncDetails(json.data);
    } catch (e) {
      console.warn('[SyncHubPage] fetchDetails error:', e?.message);
    } finally {
      setDetailsLoading(false);
    }
  }, [productId]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  // Re-fetch details after a release-level sync completes.
  const prevSyncing = useRef(isSyncing);
  useEffect(() => {
    if (prevSyncing.current && !isSyncing) fetchDetails();
    prevSyncing.current = isSyncing;
  }, [isSyncing, fetchDetails]);

  // Auto-scroll log.
  useEffect(() => {
    if (syncProgress.length > 0 || localLog.length > 0 || cellSyncLog.length > 0) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [syncProgress, localLog, cellSyncLog]);

  const addLog = (msg) =>
    setLocalLog((prev) => [...prev, { ts: new Date().toISOString(), msg }]);

  const handleProgressEvent = useCallback((event) => {
    if (event.type === 'done' && event.errors && Object.keys(event.errors).length > 0) {
      setSyncErrors(event.errors);
    }
    if (event.status === 'error' && event.release && event.detail) {
      setSyncErrors((prev) => {
        const next = { ...(prev || {}) };
        if (!next[event.release]) next[event.release] = [];
        if (!next[event.release].includes(event.detail)) {
          next[event.release] = [...next[event.release], event.detail];
        }
        return next;
      });
    }
  }, []);

  // Full Sync — all current (non-past) releases.
  const handleFullSync = useCallback(async () => {
    setSyncErrors(null);
    addLog('Full Sync — re-fetching all current releases…');
    await triggerSync({
      forceReleases: [],
      forceAll: true,
      skipChangelog,
      onProgress: handleProgressEvent,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSync, skipChangelog, handleProgressEvent]);

  // Release Sync — one current release, all 6 buckets.
  const handleReleaseSync = useCallback(async (releaseName) => {
    setSyncErrors(null);
    addLog(`↻ Syncing ${releaseName} (all buckets)…`);
    await triggerSync({
      forceReleases: [releaseName],
      forceAll: false,
      skipChangelog,
      onProgress: handleProgressEvent,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSync, skipChangelog, handleProgressEvent]);

  // Backfill — derive bucket counts from cached ticket data for all past releases.
  const handleBackfill = useCallback(async () => {
    setIsBackfilling(true);
    addLog('Backfilling bucket counts for past releases from disk cache…');
    try {
      const headers = getAuthHeaders().headers;
      const res = await fetch(
        `${getApiBase()}/api/release-dataset/backfill-meta?productId=${encodeURIComponent(productId)}`,
        { method: 'POST', headers }
      );
      const json = await res.json();
      if (json.success) {
        const { processed, skipped } = json.data;
        addLog(`Backfill complete — ${processed.length} updated, ${skipped.length} skipped (already had data or no ticket file).`);
        fetchDetails();
      } else {
        addLog(`Backfill error: ${json.error}`);
      }
    } catch (e) {
      addLog(`Backfill request failed: ${e.message}`);
    } finally {
      setIsBackfilling(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, fetchDetails]);

  // Cell Sync — one bucket for one release (current or past).
  const handleCellSync = useCallback(async (release, bucketName) => {
    const key = `${release}::${bucketName}`;
    setActiveCellSync(key);
    setCellSyncLog((prev) => [
      ...prev,
      { ts: new Date().toISOString(), type: 'start', msg: `↻ Cell sync: ${release} / ${BUCKET_LABELS[bucketName]}` },
    ]);

    try {
      const headers = getAuthHeaders().headers;
      const url = `${getApiBase()}/api/release-dataset/sync/bucket?productId=${encodeURIComponent(productId)}&release=${encodeURIComponent(release)}&bucket=${encodeURIComponent(bucketName)}`;
      const res = await fetch(url, { method: 'POST', headers });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            setCellSyncLog((prev) => [...prev, { ts: new Date().toISOString(), ...ev }]);
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e) {
      setCellSyncLog((prev) => [
        ...prev,
        { ts: new Date().toISOString(), type: 'error', msg: `Cell sync error: ${e.message}` },
      ]);
    } finally {
      setActiveCellSync(null);
      fetchDetails();
    }
  }, [productId, fetchDetails]);

  const handleRefreshNow = useCallback(async () => {
    setIsRefreshingNow(true);
    setLocalLog((prev) => [...prev, { ts: new Date().toISOString(), msg: 'Refreshing live dataset now…' }]);
    try {
      const headers = getAuthHeaders().headers;
      const res = await fetch(`${getApiBase()}/api/release-dataset/refresh-now?productId=${encodeURIComponent(productId)}`, {
        method: 'POST',
        headers,
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setLocalLog((prev) => [...prev, { ts: new Date().toISOString(), msg: 'Live refresh complete.' }]);
      await fetchDetails();
    } catch (e) {
      setLocalLog((prev) => [...prev, { ts: new Date().toISOString(), msg: `Live refresh failed: ${e.message}` }]);
    } finally {
      setIsRefreshingNow(false);
    }
  }, [fetchDetails, productId]);

  // Build live release state map from SSE events.
  const liveReleaseState = {};
  for (const ev of syncProgress) {
    if (ev.release && ev.release !== '__meta__') liveReleaseState[ev.release] = ev;
  }

  const releases = syncDetails?.cachedReleases || [];
  const releaseStates = syncDetails?.releaseStates || {};
  const releaseMeta = syncDetails?.releaseMeta || {};

  const currentReleases = [...releases]
    .filter((r) => releaseStates[r] !== 'past')
    .sort((a, b) => {
      const order = { active: 0, future: 1 };
      const sa = order[releaseStates[a]] ?? 2;
      const sb = order[releaseStates[b]] ?? 2;
      return sa !== sb ? sa - sb : b.localeCompare(a);
    });

  const pastReleases = [...releases]
    .filter((r) => releaseStates[r] === 'past')
    .sort((a, b) => b.localeCompare(a));

  const syncingCount = syncProgress.filter((ev) =>
    ev.release && ev.release !== '__meta__' && !['done', 'cache_hit', 'error'].includes(ev.status)
  ).length;
  const doneCount = syncProgress.filter((ev) =>
    ev.release && ev.release !== '__meta__' && (ev.status === 'done' || ev.status === 'cache_hit')
  ).length;
  const totalReleaseEvents = Object.keys(liveReleaseState).length;

  // Most recent meaningful SSE event for the live status bar.
  const latestEvent = [...syncProgress].reverse().find(
    (ev) => ev.release && ev.release !== '__meta__' && ev.message
  );
  const activeRelease = latestEvent?.release;
  const activeDetail  = latestEvent?.message || latestEvent?.detail || '';

  const hasActivity = localLog.length > 0 || syncProgress.length > 0 || cellSyncLog.length > 0;
  const scheduler = syncDetails?.scheduler || null;
  const nextSyncIn = scheduler?.nextRunAtIso ? timeAgo(scheduler.nextRunAtIso) : null;

  return (
    <div className="sh">
      {/* ── Sticky sync status bar ── */}
      {isSyncing && (
        <div className="sh__sync-bar" role="status" aria-live="polite">
          <span className="sh__spinner sh__spinner--light" />
          <div className="sh__sync-bar-body">
            <div className="sh__sync-bar-headline">
              {totalReleaseEvents > 0
                ? <><strong>{doneCount}</strong> / <strong>{totalReleaseEvents}</strong> releases done</>
                : 'Starting sync…'}
              {activeRelease && (
                <span className="sh__sync-bar-rel"> — {activeRelease}</span>
              )}
            </div>
            {activeDetail && (
              <div className="sh__sync-bar-detail">{activeDetail}</div>
            )}
          </div>
          {totalReleaseEvents > 0 && (
            <div className="sh__sync-bar-track" role="progressbar"
              aria-valuenow={doneCount} aria-valuemax={totalReleaseEvents}>
              <div
                className="sh__sync-bar-fill"
                style={{ width: `${Math.round((doneCount / totalReleaseEvents) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Header ── */}
      <div className="sh__header">
        <div>
          <h1 className="sh__title">Data Sync Hub</h1>
          <p className="sh__subtitle">
            JIRA cache for <strong>{selectedTeam?.name || productId.toUpperCase()}</strong>.
            Sync once — every page reads from the bundle.
          </p>
        </div>
        <div className="sh__header-actions">
          <label className="sh__toggle">
            <input
              type="checkbox"
              checked={skipChangelog}
              onChange={(e) => setSkipChangelog(e.target.checked)}
              disabled={isSyncing || !!activeCellSync}
            />
            Skip changelog
          </label>
          <button
            className="sh__btn sh__btn--primary"
            onClick={handleFullSync}
            disabled={isSyncing || !!activeCellSync}
            title="Re-fetch all current (non-past) releases from JIRA"
          >
            {isSyncing
              ? <><span className="sh__spinner" />{syncingCount > 0 ? `Syncing ${syncingCount}…` : 'Syncing…'}</>
              : <><SyncAllIcon />Full Sync</>
            }
          </button>
          <button
            className="sh__btn sh__btn--ghost"
            onClick={handleRefreshNow}
            disabled={isRefreshingNow || isSyncing || !!activeCellSync}
            title="Trigger an immediate scheduled refresh"
          >
            {isRefreshingNow ? <><span className="sh__spinner sh__spinner--dark" />Refreshing…</> : <>Refresh Now</>}
          </button>
          <button
            className="sh__btn sh__btn--ghost"
            onClick={fetchDetails}
            disabled={detailsLoading || isSyncing}
            title="Reload status from disk"
          >
            <RefreshIcon spinning={detailsLoading} />
            Refresh
          </button>
        </div>
      </div>

      {syncError && (
        <div className="sh__banner sh__banner--error" role="alert">
          Sync failed: {syncError}
        </div>
      )}

      {/* ── Bundle stats ── */}
      {isReady && bundleMeta && (
        <div className="sh__stats-row">
          <div className="sh__stat">
            <span className="sh__stat-val sh__stat-val--accent">
              {(bundleMeta.numTickets || 0).toLocaleString()}
            </span>
            <span className="sh__stat-label">tickets cached</span>
          </div>
          <div className="sh__stat-sep" />
          <div className="sh__stat">
            <span className="sh__stat-val">{bundleMeta.numReleases ?? '—'}</span>
            <span className="sh__stat-label">releases</span>
          </div>
          <div className="sh__stat-sep" />
          <div className="sh__stat">
            <span className="sh__stat-val">{formatDate(bundleMeta.lastSyncIso)}</span>
            <span className="sh__stat-label">last synced</span>
          </div>
          {bundleMeta.schemaVersion && (
            <>
              <div className="sh__stat-sep" />
              <div className="sh__stat">
                <span className="sh__stat-val sh__stat-val--mono">{bundleMeta.schemaVersion}</span>
                <span className="sh__stat-label">schema</span>
              </div>
            </>
          )}
          {scheduler?.enabled && (
            <>
              <div className="sh__stat-sep" />
              <div className="sh__stat">
                <span className="sh__stat-val">{nextSyncIn || 'scheduled'}</span>
                <span className="sh__stat-label">next auto-sync</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Releases ── */}
      {detailsLoading && releases.length === 0 ? (
        <div className="sh__loading">
          <span className="sh__spinner sh__spinner--dark" /> Loading release status…
        </div>
      ) : releases.length === 0 ? (
        <div className="sh__empty">
          <span className="sh__empty-label">No releases cached yet.</span>
          <p>Run a Full Sync to fetch data from JIRA.</p>
        </div>
      ) : (
        <>
          <ReleaseSection
            title="Current Releases"
            releases={currentReleases}
            releaseStates={releaseStates}
            releaseMeta={releaseMeta}
            liveReleaseState={liveReleaseState}
            activeCellSync={activeCellSync}
            isSyncing={isSyncing}
            onReleaseSyncClick={handleReleaseSync}
            onCellSync={handleCellSync}
            isPast={false}
          />
          <ReleaseSection
            title="Past Releases"
            releases={pastReleases}
            releaseStates={releaseStates}
            releaseMeta={releaseMeta}
            liveReleaseState={liveReleaseState}
            activeCellSync={activeCellSync}
            isSyncing={isSyncing}
            onReleaseSyncClick={null}
            onCellSync={handleCellSync}
            isPast={true}
            headerAction={
              pastReleases.some((r) => !releaseMeta[r]?.buckets) && (
                <button
                  className="sh__btn sh__btn--ghost sh__btn--sm"
                  onClick={handleBackfill}
                  disabled={isBackfilling || isSyncing || !!activeCellSync}
                  title="Derive bucket counts from cached ticket data — no JIRA calls needed"
                >
                  {isBackfilling
                    ? <><span className="sh__spinner sh__spinner--dark" /> Backfilling…</>
                    : <>Fix missing counts</>}
                </button>
              )
            }
          />
        </>
      )}

      {/* ── Error rollup ── */}
      {syncErrors && Object.keys(syncErrors).length > 0 && (
        <div className="sh__card sh__card--error" role="alert">
          <h2 className="sh__card-title sh__card-title--error">
            <ErrorIcon /> Sync completed with errors
            <span className="sh__count">{Object.keys(syncErrors).length} release(s)</span>
          </h2>
          <div className="sh__error-list">
            {Object.entries(syncErrors).map(([rel, msgs]) => (
              <div key={rel} className="sh__error-item">
                <div className="sh__error-item-release">{rel}</div>
                <ul className="sh__error-item-msgs">
                  {(Array.isArray(msgs) ? msgs : [msgs]).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Activity log ── */}
      {hasActivity && (
        <div className="sh__card sh__log-card">
          <div className="sh__card-header">
            <h2 className="sh__card-title">
              Activity
              {isSyncing && doneCount > 0 && (
                <span className="sh__log-progress">
                  {doneCount} / {Object.keys(liveReleaseState).length} done
                </span>
              )}
              <span className="sh__count sh__count--muted">
                {localLog.length + syncProgress.length + cellSyncLog.length} events
              </span>
            </h2>
          </div>
          <div className="sh__log" role="log" aria-live="polite">
            {localLog.map((entry, i) => (
              <div key={`l-${i}`} className="sh__log-row sh__log-row--info">
                <span className="sh__log-icon">›</span>
                <span className="sh__log-rel">client</span>
                <span>{entry.msg}</span>
              </div>
            ))}
            {cellSyncLog.map((ev, i) => (
              <div key={`c-${i}`} className={`sh__log-row sh__log-row--${ev.type || ev.status || 'info'}`}>
                <span className="sh__log-icon">
                  {ev.type === 'done' ? '✓' : ev.type === 'error' || ev.status === 'error' ? '✕' : '⟳'}
                </span>
                <span className="sh__log-rel">
                  {ev.release ? `${ev.release}/${ev.bucket || ''}` : 'cell'}
                </span>
                <span>{ev.message || ev.detail || ev.msg || ''}</span>
              </div>
            ))}
            {syncProgress
              .filter((ev) => !(ev.status === 'queued' && ev.release && ev.release !== '__meta__'))
              .map((ev, i) => (
                <div key={`s-${i}`} className={`sh__log-row sh__log-row--${ev.status || ev.type || 'info'}`}>
                  <span className="sh__log-icon">
                    {ev.type === 'done'       ? '✓'
                     : ev.type === 'start'    ? '›'
                     : ev.type === 'preflight'? '·'
                     : ev.status === 'done' || ev.status === 'cache_hit' ? '✓'
                     : ev.status === 'error'  ? '✕'
                     : ev.status === 'fetching' || ev.status === 'changelog' ? '⟳'
                     : '·'}
                  </span>
                  <span className="sh__log-rel">
                    {ev.release && ev.release !== '__meta__' ? ev.release : '—'}
                  </span>
                  <span>{ev.message || ev.detail || ''}</span>
                </div>
              ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      <style>{`
        @keyframes sh-spin { to { transform: rotate(360deg); } }

        .sh {
          max-width: 1300px;
          margin: 0 auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #212529;
        }

        /* ── Sticky sync status bar ── */
        .sh__sync-bar {
          position: sticky; top: 0; z-index: 100;
          display: flex; align-items: center; gap: 12px;
          background: #1971c2; color: #fff;
          padding: 10px 18px; border-radius: 10px;
          box-shadow: 0 2px 12px rgba(25,113,194,0.35);
          font-size: 13px;
          flex-wrap: wrap;
        }
        .sh__sync-bar-body { flex: 1; min-width: 0; }
        .sh__sync-bar-headline { font-weight: 600; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .sh__sync-bar-rel { font-weight: 400; opacity: 0.85; }
        .sh__sync-bar-detail { font-size: 12px; opacity: 0.8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 600px; }
        .sh__sync-bar-track {
          width: 140px; height: 6px; background: rgba(255,255,255,0.25);
          border-radius: 99px; overflow: hidden; flex-shrink: 0;
        }
        .sh__sync-bar-fill {
          height: 100%; background: #fff; border-radius: 99px;
          transition: width 0.4s ease;
        }
        .sh__spinner--light {
          display: inline-block; width: 14px; height: 14px; flex-shrink: 0;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff; border-radius: 50%;
          animation: sh-spin 0.8s linear infinite;
        }

        /* ── Header ── */
        .sh__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .sh__title { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #1a1a2e; }
        .sh__subtitle { margin: 0; font-size: 13px; color: #6c757d; }
        .sh__header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex-shrink: 0; }

        /* ── Buttons ── */
        .sh__btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 14px; border-radius: 7px;
          font-size: 13px; font-weight: 600; cursor: pointer; border: none;
          transition: background 0.13s; white-space: nowrap;
        }
        .sh__btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .sh__btn--primary { background: #1971c2; color: #fff; }
        .sh__btn--primary:not(:disabled):hover { background: #1864ab; }
        .sh__btn--ghost { background: transparent; color: #495057; border: 1px solid #dee2e6; }
        .sh__btn--ghost:not(:disabled):hover { background: #f1f3f5; }

        .sh__btn--sm { padding: 4px 10px; font-size: 11px; font-weight: 500; }
        .sh__section-header-action { margin-left: auto; }
        .sh__toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #495057; cursor: pointer; user-select: none; }
        .sh__toggle input { cursor: pointer; }

        /* ── Banner ── */
        .sh__banner { padding: 10px 14px; border-radius: 7px; font-size: 13px; }
        .sh__banner--error { background: #fff5f5; border: 1px solid #ffc9c9; color: #c92a2a; }

        /* ── Stats row ── */
        .sh__stats-row {
          display: flex; align-items: center; gap: 0;
          background: #fff; border: 1px solid #e9ecef; border-radius: 10px;
          padding: 14px 20px; flex-wrap: wrap;
        }
        .sh__stat { display: flex; flex-direction: column; gap: 2px; padding: 0 16px; flex-shrink: 0; }
        .sh__stat-val { font-size: 17px; font-weight: 700; color: #212529; }
        .sh__stat-val--accent { color: #2f9e44; }
        .sh__stat-val--mono { font-size: 12px; font-family: monospace; color: #495057; line-height: 1.8; }
        .sh__stat-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #adb5bd; }
        .sh__stat-sep { width: 1px; height: 32px; background: #e9ecef; flex-shrink: 0; }

        /* ── Loading/empty ── */
        .sh__loading { display: flex; align-items: center; gap: 10px; padding: 32px 20px; color: #868e96; font-size: 13px; }
        .sh__empty { padding: 40px 20px; text-align: center; color: #868e96; }
        .sh__empty-label { font-size: 15px; font-weight: 600; color: #495057; }
        .sh__empty p { margin: 8px 0 0; font-size: 13px; }

        /* ── Section ── */
        .sh__section {
          background: #fff;
          border: 1px solid #dee2e6;
          border-radius: 10px;
          overflow: hidden;
        }
        .sh__section-header {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px 10px;
          border-bottom: 1px solid #f1f3f5;
          background: #f8f9fa;
        }
        .sh__section-title { margin: 0; font-size: 13px; font-weight: 700; color: #343a40; }
        .sh__section-hint { margin-left: 4px; font-size: 11px; color: #adb5bd; }
        .sh__count {
          font-size: 11px; font-weight: 500;
          background: #e9ecef; color: #495057;
          border-radius: 8px; padding: 1px 7px;
        }
        .sh__count--muted { color: #868e96; }

        /* ── Table ── */
        .sh-table { width: 100%; overflow-x: auto; }
        .sh-table__header {
          display: flex; align-items: center;
          padding: 6px 12px;
          background: #f1f3f5;
          border-bottom: 1px solid #e9ecef;
          font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: #adb5bd;
        }
        .sh-table__row {
          display: flex; align-items: stretch;
          border-bottom: 1px solid #f8f9fa;
          transition: background 0.1s;
        }
        .sh-table__row:last-child { border-bottom: none; }
        .sh-table__row:hover { background: #f8f9fa; }
        .sh-table__row--syncing { background: #fff9db; }

        /* ── Columns ── */
        .sh-col { display: flex; align-items: center; padding: 6px 8px; flex-shrink: 0; }
        .sh-col--name { width: 140px; min-width: 140px; flex-direction: column; align-items: flex-start; gap: 2px; }
        .sh-col--bucket { width: 100px; min-width: 90px; flex-direction: column; padding: 0; }
        .sh-col--history { width: 80px; min-width: 70px; }
        .sh-col--action { width: 36px; justify-content: center; }

        /* ── Release name cell ── */
        .sh-rel__name { font-size: 12px; font-weight: 700; color: #212529; }
        .sh-rel__type {
          font-size: 10px; font-weight: 500; color: #868e96;
          background: #f1f3f5; border-radius: 4px; padding: 1px 5px;
        }
        .sh-rel__live { color: #1971c2; display: flex; align-items: center; }

        /* ── Bucket cell ── */
        .sh-cell {
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 1px; padding: 6px 8px; width: 100%; position: relative;
          border-left: 1px solid #f1f3f5;
          min-height: 44px;
        }
        .sh-cell:hover .sh-cell__sync-btn { opacity: 1; }
        .sh-cell--syncing { background: #fff9db; }
        .sh-cell--history { border-left: 2px solid #dee2e6; background: #f8f9fa; }

        .sh-cell__count {
          font-size: 13px; font-weight: 600; color: #212529;
          display: flex; align-items: center;
        }
        .sh-cell__count--history { color: #495057; font-weight: 700; }
        .sh-cell__age { font-size: 10px; color: #adb5bd; }

        .sh-cell__sync-btn {
          position: absolute; top: 4px; right: 4px;
          opacity: 0;
          display: flex; align-items: center; justify-content: center;
          width: 20px; height: 20px;
          border: 1px solid #dee2e6; border-radius: 4px;
          background: #fff; cursor: pointer; color: #868e96;
          transition: opacity 0.15s, color 0.12s, border-color 0.12s, background 0.12s;
        }
        .sh-cell__sync-btn:not(:disabled):hover { color: #1971c2; border-color: #74c0fc; background: #e7f5ff; }
        .sh-cell__sync-btn:disabled { opacity: 0.35 !important; cursor: not-allowed; }

        /* Show sync button always when syncing */
        .sh-cell--syncing .sh-cell__sync-btn { opacity: 1; }

        /* ── Release-level sync button ── */
        .sh-rel__sync-btn {
          display: flex; align-items: center; justify-content: center;
          width: 26px; height: 26px;
          border: 1px solid #e9ecef; border-radius: 6px;
          background: #fff; cursor: pointer; color: #6c757d;
          transition: color 0.12s, border-color 0.12s, background 0.12s;
        }
        .sh-rel__sync-btn:not(:disabled):hover { color: #1971c2; border-color: #74c0fc; background: #e7f5ff; }
        .sh-rel__sync-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        /* ── Shared card ── */
        .sh__card { background: #fff; border: 1px solid #dee2e6; border-radius: 10px; overflow: hidden; }
        .sh__card--error { border-color: #ffa8a8; background: #fff5f5; }
        .sh__card-header {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 12px 16px 10px; border-bottom: 1px solid #f1f3f5;
        }
        .sh__card-title { margin: 0; font-size: 13px; font-weight: 600; color: #343a40; display: flex; align-items: center; gap: 8px; }
        .sh__card-title--error { color: #c92a2a; }

        /* ── Error rollup ── */
        .sh__error-list { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
        .sh__error-item { background: #fff; border: 1px solid #ffc9c9; border-radius: 7px; padding: 10px 14px; }
        .sh__error-item-release { font-size: 12px; font-weight: 700; color: #c92a2a; margin-bottom: 5px; }
        .sh__error-item-msgs { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; }
        .sh__error-item-msgs li { font-size: 11px; font-family: monospace; color: #862e2e; }

        /* ── Log ── */
        .sh__log-progress { font-size: 12px; font-weight: 400; color: #2f9e44; background: #ebfbee; border-radius: 8px; padding: 2px 8px; }
        .sh__log {
          max-height: 320px; overflow-y: auto; background: #1e1e2e;
          padding: 12px; display: flex; flex-direction: column; gap: 3px;
        }
        .sh__log-row {
          display: grid; grid-template-columns: 16px 150px 1fr; gap: 10px;
          font-size: 11.5px; font-family: "SF Mono", "Cascadia Code", monospace;
          color: #cdd3de; padding: 2px 0;
        }
        .sh__log-row--done, .sh__log-row--cache_hit { color: #a9e34b; }
        .sh__log-row--error { color: #ff8787; }
        .sh__log-row--fetching, .sh__log-row--changelog { color: #ffd43b; }
        .sh__log-row--start, .sh__log-row--preflight, .sh__log-row--info { color: #adb5bd; font-style: italic; }
        .sh__log-icon { text-align: center; color: inherit; }
        .sh__log-rel { color: #74c0fc; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* ── Spinner ── */
        .sh__spinner {
          display: inline-block; width: 12px; height: 12px;
          border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
          border-radius: 50%; animation: sh-spin 0.8s linear infinite; flex-shrink: 0;
        }
        .sh__spinner--dark { border-color: rgba(0,0,0,0.1); border-top-color: #adb5bd; }

        @media (max-width: 700px) {
          .sh { padding: 12px; }
          .sh-col--bucket { width: 72px; min-width: 64px; }
          .sh-col--name { width: 100px; min-width: 90px; }
        }
      `}</style>
    </div>
  );
}
