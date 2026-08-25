/**
 * Date History Display Utilities
 * Formats date history for UI display with styling and delay indicators
 */

import React from 'react';
import { renderNotSet, formatDate } from './releaseVersionUtils';
import { getAllUniqueDates, getHistoryForField } from './dateHistoryProcessing';

function buildDateHistoryModel(itemKey, fieldName, currentDate, checkpointHistory) {
  const history = getHistoryForField(itemKey, fieldName, checkpointHistory);
  const sortedDates = getAllUniqueDates(history, currentDate);

  if (sortedDates.length <= 1) {
    return { sortedDates, differenceText: '', isDelayed: false, movedForward: false };
  }

  const latestDate = sortedDates[0];
  const oldestDate = sortedDates[sortedDates.length - 1];
  const isDelayed = latestDate > oldestDate;
  const movedForward = latestDate < oldestDate;

  let differenceText = '';
  const diffDays = Math.floor(Math.abs(latestDate.getTime() - oldestDate.getTime()) / 86400000);

  if (diffDays <= 3) {
    differenceText = isDelayed
      ? `+${diffDays} ${diffDays === 1 ? 'day' : 'days'}`
      : movedForward
        ? `-${diffDays} ${diffDays === 1 ? 'day' : 'days'}`
        : '';
  } else {
    const halfWeeks = Math.round((diffDays / 7) * 2) / 2;
    const weekLabel = halfWeeks === 1 ? 'week' : 'weeks';
    differenceText = isDelayed
      ? `+${halfWeeks} ${weekLabel}`
      : movedForward
        ? `-${halfWeeks} ${weekLabel}`
        : '';
  }

  return { sortedDates, differenceText, isDelayed, movedForward };
}

function historyColors(isDelayed, movedForward) {
  return {
    currentColor: isDelayed ? '#de350b' : movedForward ? '#0066cc' : '#28a745',
    deltaColor: isDelayed ? '#de350b' : movedForward ? '#0066cc' : '#666',
  };
}

/**
 * Format date with history display
 * Shows all unique dates from getAllUniqueDates (newest to oldest).
 * Current date is bold; earlier dates are struck through, one per line.
 * Net delay sits on the oldest date.
 */
export function formatDateWithHistory(itemKey, fieldName, currentDate, checkpointHistory) {
  const { sortedDates, differenceText, isDelayed, movedForward } =
    buildDateHistoryModel(itemKey, fieldName, currentDate, checkpointHistory);

  if (sortedDates.length === 0) {
    if (!currentDate) {
      return renderNotSet();
    }
    return formatDate(currentDate);
  }

  if (sortedDates.length === 1) {
    return formatDate(sortedDates[0]);
  }

  const { currentColor, deltaColor } = historyColors(isDelayed, movedForward);

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

/**
 * HTML equivalent of formatDateWithHistory for email snapshots.
 * Uses the same getAllUniqueDates chain (newest to oldest, one line each).
 */
export function formatDateWithHistoryHTML(itemKey, fieldName, currentDate, checkpointHistory) {
  const { sortedDates, differenceText, isDelayed, movedForward } =
    buildDateHistoryModel(itemKey, fieldName, currentDate, checkpointHistory);

  if (sortedDates.length === 0) {
    return currentDate ? String(formatDate(currentDate)) : '—';
  }

  if (sortedDates.length === 1) {
    return String(formatDate(sortedDates[0]));
  }

  const { currentColor, deltaColor } = historyColors(isDelayed, movedForward);
  const parts = sortedDates.map((date, index) => {
    const isCurrent = index === 0;
    const isOldest = index === sortedDates.length - 1;
    const label = String(formatDate(date));
    const dateSpan = isCurrent
      ? `<span style="color:${currentColor};font-weight:600">${label}</span>`
      : `<span style="color:#666">←</span> <span style="text-decoration:line-through;color:#999;font-size:11px">${label}</span>`;
    const delta = isOldest && differenceText
      ? ` <span style="color:${deltaColor};font-size:10px;font-weight:500">(${differenceText})</span>`
      : '';
    return `${dateSpan}${delta}`;
  });

  return `<span style="display:inline-block;line-height:1.35">${parts.join('<br/>')}</span>`;
}
