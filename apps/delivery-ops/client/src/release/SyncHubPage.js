/**
 * SyncHubPage — release dataset sync control panel.
 *
 * Two sections: Current Releases | Past Releases
 * Seven columns per release: 6 Group-1 buckets + History (all groups union).
 *
 * Sync granularity:
 *   Sync current & upcoming — re-fetches all 6 buckets for current + future releases.
 *   Release Sync — re-fetches all 6 buckets for one selected current release.
 *   Cell Sync    — re-fetches one bucket for any release (current or past).
 *
 * Past releases allow cell sync but NOT release-level or full sync.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTeamDataset } from '../hooks/useTeamDataset';
import { useTeam } from '../contexts/TeamContext';
import { getApiBase, getAuthHeaders } from '../utils/api';
import { BUCKET_LABELS, cellSyncKey } from './SyncHub/constants';
import { formatDateTime, latestFetchedAt, timeAgo } from './SyncHub/helpers';
import { ErrorIcon, RefreshIcon, SyncAllIcon } from './SyncHub/icons';
import ReleaseSection from './SyncHub/ReleaseSection';
import './SyncHub/SyncHub.css';

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
  const [includeChangelog, setIncludeChangelog] = useState(false);
  const [syncErrors, setSyncErrors] = useState(null);
  const [localLog, setLocalLog] = useState([]);
  const [activeCellSyncs, setActiveCellSyncs] = useState([]);
  const [cellSyncLog, setCellSyncLog] = useState([]);
  const [cellErrors, setCellErrors] = useState({});
  const [isBackfilling, setIsBackfilling] = useState(false);

  const logEndRef = useRef(null);
  const cellAbortRef = useRef({});
  const detailsTimerRef = useRef(null);

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

  const scheduleFetchDetails = useCallback(() => {
    if (detailsTimerRef.current) clearTimeout(detailsTimerRef.current);
    detailsTimerRef.current = setTimeout(() => { fetchDetails(); }, 400);
  }, [fetchDetails]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  useEffect(() => () => {
    if (detailsTimerRef.current) clearTimeout(detailsTimerRef.current);
  }, []);

  const prevSyncing = useRef(isSyncing);
  useEffect(() => {
    if (prevSyncing.current && !isSyncing) fetchDetails();
    prevSyncing.current = isSyncing;
  }, [isSyncing, fetchDetails]);

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

  const handleFullSync = useCallback(async () => {
    setSyncErrors(null);
    addLog('Sync current & upcoming — past releases will not be fetched…');
    await triggerSync({
      forceReleases: [],
      forceAll: true,
      skipChangelog: !includeChangelog,
      onProgress: handleProgressEvent,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSync, includeChangelog, handleProgressEvent]);

  const handleReleaseSync = useCallback(async (releaseName) => {
    setSyncErrors(null);
    addLog(`↻ Syncing ${releaseName} (all buckets)…`);
    await triggerSync({
      forceReleases: [releaseName],
      forceAll: false,
      skipChangelog: !includeChangelog,
      onProgress: handleProgressEvent,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSync, includeChangelog, handleProgressEvent]);

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
  }, [productId, fetchDetails]);

  const cancelCellSync = useCallback((release, bucketName) => {
    const key = cellSyncKey(release, bucketName);
    cellAbortRef.current[key]?.abort();
  }, []);

  const patchCellMeta = useCallback((release, bucketName, count) => {
    const nowIso = new Date().toISOString();
    setSyncDetails((prev) => {
      if (!prev) return prev;
      const meta = prev.releaseMeta?.[release] || {};
      const buckets = { ...(meta.buckets || {}) };
      buckets[bucketName] = { count, fetchedAtIso: nowIso };
      return {
        ...prev,
        releaseMeta: {
          ...(prev.releaseMeta || {}),
          [release]: { ...meta, buckets },
        },
      };
    });
  }, []);

  const handleCellSync = useCallback(async (release, bucketName) => {
    const key = cellSyncKey(release, bucketName);
    cellAbortRef.current[key]?.abort();
    const ac = new AbortController();
    cellAbortRef.current[key] = ac;
    setActiveCellSyncs((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setCellErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCellSyncLog((prev) => [
      ...prev,
      { ts: new Date().toISOString(), type: 'start', msg: `↻ Cell sync: ${release} / ${BUCKET_LABELS[bucketName]}` },
    ]);

    try {
      const headers = getAuthHeaders().headers;
      const url = `${getApiBase()}/api/release-dataset/sync/bucket?productId=${encodeURIComponent(productId)}&release=${encodeURIComponent(release)}&bucket=${encodeURIComponent(bucketName)}`;
      const res = await fetch(url, { method: 'POST', headers, signal: ac.signal });
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
            if (ev.type === 'done' && ev.bucket && ev.count != null && !ev.error) {
              patchCellMeta(release, ev.bucket, ev.count);
            }
            if (ev.type === 'error' || ev.status === 'error' || ev.error) {
              const msg = ev.message || ev.detail || ev.error || 'Cell sync failed';
              setCellErrors((prev) => ({ ...prev, [key]: msg }));
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setCellSyncLog((prev) => [
          ...prev,
          { ts: new Date().toISOString(), type: 'info', msg: `Cell sync cancelled: ${release} / ${BUCKET_LABELS[bucketName]}` },
        ]);
      } else {
        const msg = e.message || 'Cell sync failed';
        setCellErrors((prev) => ({ ...prev, [key]: msg }));
        setCellSyncLog((prev) => [
          ...prev,
          { ts: new Date().toISOString(), type: 'error', msg: `Cell sync error: ${msg}` },
        ]);
      }
    } finally {
      if (cellAbortRef.current[key] === ac) delete cellAbortRef.current[key];
      setActiveCellSyncs((prev) => prev.filter((k) => k !== key));
      scheduleFetchDetails();
    }
  }, [productId, scheduleFetchDetails, patchCellMeta]);

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

  const latestEvent = [...syncProgress].reverse().find(
    (ev) => ev.release && ev.release !== '__meta__' && ev.message
  );
  const activeRelease = latestEvent?.release;
  const activeDetail  = latestEvent?.message || latestEvent?.detail || '';

  const hasActivity = localLog.length > 0 || syncProgress.length > 0 || cellSyncLog.length > 0;
  const scheduler = syncDetails?.scheduler || null;
  const nextSyncIn = scheduler?.nextRunAtIso ? timeAgo(scheduler.nextRunAtIso) : null;
  const currentLastSyncIso = latestFetchedAt(currentReleases, releaseMeta);

  return (
    <div className="sh">
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

      <div className="sh__header">
        <div>
          <h1 className="sh__title">Data Sync Hub</h1>
          <p className="sh__subtitle">
            JIRA cache for <strong>{selectedTeam?.name || productId.toUpperCase()}</strong>.
            Sync once — every page reads from the bundle.
          </p>
        </div>
        <div className="sh__header-actions">
          <label className="sh__toggle" title="Closed Date, reopen counts, and gate-date history. Off by default — it adds minutes to a current & upcoming sync.">
            <input
              type="checkbox"
              checked={includeChangelog}
              onChange={(e) => setIncludeChangelog(e.target.checked)}
              disabled={isSyncing}
            />
            Include changelog (slow)
          </label>
          <button
            className="sh__btn sh__btn--primary"
            onClick={handleFullSync}
            disabled={isSyncing || activeCellSyncs.length > 0}
            title="Re-fetch current and upcoming releases from JIRA. Past releases are not fetched."
          >
            {isSyncing
              ? <><span className="sh__spinner" />{syncingCount > 0 ? `Syncing ${syncingCount}…` : 'Syncing…'}</>
              : <><SyncAllIcon />Sync current & upcoming</>
            }
          </button>
          <button
            className="sh__btn sh__btn--ghost"
            onClick={fetchDetails}
            disabled={detailsLoading || isSyncing || activeCellSyncs.length > 0}
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
            <span className="sh__stat-val">{formatDateTime(currentLastSyncIso)}</span>
            <span className="sh__stat-label">
              current last synced
              {currentLastSyncIso && timeAgo(currentLastSyncIso) ? ` · ${timeAgo(currentLastSyncIso)}` : ''}
            </span>
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

      {detailsLoading && releases.length === 0 ? (
        <div className="sh__loading">
          <span className="sh__spinner sh__spinner--dark" /> Loading release status…
        </div>
      ) : releases.length === 0 ? (
        <div className="sh__empty">
          <span className="sh__empty-label">No releases cached yet.</span>
          <p>Run Sync current & upcoming to fetch data from JIRA.</p>
        </div>
      ) : (
        <>
          <ReleaseSection
            title="Current & upcoming"
            releases={currentReleases}
            releaseMeta={releaseMeta}
            liveReleaseState={liveReleaseState}
            activeCellSyncs={activeCellSyncs}
            cellErrors={cellErrors}
            isSyncing={isSyncing}
            onReleaseSyncClick={handleReleaseSync}
            onCellSync={handleCellSync}
            onCellCancel={cancelCellSync}
            isPast={false}
            lastSyncIso={currentLastSyncIso}
            headerAction={
              <button
                className="sh__btn sh__btn--primary sh__btn--sm"
                onClick={handleFullSync}
                disabled={isSyncing || activeCellSyncs.length > 0}
                title="Re-fetch current and upcoming releases from JIRA. Past releases are not fetched."
              >
                {isSyncing
                  ? <><span className="sh__spinner" />Syncing…</>
                  : <><SyncAllIcon />Sync current & upcoming</>}
              </button>
            }
          />
          <ReleaseSection
            title="Past Releases"
            releases={pastReleases}
            releaseMeta={releaseMeta}
            liveReleaseState={liveReleaseState}
            activeCellSyncs={activeCellSyncs}
            cellErrors={cellErrors}
            isSyncing={isSyncing}
            onReleaseSyncClick={null}
            onCellSync={handleCellSync}
            onCellCancel={cancelCellSync}
            isPast={true}
            lastSyncIso={latestFetchedAt(pastReleases, releaseMeta)}
            headerAction={
              pastReleases.some((r) => !releaseMeta[r]?.buckets) && (
                <button
                  className="sh__btn sh__btn--ghost sh__btn--sm"
                  onClick={handleBackfill}
                  disabled={isBackfilling || isSyncing || activeCellSyncs.length > 0}
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
    </div>
  );
}
