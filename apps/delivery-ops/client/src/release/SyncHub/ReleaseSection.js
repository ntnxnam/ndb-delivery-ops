import React from 'react';
import { BUCKET_KEYS, BUCKET_LABELS, BUCKET_SHORT, cellSyncKey } from './constants';
import { formatDateTime, releaseTypeLabel, timeAgo } from './helpers';
import { RefreshIcon } from './icons';
import BucketCell from './BucketCell';
import HistoryCell from './HistoryCell';

export default function ReleaseSection({
  title,
  releases,
  releaseMeta,
  liveReleaseState,
  activeCellSyncs = [],
  cellErrors,
  isSyncing,
  onReleaseSyncClick,
  onCellSync,
  onCellCancel,
  isPast,
  headerAction,
  lastSyncIso,
}) {
  if (releases.length === 0) return null;

  const lastSyncLabel = lastSyncIso
    ? `${formatDateTime(lastSyncIso)}${timeAgo(lastSyncIso) ? ` (${timeAgo(lastSyncIso)})` : ''}`
    : null;

  return (
    <div className="sh__section">
      <div className="sh__section-header">
        <h2 className="sh__section-title">{title}</h2>
        <span className="sh__count">{releases.length}</span>
        {lastSyncLabel && (
          <span className="sh__section-sync" title="Most recent full-release sync among these rows">
            Last synced {lastSyncLabel}
          </span>
        )}
        {isPast && (
          <span className="sh__section-hint">Cell sync only — not included in current &amp; upcoming sync.</span>
        )}
        {headerAction && <div className="sh__section-header-action">{headerAction}</div>}
      </div>

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
          const cellBusyOnRow = activeCellSyncs.some((k) => k.startsWith(`${rel}::`));
          const rowSyncIso = meta?.fetchedAtIso || null;

          return (
            <div
              key={rel}
              className={`sh-table__row ${isRelSyncing ? 'sh-table__row--syncing' : ''}`}
            >
              <div className="sh-col sh-col--name">
                <span className="sh-rel__name">{rel}</span>
                <div className="sh-rel__meta">
                  {typeLabel && <span className="sh-rel__type">{typeLabel}</span>}
                  {rowSyncIso && (
                    <span className="sh-rel__synced" title={`Last full-release sync ${formatDateTime(rowSyncIso)}`}>
                      {formatDateTime(rowSyncIso)}
                    </span>
                  )}
                </div>
                {isRelSyncing && (
                  <span className="sh-rel__live" title="Syncing…">
                    <RefreshIcon spinning />
                  </span>
                )}
              </div>

              {BUCKET_KEYS.map((bucketName) => (
                <BucketCell
                  key={bucketName}
                  release={rel}
                  bucketName={bucketName}
                  bucketMeta={meta?.buckets?.[bucketName] ?? null}
                  activeCellSyncs={activeCellSyncs}
                  cellError={cellErrors?.[cellSyncKey(rel, bucketName)] || null}
                  onCellSync={onCellSync}
                  onCellCancel={onCellCancel}
                  rowBusy={isRelSyncing}
                />
              ))}

              <HistoryCell meta={meta} />

              {!isPast && (
                <div className="sh-col sh-col--action">
                  <button
                    className="sh-rel__sync-btn"
                    onClick={() => onReleaseSyncClick(rel)}
                    disabled={isSyncing || cellBusyOnRow}
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
