/**
 * Date History Display Utilities
 * Formats date history for UI display with styling and delay indicators
 */

import React from 'react';
import { renderNotSet, formatDate } from './releaseVersionUtils';
import { getAllUniqueDates, getHistoryForField } from './dateHistoryProcessing';
import { normalizeDateStr, parseLocalDate } from './dateNormalization';

/**
 * Format date with history display
 * Shows all historical dates in reverse chronological order (newest to oldest)
 * Displays delay duration if dates have been pushed back
 * 
 * @param {string} itemKey - Item key for history lookup (e.g., 'FEAT-12345')
 * @param {string} fieldName - Field name (e.g., 'codeComplete', 'fsdsDone')
 * @param {string|Date} currentDate - Current date value
 * @param {object} checkpointHistory - Checkpoint history data indexed by item key
 * @returns {JSX.Element} Formatted date with history display
 */
export function formatDateWithHistory(itemKey, fieldName, currentDate, checkpointHistory) {
  // Get history for this specific item and field
  const history = getHistoryForField(itemKey, fieldName, checkpointHistory);
  
  // Normalize current date for comparison
  const normalizedCurrentDate = currentDate ? normalizeDateStr(currentDate) : null;
  
  // Filter history to exclude current date (backend includes it in history array)
  // We want to show historical dates separately from current date
  const historicalEntries = Array.isArray(history) 
    ? history.filter(entry => {
        if (!entry || !entry.date) return false;
        const entryDateStr = normalizeDateStr(entry.date);
        // Exclude entries that match current date (we'll show current date separately)
        return entryDateStr && entryDateStr !== normalizedCurrentDate;
      })
    : [];
  
  // Get unique historical dates (excluding current date)
  const historicalDates = getAllUniqueDates(historicalEntries, null);
  
  // Build final date array: current date first (if exists), then historical dates
  const allDates = [];
  
  // Add current date first if it exists
  if (normalizedCurrentDate) {
    const currentDateObj = parseLocalDate(normalizedCurrentDate);
    if (currentDateObj && !isNaN(currentDateObj.getTime())) {
      allDates.push(currentDateObj);
    }
  }
  
  // Add historical dates (they're already sorted newest first)
  historicalDates.forEach(date => {
    // Avoid duplicates (in case current date matches a historical date)
    const dateStr = date.toISOString().split('T')[0];
    if (!allDates.some(d => d.toISOString().split('T')[0] === dateStr)) {
      allDates.push(date);
    }
  });
  
  const sortedDates = allDates.sort((a, b) => b - a);

  if (sortedDates.length === 0) {
    // If no dates in history and no current date, show "Not Set"
    if (!currentDate) {
      return renderNotSet();
    }
    return formatDate(currentDate);
  }
  
  // If only one date, just show it (no history to display)
  if (sortedDates.length === 1) {
    return formatDate(sortedDates[0]);
  }
  
  // Always identify latest (most recent) and oldest (earliest) dates
  // sortedDates is already sorted newest first (reverse chronological)
  const latestDate = sortedDates[0]; // Most recent date
  const oldestDate = sortedDates[sortedDates.length - 1]; // Earliest date
  
  // Determine if dates moved forward (earlier) or backward (delayed)
  const isDelayed = latestDate > oldestDate; // Latest is after oldest = delayed
  const movedForward = latestDate < oldestDate; // Latest is before oldest = moved forward
  
  // Calculate the difference (always positive, but show direction)
  let differenceText = '';
  if (sortedDates.length > 1) {
    const diffMs = Math.abs(latestDate.getTime() - oldestDate.getTime());
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 3) {
      differenceText = isDelayed 
        ? `+${diffDays} ${diffDays === 1 ? 'day' : 'days'}`
        : movedForward 
          ? `-${diffDays} ${diffDays === 1 ? 'day' : 'days'}`
          : '';
    } else {
      const weeks = diffDays / 7;
      const halfWeeks = Math.round(weeks * 2) / 2;
      
      if (halfWeeks === Math.floor(halfWeeks)) {
        differenceText = isDelayed
          ? `+${halfWeeks} ${halfWeeks === 1 ? 'week' : 'weeks'}`
          : movedForward
            ? `-${halfWeeks} ${halfWeeks === 1 ? 'week' : 'weeks'}`
            : '';
      } else {
        differenceText = isDelayed
          ? `+${halfWeeks} weeks`
          : movedForward
            ? `-${halfWeeks} weeks`
            : '';
      }
    }
  }
  
  // Display format: latestDate <- oldestDate (differenceText)
  // Always show latest (most recent) first, then oldest (earliest)
  return (
    <span>
      <span style={{ 
        color: isDelayed ? '#de350b' : movedForward ? '#0066cc' : '#28a745', 
        fontWeight: '600' 
      }}>
        {formatDate(latestDate)}
      </span>
      {sortedDates.length > 1 && (
        <>
          <span style={{ margin: '0 4px', color: '#666' }}>←</span>
          <span style={{ 
            textDecoration: 'line-through', 
            color: '#999', 
            fontSize: '11px' 
          }}>
            {formatDate(oldestDate)}
          </span>
          {differenceText && (
            <span style={{
              color: isDelayed ? '#de350b' : movedForward ? '#0066cc' : '#666',
              fontSize: '10px',
              marginLeft: '4px',
              fontWeight: 500
            }}>
              ({differenceText})
            </span>
          )}
        </>
      )}
    </span>
  );
}

