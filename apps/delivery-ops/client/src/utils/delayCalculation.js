/**
 * Delay Calculation Utilities
 * Calculates and formats delay durations between dates
 */

/**
 * Calculate delay duration in days/half-weeks
 * Formats delay as "+X days" for 3 days or less, or "+X weeks" for longer delays
 * 
 * @param {Date} newestDate - Newest date (later)
 * @param {Date} oldestDate - Oldest date (earlier)
 * @returns {string} Delay text (e.g., "+3 days" or "+2.5 weeks") or empty string if no delay
 */
export function calculateDelayDuration(newestDate, oldestDate) {
  if (!newestDate || !oldestDate || newestDate <= oldestDate) {
    return '';
  }
  
  const delayMs = newestDate.getTime() - oldestDate.getTime();
  const delayDays = Math.floor(delayMs / (1000 * 60 * 60 * 24));
  
  if (delayDays <= 3) {
    // Show exact days for 3 days or less
    return `+${delayDays} ${delayDays === 1 ? 'day' : 'days'}`;
  } else {
    // Round to half-weeks for more than 3 days
    const weeks = delayDays / 7;
    const halfWeeks = Math.round(weeks * 2) / 2; // Round to nearest 0.5
    
    if (halfWeeks === Math.floor(halfWeeks)) {
      // Whole weeks
      return `+${halfWeeks} ${halfWeeks === 1 ? 'week' : 'weeks'}`;
    } else {
      // Half weeks
      return `+${halfWeeks} weeks`;
    }
  }
}

/**
 * Determine if dates show a delay (newest date is later than oldest)
 * 
 * @param {Date} newestDate - Newest date
 * @param {Date} oldestDate - Oldest date
 * @returns {boolean} True if newest date is later than oldest (indicating delay)
 */
export function isDelayed(newestDate, oldestDate) {
  if (!newestDate || !oldestDate) return false;
  return newestDate > oldestDate; // Newest is later than oldest = delayed
}

