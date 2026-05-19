/**
 * Date History Processing Utilities
 * Handles extraction and processing of date history from checkpoint data
 */

import { normalizeDateStr, parseLocalDate } from './dateNormalization';

/**
 * Get all unique dates from history and current date
 * Extracts dates from history entries and current date, removes duplicates, sorts chronologically
 * 
 * @param {Array} history - History array from checkpointHistory: [{date, changedAt}, ...]
 * @param {string|Date} currentDate - Current date value
 * @returns {Array<Date>} Sorted array of unique dates (newest first, reverse chronological)
 */
export function getAllUniqueDates(history, currentDate) {
  const allDates = new Set();
  
  // Add dates from history first
  if (Array.isArray(history) && history.length > 0) {
    history.forEach(entry => {
      if (entry && entry.date) {
        const dateStr = normalizeDateStr(entry.date);
        if (dateStr) {
          allDates.add(dateStr);
        }
      }
    });
  }
  
  // Add current date if it exists (this will be deduplicated if it matches a historical date)
  if (currentDate) {
    const currentDateStr = normalizeDateStr(currentDate);
    if (currentDateStr) {
      allDates.add(currentDateStr);
    }
  }
  
  // Convert to array, parse to Date objects, and sort in reverse chronological order (newest first)
  const sortedDates = Array.from(allDates)
    .map(dateStr => parseLocalDate(dateStr))
    .filter(date => date !== null && !isNaN(date.getTime()))
    .sort((a, b) => b - a); // Reverse order: newest first
  
  return sortedDates;
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

