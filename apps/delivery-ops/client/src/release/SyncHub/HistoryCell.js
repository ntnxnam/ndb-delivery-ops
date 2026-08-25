import React from 'react';
import { timeAgo } from './helpers';

export default function HistoryCell({ meta }) {
  const count = meta?.ticketCount ?? null;
  const fetchedAt = meta?.fetchedAtIso ?? null;
  return (
    <div className="sh-cell sh-cell--history" title="Union of all groups (Group 1+2+3). Read-only derived view. Age is last full-release sync, not last cell sync.">
      <span className="sh-cell__count sh-cell__count--history">
        {count !== null ? count.toLocaleString() : '—'}
      </span>
      {fetchedAt && (
        <span className="sh-cell__age">{timeAgo(fetchedAt)}</span>
      )}
    </div>
  );
}
