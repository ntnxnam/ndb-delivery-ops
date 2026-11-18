import React, { useMemo } from 'react';
import TicketChip from './TicketChip';

function formatRemovedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function jiraSearchUrl(base, jql) {
  if (!base || !jql) return null;
  const root = String(base).replace(/\/+$/, '');
  return `${root}/issues/?jql=${encodeURIComponent(jql)}`;
}

/**
 * Flat pairs for removed Mode Dependency links — no WaitArrow.
 * Distinct from Early calls “Missing arrows” (never linked).
 */
export default function PreviouslyLinkedBlock({
  previouslyLinked,
  jiraBaseUrl,
  directionFilter = null,
  emptyHide = true,
}) {
  const pairs = useMemo(() => {
    const all = previouslyLinked?.pairs || [];
    if (!directionFilter) return all;
    return all.filter((p) => p.direction === directionFilter);
  }, [previouslyLinked, directionFilter]);

  const { count, jql, jiraUrl } = useMemo(() => {
    const safeKey = (k) => /^[A-Z][A-Z0-9_]+-\d+$/i.test(String(k || ''));
    const keys = [
      ...new Set(
        pairs
          .flatMap((p) => [p.left?.key, p.right?.key].filter(Boolean))
          .filter(safeKey)
          .map((k) => String(k).toUpperCase())
      ),
    ];
    const scopedJql = keys.length ? `key in (${keys.join(', ')})` : null;
    return {
      count: pairs.length,
      jql: scopedJql,
      jiraUrl: jiraSearchUrl(jiraBaseUrl, scopedJql),
    };
  }, [pairs, jiraBaseUrl]);

  if (!pairs.length) {
    if (emptyHide) return null;
    return (
      <div className="dv-prev-linked">
        <div className="dv-prev-linked-head">
          <h3>Previously linked</h3>
        </div>
        <p className="dv-empty">No removed blocks / blocked-by links in lookback.</p>
      </div>
    );
  }

  return (
    <div className="dv-prev-linked" aria-label="Previously linked dependency pairs">
      <div className="dv-prev-linked-head">
        <h3>Previously linked</h3>
        <span className="dv-prev-linked-hint">
          Link removed in JIRA — not a live wait (no arrow). Not the same as Missing arrows on Early
          calls.
        </span>
        <span className="dv-meta">
          {jiraUrl ? (
            <a href={jiraUrl} target="_blank" rel="noopener noreferrer" title={jql || ''}>
              {count} pair{count === 1 ? '' : 's'}
            </a>
          ) : (
            `${count} pair${count === 1 ? '' : 's'}`
          )}
        </span>
      </div>
      <ul className="dv-prev-linked-list">
        {pairs.map((pair) => {
          const removed = formatRemovedAt(pair.removedAt);
          const rowKey = `${pair.left?.key || '?'}-${pair.right?.key || '?'}-${pair.removedAt || ''}`;
          return (
            <li key={rowKey} className="dv-prev-linked-row">
              <div className="dv-prev-linked-chip">
                <TicketChip issue={pair.left} jiraBaseUrl={jiraBaseUrl} />
              </div>
              <div className="dv-prev-linked-connector" aria-hidden="true">
                <span className="dv-prev-linked-label">previously linked</span>
                <span className="dv-prev-linked-dash">—</span>
              </div>
              <div className="dv-prev-linked-chip">
                <TicketChip issue={pair.right} jiraBaseUrl={jiraBaseUrl} />
              </div>
              {removed ? (
                <span className="dv-prev-linked-when">removed {removed}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
