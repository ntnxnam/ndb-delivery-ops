/**
 * Date History Processing Utilities
 * Handles extraction and processing of date history from checkpoint data
 */

import { normalizeDateStr, parseLocalDate } from './dateNormalization';

/**
 * Get all unique dates from history and current date
 * Current date is always first; remaining historical dates are sorted by date value descending.
 * De-duplication ensures a revert-to-original doesn't double-count.
 *
 * @param {Array} history - History array from checkpointHistory: [{date, changedAt}, ...]
 * @param {string|Date} currentDate - Current date value
 * @returns {Array<Date>} Current first, then historical dates by date value descending
 */
export function getAllUniqueDates(history, currentDate) {
  const currentDateStr = currentDate ? normalizeDateStr(currentDate) : null;
  const currentDateObj = currentDateStr ? parseLocalDate(currentDateStr) : null;

  // Collect historical date strings excluding the current value (handled separately)
  const histSet = new Set();
  if (Array.isArray(history) && history.length > 0) {
    history.forEach(entry => {
      if (entry && entry.date) {
        const dateStr = normalizeDateStr(entry.date);
        if (dateStr && dateStr !== currentDateStr) histSet.add(dateStr);
      }
    });
  }

  const histDates = Array.from(histSet)
    .map(dateStr => parseLocalDate(dateStr))
    .filter(d => d !== null && !isNaN(d.getTime()))
    .sort((a, b) => b - a); // historical by date value descending

  return currentDateObj ? [currentDateObj, ...histDates] : histDates;
}

/**
 * Earliest chronological set date from changelog order.
 * Uses changedAt when available; otherwise falls back to array order (snapshot path sorts oldest-first).
 * @param {Array} history
 * @returns {Date|null}
 */
export function getFirstSetDate(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  // Prefer changedAt ordering when present (live fetch); snapshot fabricates changedAt so array order is chronological.
  const hasChangedAt = history.some(e => e && e.changedAt);
  const ordered = hasChangedAt
    ? [...history].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
    : history;
  for (const entry of ordered) {
    if (entry && entry.date) {
      const ds = normalizeDateStr(entry.date);
      const d = ds ? parseLocalDate(ds) : null;
      if (d) return d;
    }
  }
  return null;
}

/**
 * Extract history for a specific item and field
 * 
 * @param {string} itemKey - Item key (e.g., 'FEAT-12345')
 * @param {string} fieldName - Field name (e.g., 'codeComplete', 'fsdsDone')
 * @param {object} checkpointHistory - Checkpoint history data indexed by item key
 * @returns {Array} History array for the specific item and field
 */
export function getHistoryForField(itemKey, fieldName, checkpointHistory) {
  // Normalize the key (trim whitespace, ensure exact match)
  const normalizedKey = itemKey ? itemKey.trim() : '';
  
  // Use exact key - FEAT and ERA are different tickets, no conversion needed
  const history = checkpointHistory?.[normalizedKey]?.[fieldName] || [];
  
  // Ensure it's an array
  return Array.isArray(history) ? history : [];
}

