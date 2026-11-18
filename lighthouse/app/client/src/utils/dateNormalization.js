/**
 * Date Normalization Utilities
 * Handles conversion of various date formats to standardized YYYY-MM-DD format
 */

/**
 * Normalize date string to YYYY-MM-DD format
 * Handles various input formats: ISO strings, Date objects, YYYY-MM-DD strings
 * 
 * @param {string|Date} dateValue - Date value to normalize
 * @returns {string|null} Normalized date string (YYYY-MM-DD) or null if invalid
 */
export function normalizeDateStr(dateValue) {
  if (!dateValue) return null;

  // Unwrap { value } / { date } shapes from JIRA or stored fields
  if (typeof dateValue === 'object' && !(dateValue instanceof Date)) {
    const inner = dateValue.value ?? dateValue.date ?? dateValue.display ?? null;
    return inner != null ? normalizeDateStr(inner) : null;
  }
  
  let dateStr;
  if (typeof dateValue === 'string') {
    // Handle various date formats
    if (dateValue.includes('T')) {
      // ISO format with time: "2024-01-15T10:30:00Z" -> "2024-01-15"
      dateStr = dateValue.split('T')[0];
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      // Already in YYYY-MM-DD format
      dateStr = dateValue;
    } else {
      // Try to parse as date
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        dateStr = parsed.toISOString().split('T')[0];
      } else {
        return null;
      }
    }
  } else if (dateValue instanceof Date) {
    if (!isNaN(dateValue.getTime())) {
      dateStr = dateValue.toISOString().split('T')[0];
    } else {
      return null;
    }
  } else {
    return null;
  }
  
  return dateStr && dateStr !== 'null' && dateStr !== '' ? dateStr : null;
}

/**
 * Parse date string to Date object (local timezone)
 * Avoids timezone conversion issues by parsing YYYY-MM-DD as local date
 * 
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {Date|null} Date object or null if invalid
 */
export function parseLocalDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  
  try {
    // Parse date as local date (YYYY-MM-DD) to avoid timezone conversion
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed in JS Date
    return !isNaN(date.getTime()) ? date : null;
  } catch (e) {
    return null;
  }
}

