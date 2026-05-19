import React from 'react';
import ReleaseVersionTableHeader from './ReleaseVersionTableHeader';
import ReleaseVersionTableRow from './ReleaseVersionTableRow';

/**
 * Get risk indicator priority for sorting
 * @param {*} riskIndicator - Risk indicator value
 * @returns {number} Priority (1 = highest risk, 999 = not set)
 */
function getRiskIndicatorPriority(riskIndicator) {
  if (!riskIndicator) {
    return 999; // "Not Set" goes last
  }
  
  // Handle both object format {value, color} and direct value
  let riskStr;
  if (typeof riskIndicator === 'object' && riskIndicator !== null) {
    riskStr = String(riskIndicator.value || riskIndicator).toLowerCase();
  } else {
    riskStr = String(riskIndicator).toLowerCase();
  }
  
  if (riskStr === 'not set' || riskStr === 'n/a' || riskStr.trim() === '') {
    return 999; // "Not Set" goes last
  }
  
  // Priority: Red (1 - highest risk) > Yellow (2 - medium risk) > Green (3 - low risk) > Others (4)
  if (riskStr.includes('red') || riskStr.includes('high') || riskStr.includes('critical')) {
    return 1; // Red - highest priority (highest risk)
  }
  if (riskStr.includes('yellow') || riskStr.includes('medium') || riskStr.includes('moderate') || riskStr.includes('at risk')) {
    return 2; // Yellow - medium priority
  }
  if (riskStr.includes('green') || riskStr.includes('low') || riskStr.includes('minimal') || riskStr.includes('on track')) {
    return 3; // Green - lower priority (low risk)
  }
  return 4; // Other values
}

/**
 * Extract FEAT number from JIRA key
 * @param {string} key - JIRA key (e.g., "FEAT-12345")
 * @returns {number|string} FEAT number or empty string
 */
function extractFeatNumber(key) {
  if (!key) return '';
  // If key starts with FEAT-, extract the number part
  const match = key.match(/^FEAT-(\d+)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Otherwise, try to extract any number from the key
  const numMatch = key.match(/\d+/);
  return numMatch ? parseInt(numMatch[0], 10) : '';
}

/**
 * Get JIRA Priority sort order
 * @param {string} priority - JIRA priority value
 * @returns {number} Sort order (1 = highest, 6 = N/A)
 */
function getPrioritySortOrder(priority) {
  if (!priority || priority === 'N/A' || priority === '') return 6; // N/A/null goes last
  
  const priorityStr = String(priority).toLowerCase();
  if (priorityStr.includes('highest') || priorityStr.includes('critical')) return 1;
  if (priorityStr.includes('high')) return 2;
  if (priorityStr.includes('medium')) return 3;
  if (priorityStr.includes('low')) return 4;
  if (priorityStr.includes('lowest')) return 5;
  return 6; // Unknown/N/A
}

/**
 * Parse date for sorting
 * @param {string|Date} dateValue - Date value to parse
 * @returns {Date|null} Parsed date or null
 */
function parseDateForSorting(dateValue) {
  if (!dateValue) return null;
  
  let date;
  if (typeof dateValue === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
      date = new Date(dateValue);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      date = new Date(dateValue + 'T00:00:00');
    } else {
      date = new Date(dateValue);
    }
  } else if (dateValue instanceof Date) {
    date = dateValue;
  } else {
    return null;
  }
  
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Sort items by Risk Indicator, Priority, FEAT Number, then Code Complete Date
 * @param {Array} itemsArray - Array of JIRA items
 * @returns {Array} Sorted array of items
 */
export function sortItems(itemsArray) {
  if (!itemsArray || itemsArray.length === 0) return itemsArray;
  
  return [...itemsArray].sort((a, b) => {
    // 1. Sort by Risk Indicator (priority)
    const riskA = getRiskIndicatorPriority(a.customfield_23560);
    const riskB = getRiskIndicatorPriority(b.customfield_23560);
    if (riskA !== riskB) {
      return riskA - riskB;
    }
    
    // 2. Sort by JIRA Priority (Highest > High > Medium > Low > Lowest > N/A)
    const priorityA = getPrioritySortOrder(a.priority);
    const priorityB = getPrioritySortOrder(b.priority);
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // 3. Sort by FEAT Number
    const featA = extractFeatNumber(a.key);
    const featB = extractFeatNumber(b.key);
    if (featA !== featB) {
      if (typeof featA === 'number' && typeof featB === 'number') {
        return featA - featB;
      }
      return String(featA).localeCompare(String(featB));
    }
    
    // 4. Sort by Code Complete Date (earliest first, nulls last)
    const dateA = parseDateForSorting(a.customfield_11067);
    const dateB = parseDateForSorting(b.customfield_11067);
    
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1; // null dates go last
    if (!dateB) return -1; // null dates go last
    
    return dateA - dateB; // earlier dates first
  });
}

/**
 * ReleaseVersionTableSection Component
 * 
 * Renders a table section with header, description, and table of items
 * 
 * @param {Object} props
 * @param {string} props.title - Section title (e.g., "Section 1: Commit")
 * @param {string} props.description - Section description
 * @param {Array} props.items - Array of JIRA items to display
 * @param {Object} props.columnsConfig - Column configuration object
 * @param {string} props.selectedVersion - Selected release version
 * @param {Object} props.checkpointHistory - Checkpoint history data
 * @param {string} props.jiraBaseUrl - JIRA base URL for links
 */
function ReleaseVersionTableSection({
  title,
  description,
  items,
  columnsConfig,
  selectedVersion,
  checkpointHistory,
  jiraBaseUrl,
  ganttConfig,
  breakdownDataMap,
  loadingBreakdowns
}) {
  const itemCount = items?.length || 0;
  
  return (
    <div style={{ marginBottom: '30px' }}>
      <h3>{title} ({itemCount})</h3>
      <p style={{ fontSize: '13px', color: '#6c757d', marginBottom: '10px' }}>
        {description}
      </p>
      {itemCount > 0 ? (
        <div style={{ 
          width: '100%', 
          maxWidth: '100%', 
          border: '1px solid #dee2e6', 
          boxSizing: 'border-box', 
          overflowX: 'auto' // Only horizontal scrolling, vertical scrolling handled by page
        }}>
          <table style={{ 
            width: '100%', 
            maxWidth: '100%', 
            borderCollapse: 'collapse', 
            fontSize: '12px', 
            tableLayout: 'auto' 
          }}>
            <ReleaseVersionTableHeader columnsConfig={columnsConfig} />
            <tbody>
              {sortItems(items || []).map(item => (
                <ReleaseVersionTableRow
                  key={item.key}
                  item={item}
                  columnsConfig={columnsConfig}
                  selectedVersion={selectedVersion}
                  checkpointHistory={checkpointHistory}
                  jiraBaseUrl={jiraBaseUrl}
                  ganttConfig={ganttConfig}
                  breakdownDataMap={breakdownDataMap}
                  loadingBreakdowns={loadingBreakdowns}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ fontSize: '13px', color: '#6c757d', fontStyle: 'italic' }}>
          No items found in {title.replace(/^Section \d+: /, '')} section.
        </p>
      )}
    </div>
  );
}

export default ReleaseVersionTableSection;

