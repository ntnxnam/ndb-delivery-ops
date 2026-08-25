/**
 * Date History Display Utilities
 * Formats date history for UI display with styling and delay indicators
 */

import React from 'react';
import { renderNotSet, formatDate } from './releaseVersionUtils';
import { getAllUniqueDates, getHistoryForField } from './dateHistoryProcessing';

/**
 * Format date with history display
 * Shows all unique dates from getAllUniqueDates (newest to oldest).
 * Current date is bold; earlier dates are struck through, one per line.
 * Net delay sits on the oldest date.
 *
 * @param {string} itemKey - Item key for history lookup (e.g., 'FEAT-12345')
 * @param {string} fieldName - Field name (e.g., 'codeComplete', 'fsdsDone')
 * @param {string|Date} currentDate - Current date value
 * @param {object} checkpointHistory - Checkpoint history data indexed by item key
 * @returns {JSX.Element} Formatted date with history display
 */
export function formatDateWithHistory(itemKey, fieldName, currentDate, checkpointHistory) {
  const history = getHistoryForField(itemKey, fieldName, checkpointHistory);
  const sortedDates = getAllUniqueDates(history, currentDate);

  if (sortedDates.length === 0) {
    if (!currentDate) {
      return renderNotSet();
    }
    return formatDate(currentDate);
  }

  if (sortedDates.length === 1) {
    return formatDate(sortedDates[0]);
  }

  const latestDate = sortedDates[0];
  const oldestDate = sortedDates[sortedDates.length - 1];
  const isDelayed = latestDate > oldestDate;
  const movedForward = latestDate < oldestDate;

  let differenceText = '';
  const diffMs = Math.abs(latestDate.getTime() - oldestDate.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 3) {
    differenceText = isDelayed
      ? `+${diffDays} ${diffDays === 1 ? 'day' : 'days'}`
      : movedForward
        ? `-${diffDays} ${diffDays === 1 ? 'day' : 'days'}`
        : '';
  } else {
    const halfWeeks = Math.round((diffDays / 7) * 2) / 2;
    const weekLabel = halfWeeks === 1 ? 'week' : 'weeks';
    if (halfWeeks === Math.floor(halfWeeks)) {
      differenceText = isDelayed
        ? `+${halfWeeks} ${weekLabel}`
        : movedForward
          ? `-${halfWeeks} ${weekLabel}`
          : '';
    } else {
      differenceText = isDelayed
        ? `+${halfWeeks} weeks`
        : movedForward
          ? `-${halfWeeks} weeks`
          : '';
    }
  }

  const currentColor = isDelayed ? '#de350b' : movedForward ? '#0066cc' : '#28a745';
  const deltaColor = isDelayed ? '#de350b' : movedForward ? '#0066cc' : '#666';

  return (
    <span style={{ display: 'inline-block', lineHeight: 1.35 }}>
      {sortedDates.map((date, index) => {
        const isCurrent = index === 0;
        const isOldest = index === sortedDates.length - 1;
        return (
          <span
            key={`${date.getTime()}-${index}`}
            style={{ display: 'block', whiteSpace: isCurrent ? undefined : 'nowrap' }}
          >
            {!isCurrent && (
              <span style={{ marginRight: '4px', color: '#666' }}>←</span>
            )}
            <span style={isCurrent
              ? { color: currentColor, fontWeight: '600' }
              : { textDecoration: 'line-through', color: '#999', fontSize: '11px' }
            }>
              {formatDate(date)}
            </span>
            {isOldest && differenceText && (
              <span style={{
                color: deltaColor,
                fontSize: '10px',
                marginLeft: '4px',
                fontWeight: 500
              }}>
                ({differenceText})
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
