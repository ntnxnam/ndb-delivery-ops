import React from 'react';
import { BUCKET_LABELS, cellSyncKey } from './constants';
import { formatDate, timeAgo } from './helpers';
import { RefreshIcon } from './icons';

export default function BucketCell({
  release,
  bucketName,
  bucketMeta,
  activeCellSyncs = [],
  cellError,
  onCellSync,
  onCellCancel,
  rowBusy,
}) {
  const key = cellSyncKey(release, bucketName);
  const isSyncing = activeCellSyncs.includes(key);
  const count = bucketMeta?.count ?? null;
  const fetchedAt = bucketMeta?.fetchedAtIso ?? null;
  const sameReleaseBusy = activeCellSyncs.some(
    (k) => k.startsWith(`${release}::`) && k !== key
  );

  return (
    <div
      className={`sh-cell ${isSyncing ? 'sh-cell--syncing' : ''} ${cellError ? 'sh-cell--error' : ''}`}
      title={
        cellError
          ? `${BUCKET_LABELS[bucketName]}\n${cellError}`
          : `${BUCKET_LABELS[bucketName]}${fetchedAt ? `\nLast synced: ${formatDate(fetchedAt)}` : '\nNot synced yet'}`
      }
    >
      <span className="sh-cell__count">
        {isSyncing
          ? <RefreshIcon spinning />
          : count !== null ? count.toLocaleString() : '—'}
      </span>
      {fetchedAt && !isSyncing && (
        <span className="sh-cell__age">{timeAgo(fetchedAt)}</span>
      )}
      {cellError && !isSyncing && (
        <span className="sh-cell__err">failed</span>
      )}
      <button
        className="sh-cell__sync-btn"
        onClick={() => (isSyncing ? onCellCancel(release, bucketName) : onCellSync(release, bucketName))}
        disabled={!isSyncing && (rowBusy || sameReleaseBusy)}
        title={isSyncing
          ? `Cancel ${BUCKET_LABELS[bucketName]} sync for ${release}`
          : `Sync ${BUCKET_LABELS[bucketName]} for ${release}`}
        aria-label={isSyncing
          ? `Cancel ${bucketName} sync for ${release}`
          : `Sync ${bucketName} for ${release}`}
      >
        <RefreshIcon spinning={isSyncing} />
      </button>
    </div>
  );
}
