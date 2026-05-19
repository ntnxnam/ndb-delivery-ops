/**
 * Shared date formatting utilities for both UI and Email
 * Returns HTML strings that can be used in React (via dangerouslySetInnerHTML) and Email
 */

/**
 * Normalize date string to YYYY-MM-DD format
 * @param {any} dateValue - Date value (string, Date object, etc.)
 * @returns {string|null} - Normalized date string or null
 */
function normalizeDateStr(dateValue) {
  if (!dateValue) return null;
  
  let dateStr;
  if (typeof dateValue === 'string') {
    // Handle various date formats
    if (dateValue.includes('T')) {
      dateStr = dateValue.split('T')[0];
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      dateStr = dateValue; // Already in YYYY-MM-DD format
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
 * Format date as dd/MMM/yyyy
 * @param {any} dateValue - Date value (string, Date object, etc.)
 * @returns {string|null} - Formatted date string or null
 */
function formatDate(dateValue) {
  if (!dateValue) return 'Not Set';
  try {
    // Parse date as local date (YYYY-MM-DD) to avoid timezone issues
    const dateStr = normalizeDateStr(dateValue);
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed in JS Date
    
    if (isNaN(date.getTime())) return null;
    const dayStr = String(date.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthStr = monthNames[date.getMonth()];
    const yearStr = date.getFullYear();
    return `${dayStr}/${monthStr}/${yearStr}`;
  } catch {
    return null;
  }
}

/**
 * Format date with history - returns HTML string
 * @param {string} itemKey - JIRA item key (e.g., 'ERA-12345')
 * @param {string} fieldName - Field name (e.g., 'codeComplete', 'fsdsDone')
 * @param {any} currentDate - Current date value
 * @param {object} checkpointHistory - History object: { [key]: { [fieldName]: [{date, changedAt}] } }
 * @returns {string} HTML string
 */
function formatDateWithHistoryHTML(itemKey, fieldName, currentDate, checkpointHistory = {}) {
  const normalizedKey = (itemKey != null && itemKey !== '') ? String(itemKey).trim() : '';
  const history = checkpointHistory[normalizedKey]?.[fieldName] || [];
  
  // Get all unique dates from history
  const allDates = new Set();
  history.forEach(entry => {
    if (entry && entry.date) {
      const dateStr = normalizeDateStr(entry.date);
      if (dateStr) {
        allDates.add(dateStr);
      }
    }
  });
  
  // Add current date if it exists
  if (currentDate) {
    const currentDateStr = normalizeDateStr(currentDate);
    if (currentDateStr) {
      allDates.add(currentDateStr);
    }
  }
  
  // Convert to array and sort in reverse chronological order (newest first)
  const sortedDates = Array.from(allDates)
    .map(dateStr => {
      try {
        // Parse date as local date (YYYY-MM-DD) to avoid timezone conversion
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day); // month is 0-indexed in JS Date
      } catch (e) {
        return null;
      }
    })
    .filter(date => date !== null && !isNaN(date.getTime()))
    .sort((a, b) => b - a); // Reverse order: newest first
  
  if (sortedDates.length === 0) {
    // If no dates in history and no current date, show "Not Set"
    if (!currentDate) {
      return '<span style="color: #999; font-style: italic;">Not Set</span>';
    }
    const formatted = formatDate(currentDate);
    return formatted ? `<span style="color: #28a745; font-weight: 600;">${formatted}</span>` : '<span style="color: #999; font-style: italic;">Not Set</span>';
  }
  
  // If only one date, just show it (no history to display)
  if (sortedDates.length === 1) {
    const formatted = formatDate(sortedDates[0]);
    return formatted ? `<span style="color: #28a745; font-weight: 600;">${formatted}</span>` : '<span style="color: #999; font-style: italic;">Not Set</span>';
  }
  
  // Get the newest (first) and oldest (last) dates to determine if delayed
  const newestDate = sortedDates[0];
  const oldestDate = sortedDates[sortedDates.length - 1];
  const isDelayed = newestDate > oldestDate; // Newest is later than oldest = delayed
  
  // Calculate delay in days
  let delayText = '';
  if (isDelayed && sortedDates.length > 1) {
    const delayMs = newestDate.getTime() - oldestDate.getTime();
    const delayDays = Math.floor(delayMs / (1000 * 60 * 60 * 24));
    
    if (delayDays <= 3) {
      // Show exact days for 3 days or less
      delayText = `+${delayDays} ${delayDays === 1 ? 'day' : 'days'}`;
    } else {
      // Round to half-weeks for more than 3 days
      const weeks = delayDays / 7;
      const halfWeeks = Math.round(weeks * 2) / 2; // Round to nearest 0.5
      
      if (halfWeeks === Math.floor(halfWeeks)) {
        // Whole weeks
        delayText = `+${halfWeeks} ${halfWeeks === 1 ? 'week' : 'weeks'}`;
      } else {
        // Half weeks
        delayText = `+${halfWeeks} weeks`;
      }
    }
  }
  
  // Display all dates in reverse chronological order
  const dateElements = sortedDates.map((date, index) => {
    const formatted = formatDate(date);
    if (!formatted) return null;
    
    if (index === 0) {
      // Current date (newest) - color based on delay
      const color = isDelayed ? '#de350b' : '#28a745';
      return `<span style="color: ${color}; font-weight: 600;">${formatted}${delayText ? ` <span style="color: #de350b; font-size: 10px; margin-left: 6px; font-weight: 500;">${delayText}</span>` : ''}</span>`;
    } else {
      // Historical dates - strikethrough
      return `<span style="text-decoration: line-through; color: #999; font-size: 11px;">${formatted}</span>`;
    }
  }).filter(el => el !== null);
  
  // Join with arrows
  return dateElements.join(' <span style="color: #666; margin: 0 4px;">→</span> ') || '<span style="color: #999; font-style: italic;">Not Set</span>';
}

/**
 * Format all checkpoint dates in a single column - returns HTML string
 * @param {object} item - JIRA item object
 * @param {string} selectedVersion - Selected release version
 * @param {object} checkpointHistory - History object
 * @returns {string} HTML string
 */
function formatAllCheckpointDatesHTML(item, selectedVersion, checkpointHistory = {}) {
  const dates = [
    { label: 'FS/DS Done Date', field: 'fsdsDone', value: item.customfield_13861 },
    { label: 'Test Plan Date', field: 'testPlan', value: item.customfield_11068 },
    { label: 'Code Complete Date', field: 'codeComplete', value: item.customfield_11067 },
    { label: 'Commit Gate Ready Estimation Date', field: 'commitGate', value: item.customfield_35863 },
    { label: 'Promotion Gate Ready Estimation Date', field: 'promotionGate', value: item.customfield_35864 }
  ];
  
  // Helper to get extension label and date from item
  const getExtensionLabelInfo = (item) => {
    if (!item.labels || !selectedVersion) return null;
    const labels = Array.isArray(item.labels) ? item.labels : (item.labels.split ? item.labels.split(',').map(l => l.trim()) : []);
    const versionLabel = selectedVersion.toLowerCase();
    
    // Pattern: <release-number>-<ddmmyyyy>-code-complete-extention-recieved
    // Example: ndb-2.11-28feb2026-code-complete-extention-recieved
    const extensionPattern = new RegExp(`^${versionLabel.replace(/\./g, '\\.')}-(\\d{1,2}[a-z]{3}\\d{4})-code-complete-extention-recieved$`, 'i');
    
    for (const label of labels) {
      const match = label.toLowerCase().match(extensionPattern);
      if (match) {
        return {
          label: label,
          dateStr: match[1], // e.g., "28feb2026"
          hasExtension: true
        };
      }
    }
    return null;
  };
  
  // Helper function to get color for extension date
  const getExtensionColor = (dateStr) => {
    if (!dateStr) return { backgroundColor: '#e3f2fd', borderColor: '#2196f3' };
    
    // Define color palette for different extension dates
    // Using a hash-based approach to consistently assign colors
    const colors = [
      { backgroundColor: '#e3f2fd', borderColor: '#2196f3' }, // Blue
      { backgroundColor: '#fff3e0', borderColor: '#ff9800' }, // Orange
      { backgroundColor: '#f3e5f5', borderColor: '#9c27b0' }, // Purple
      { backgroundColor: '#e8f5e9', borderColor: '#4caf50' }, // Green
      { backgroundColor: '#fce4ec', borderColor: '#e91e63' }, // Pink
      { backgroundColor: '#e0f2f1', borderColor: '#009688' }, // Teal
      { backgroundColor: '#fff9c4', borderColor: '#fbc02d' }, // Yellow
      { backgroundColor: '#e1bee7', borderColor: '#8e24aa' }, // Deep Purple
    ];
    
    // Simple hash function to consistently map date strings to colors
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
      hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };
  
  // Helper to normalize date for comparison
  const normalizeDateForComparison = (dateValue) => {
    if (!dateValue) return null;
    try {
      if (typeof dateValue === 'string') {
        if (dateValue.includes('T')) {
          return new Date(dateValue);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
          const [year, month, day] = dateValue.split('-').map(Number);
          return new Date(year, month - 1, day);
        }
        return new Date(dateValue);
      } else if (dateValue instanceof Date) {
        return dateValue;
      }
      return null;
    } catch {
      return null;
    }
  };
  
  const extensionInfo = getExtensionLabelInfo(item);
  
  // Normalize and compare FS/DS Done Date and Test Plan Date
  const fsdsDate = normalizeDateForComparison(item.customfield_13861);
  const testPlanDate = normalizeDateForComparison(item.customfield_11068);
  
  // Determine highlighting conditions
  let fsdsHighlight = null; // null, 'yellow', or 'red'
  let testPlanHighlight = null;
  
  if (fsdsDate instanceof Date && testPlanDate instanceof Date) {
    // Compare dates by normalizing to YYYY-MM-DD for accurate comparison
    const fsdsYear = fsdsDate.getFullYear();
    const fsdsMonth = fsdsDate.getMonth();
    const fsdsDay = fsdsDate.getDate();
    
    const testPlanYear = testPlanDate.getFullYear();
    const testPlanMonth = testPlanDate.getMonth();
    const testPlanDay = testPlanDate.getDate();
    
    // Check if dates are the same (same year, month, day)
    if (fsdsYear === testPlanYear && fsdsMonth === testPlanMonth && fsdsDay === testPlanDay) {
      // Dates are the same - highlight both with yellow
      fsdsHighlight = 'yellow';
      testPlanHighlight = 'yellow';
    } 
    // Check if FS/DS Done Date is after Test Plan Date
    else if (fsdsDate.getTime() > testPlanDate.getTime()) {
      // FS/DS Done Date is after Test Plan Date - highlight both with red
      fsdsHighlight = 'red';
      testPlanHighlight = 'red';
    }
  }
  
  let html = '<div style="line-height: 1.8; font-size: 11px;">';
  dates.forEach((date, index) => {
    // Determine if this date should be highlighted
    let highlightStyle = '';
    if (date.field === 'fsdsDone' && fsdsHighlight) {
      highlightStyle = fsdsHighlight === 'red' 
        ? 'border: 2px solid #de350b; border-radius: 4px; padding: 4px; background-color: #ffeaea;'
        : 'border: 2px solid #ffc107; border-radius: 4px; padding: 4px; background-color: #fffbf0;';
    } else if (date.field === 'testPlan' && testPlanHighlight) {
      highlightStyle = testPlanHighlight === 'red'
        ? 'border: 2px solid #de350b; border-radius: 4px; padding: 4px; background-color: #ffeaea;'
        : 'border: 2px solid #ffc107; border-radius: 4px; padding: 4px; background-color: #fffbf0;';
    }
    
    // Add extension label highlighting for Code Complete Date with color based on extension date
    if (date.field === 'codeComplete' && extensionInfo) {
      const extensionColor = getExtensionColor(extensionInfo.dateStr);
      highlightStyle += ` background-color: ${extensionColor.backgroundColor}; border: 2px solid ${extensionColor.borderColor}; border-radius: 4px; padding: 4px;`;
    }
    
    const formattedDate = formatDateWithHistoryHTML(item.key, date.field, date.value, checkpointHistory);
    
    html += `<div style="margin-bottom: ${index < dates.length - 1 ? '8px' : '0'}; ${highlightStyle}">`;
    html += `<div style="font-weight: 600; color: #495057; margin-bottom: 2px; font-size: 10px;">${date.label}:</div>`;
    html += `<div style="padding-left: 4px;">${formattedDate}</div>`;
    html += '</div>';
  });
  html += '</div>';
  return html;
}

module.exports = {
  normalizeDateStr,
  formatDate,
  formatDateWithHistoryHTML,
  formatAllCheckpointDatesHTML
};

