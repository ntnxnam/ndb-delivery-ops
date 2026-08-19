/**
 * Fetch Field History Utility
 * 
 * Fetches JIRA changelog history for specific custom date fields and formats the output
 * with statistics about date movements.
 * 
 * @module fetchFieldHistory
 */

const axios = require('axios');
const { JIRA_API_V2 } = require('../config/api');
const { fetchAllChangelogHistories } = require('./changelogPagination');
const { createHttpsAgent, retryJiraCall } = require('../services/jiraService');
const logger = require('../utils/logger');
const {
  getAllFields,
  getFieldId,
  getFieldConfigById,
  getFieldKeyByName,
  getCheckpointDateFieldIds
} = require('./jiraFieldsConfig');

/**
 * Field mapping for all date fields we want to track
 * Now loaded from jiraFieldsConfig.json
 */
function getDateFields() {
  const allFields = getAllFields();
  const dateFields = {};
  
  // Get all checkpoint date fields (category is 'checkpointDates' in config)
  Object.entries(allFields).forEach(([key, config]) => {
    // Check if it's in checkpointDates category or has type 'date' with checkpoint category
    if ((config.category === 'checkpointDates' || config.category === 'checkpoint') && config.type === 'date') {
      dateFields[key] = config.id;
    }
  });
  
  return dateFields;
}

const DATE_FIELDS = getDateFields();

/**
 * Field name mappings (field display names that map to our field keys)
 * Now loaded from jiraFieldsConfig.json
 */
function getFieldNameMappings() {
  const config = require('../config/jiraFieldsConfig.json');
  return config.fieldNameMappings || {};
}

const FIELD_NAME_MAPPINGS = getFieldNameMappings();

/**
 * Calculate weeks difference between two dates
 * @param {Date|string} date1 - First date
 * @param {Date|string} date2 - Second date
 * @returns {number} Weeks difference (always positive, absolute value)
 */
function calculateWeeksDifference(date1, date2) {
  try {
    const d1 = typeof date1 === 'string' ? parseDate(date1) : date1;
    const d2 = typeof date2 === 'string' ? parseDate(date2) : date2;
    
    if (!d1 || !d2 || isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return 0;
    }
    
    const diffMs = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const diffWeeks = diffDays / 7;
    
    return Math.round(diffWeeks * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    return 0;
  }
}

/**
 * Parse date string to Date object
 * @param {string} dateStr - Date string (e.g., "2025-12-25" or "2025-12-25T00:00:00.000+0000")
 * @returns {Date|null} Parsed date or null if invalid
 */
function parseDate(dateStr) {
  if (!dateStr || dateStr === 'null' || dateStr === '') {
    return null;
  }
  
  try {
    // Handle ISO date strings (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return new Date(dateStr + 'T00:00:00');
    }
    // Handle ISO datetime strings
    if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) {
      return new Date(dateStr);
    }
    // Handle other date formats
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch (error) {
    return null;
  }
}

/**
 * Format date to YYYY-MM-DD string
 * @param {Date|string} date - Date to format
 * @returns {string|null} Formatted date string or null
 */
function formatDate(date) {
  if (!date) return null;
  
  try {
    const d = typeof date === 'string' ? parseDate(date) : date;
    if (!d || isNaN(d.getTime())) return null;
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  } catch (error) {
    return null;
  }
}

/**
 * Process and deduplicate date array
 * @param {string[]} dates - Array of date strings
 * @returns {string[]} Sorted unique dates (oldest first)
 */
function processDates(dates) {
  const uniqueDates = [...new Set(dates)].filter(d => d !== null && d !== undefined);
  uniqueDates.sort((a, b) => {
    const dateA = parseDate(a);
    const dateB = parseDate(b);
    if (!dateA || !dateB) return 0;
    return dateA - dateB;
  });
  return uniqueDates;
}

/**
 * Calculate statistics for a date field
 * @param {string[]} dates - Array of date strings
 * @returns {Object} Statistics object
 */
function calculateDateStatistics(dates) {
  const processedDates = processDates(dates);
  
  if (processedDates.length === 0) {
    return {
      dates: [],
      numberOfTimesMoved: 0,
      weeksDiffBetweenOldestAndLatest: 0
    };
  }
  
  if (processedDates.length === 1) {
    return {
      dates: processedDates,
      numberOfTimesMoved: 0,
      weeksDiffBetweenOldestAndLatest: 0
    };
  }
  
  // Count unique date changes (excluding the first date)
  const numberOfTimesMoved = processedDates.length - 1;
  
  // Calculate weeks difference between oldest and latest
  const oldestDate = parseDate(processedDates[0]);
  const latestDate = parseDate(processedDates[processedDates.length - 1]);
  const weeksDiff = calculateWeeksDifference(oldestDate, latestDate);
  
  return {
    dates: processedDates,
    numberOfTimesMoved,
    weeksDiffBetweenOldestAndLatest: weeksDiff
  };
}

/**
 * Fetch field history for a JIRA issue
 * 
 * @param {string} jiraKey - JIRA issue key (e.g., 'FEAT-18452')
 * @param {string} token - JIRA authentication token
 * @returns {Promise<Object>} Formatted field history data
 */
async function fetchFieldHistory(jiraKey, token, options = {}) {
  const { saveRawResponse = false, fields: fieldFilter = null } = options;
  const baseUrl = JIRA_API_V2.BASE_URL;
  const httpsAgent = createHttpsAgent();
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();

  // When the caller passes `fields: ['commitGate', 'promotionGate', ...]` we
  // restrict both the JIRA fields param and changelog processing to only those
  // logical keys.  This halves the per-call payload for the SoS endpoint which
  // only cares about CC / CG / PG.
  const activeFields = fieldFilter
    ? Object.fromEntries(Object.entries(DATE_FIELDS).filter(([k]) => fieldFilter.includes(k)))
    : DATE_FIELDS;
  
  const issueUrl = `${baseUrl}/rest/api/2/issue/${jiraKey}`;
  
  try {
    // Fetch issue with current field values
    const issueResponse = await retryJiraCall(() => axios.get(issueUrl, {
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      httpsAgent: httpsAgent,
      timeout: 30000,
      params: {
        expand: 'changelog',
        fields: Object.values(activeFields).join(',')
      }
    }));
    
    const issue = issueResponse.data;
    const rawResponse = saveRawResponse ? {
      issue: issue,
      changelog: issue.changelog,
      fields: issue.fields
    } : null;
    const fields = issue.fields || {};
    
    // Get current field values (restricted to activeFields)
    const currentValues = {};
    Object.keys(activeFields).forEach(key => {
      currentValues[key] = fields[activeFields[key]] || null;
    });
    
    // Fetch all changelog histories using pagination utility
    const paginationResult = await fetchAllChangelogHistories(
      baseUrl,
      jiraKey,
      issue.id || null,
      cleanToken,
      httpsAgent,
      retryJiraCall,
      logger,
      issue // Pass pre-fetched issue to avoid duplicate API call
    );
    
    const histories = paginationResult.histories;
    
    // Track historical dates for each active field only
    const historyData = {};
    Object.keys(activeFields).forEach(key => {
      historyData[key] = [];
    });
    
    // Build a fast lookup set of active field IDs for changelog filtering
    const activeFieldIds = new Set(Object.values(activeFields));

    // Process changelog to find field changes
    histories.forEach(history => {
      const items = history.items || [];
      
      items.forEach(item => {
        const fieldId = item.fieldId;
        const fieldName = item.field;
        const fromValue = item.fromString || item.from;
        const toValue = item.toString || item.to;
        
        // Find which field this change belongs to
        // First try by fieldId, then by field name
        let matchingFieldKey = null;
        
        // Try matching by fieldId first using config
        if (fieldId) {
          // Skip immediately if this fieldId isn't in our active set
          if (!activeFieldIds.has(fieldId)) return;
          const fieldConfig = getFieldConfigById(fieldId);
          if (fieldConfig && fieldConfig.category === 'checkpoint' && fieldConfig.type === 'date') {
            matchingFieldKey = fieldConfig.logicalKey;
          }
        }
        
        // If no match by fieldId, try matching by field name using config
        if (!matchingFieldKey && fieldName) {
          const fieldNameLower = fieldName.toLowerCase().trim();
          
          // Try exact match first
          const candidate = getFieldKeyByName(fieldNameLower);
          if (candidate && activeFields[candidate]) {
            matchingFieldKey = candidate;
          }
          
          // If no exact match, try partial match against active fields only
          if (!matchingFieldKey) {
            const mappings = FIELD_NAME_MAPPINGS;
            for (const [namePattern, key] of Object.entries(mappings)) {
              if (!activeFields[key]) continue;
              if (fieldNameLower.includes(namePattern) || namePattern.includes(fieldNameLower)) {
                matchingFieldKey = key;
                break;
              }
            }
          }
        }
        
        // If we found a matching field, track the date values
        if (matchingFieldKey && historyData[matchingFieldKey] !== undefined) {
          // Track both from and to values if they are valid dates
          // This captures all dates that have been set (both old and new values)
          if (fromValue && fromValue !== 'null' && fromValue !== '' && fromValue !== null) {
            const date = formatDate(fromValue);
            if (date) {
              historyData[matchingFieldKey].push(date);
            }
          }
          if (toValue && toValue !== 'null' && toValue !== '' && toValue !== null) {
            const date = formatDate(toValue);
            if (date) {
              historyData[matchingFieldKey].push(date);
            }
          }
        } else if (!matchingFieldKey && (fieldId || fieldName)) {
          // Debug: log items we're not matching (only for date-like fields)
          const looksLikeDate = (val) => {
            if (!val || val === 'null' || val === '') return false;
            return /^\d{4}-\d{2}-\d{2}/.test(val) || /^\d{2}\/\d{2}\/\d{4}/.test(val);
          };
          if (looksLikeDate(fromValue) || looksLikeDate(toValue)) {
            console.log(`[FieldHistory Debug] ${jiraKey} - Unmatched date field: fieldId="${fieldId}", field="${fieldName}", from="${fromValue}", to="${toValue}"`);
          }
        }
      });
    });
    
    // Add current values for active fields if they exist and are dates
    Object.keys(activeFields).forEach(key => {
      if (currentValues[key]) {
        const date = formatDate(currentValues[key]);
        if (date) {
          historyData[key].push(date);
        }
      }
    });
    
    // Calculate statistics for each active field; default empty stats for inactive ones
    const emptyStats = { dates: [], numberOfTimesMoved: 0, weeksDiffBetweenOldestAndLatest: 0 };
    const statistics = {};
    Object.keys(DATE_FIELDS).forEach(key => {
      statistics[key] = activeFields[key]
        ? calculateDateStatistics(historyData[key] || [])
        : { ...emptyStats };
    });
    
    // Build result object with the requested format
    // CG = Commit Gate (customfield_35863); CCM = Code Complete Milestone (customfield_11067)
    const commitGateStats = statistics.commitGate;
    const promotionGateStats = statistics.promotionGate;
    
    const result = {
      key: jiraKey,
      // Commit Gate (CG) data
      codeCompleteDate: commitGateStats.dates,
      numberofTimesCCMDateMoved: commitGateStats.numberOfTimesMoved,
      WeeksDiffbwOldestandLatestCCMDate: commitGateStats.weeksDiffBetweenOldestAndLatest,
      // Promotion Gate (PG) data
      PGCompleteDate: promotionGateStats.dates,
      // Additional date fields with full statistics
      testPlanDate: statistics.testPlan.dates,
      numberOfTimesTestPlanDateMoved: statistics.testPlan.numberOfTimesMoved,
      weeksDiffBetweenOldestAndLatestTestPlanDate: statistics.testPlan.weeksDiffBetweenOldestAndLatest,
      fsdsDoneDate: statistics.fsdsDone.dates,
      numberOfTimesFSDSDoneDateMoved: statistics.fsdsDone.numberOfTimesMoved,
      weeksDiffBetweenOldestAndLatestFSDSDoneDate: statistics.fsdsDone.weeksDiffBetweenOldestAndLatest,
      codeCompleteDateFull: statistics.codeComplete.dates,
      numberOfTimesCodeCompleteDateMoved: statistics.codeComplete.numberOfTimesMoved,
      weeksDiffBetweenOldestAndLatestCodeCompleteDate: statistics.codeComplete.weeksDiffBetweenOldestAndLatest,
      statusUpdateDate: statistics.statusUpdateDate.dates,
      numberOfTimesStatusUpdateDateMoved: statistics.statusUpdateDate.numberOfTimesMoved,
      weeksDiffBetweenOldestAndLatestStatusUpdateDate: statistics.statusUpdateDate.weeksDiffBetweenOldestAndLatest
    };
    
    // Add raw response if requested
    if (rawResponse) {
      result._rawResponse = rawResponse;
    }
    
    return result;
    
  } catch (error) {
    console.error(`Error fetching field history for ${jiraKey}:`, error);
    throw new Error(`Failed to fetch field history: ${error.message}`);
  }
}

/**
 * Fetch field history for multiple JIRA issues.
 *
 * Processes keys sequentially with a 300ms inter-item delay to stay within
 * JIRA changelog API rate limits. Parallel batching caused timeout bursts
 * when the SoS filter returns many tickets.
 *
 * @param {string[]} jiraKeys - Array of JIRA issue keys
 * @param {string} token - JIRA authentication token
 * @param {object} [options]
 * @param {string[]} [options.fields] - Restrict to specific field keys (e.g. ['commitGate','promotionGate','codeComplete'])
 * @returns {Promise<Object[]>} Array of formatted field history data
 */
async function fetchFieldHistoryForMultiple(jiraKeys, token, options = {}) {
  const INTER_ITEM_DELAY_MS = 300;
  const results = [];

  for (let i = 0; i < jiraKeys.length; i++) {
    const jiraKey = jiraKeys[i];
    try {
      const result = await fetchFieldHistory(jiraKey, token, options);
      results.push(result);
    } catch (error) {
      console.error(`Error fetching history for ${jiraKey}:`, error);
      results.push({
        key: jiraKey,
        error: error.message,
        codeCompleteDate: [],
        numberofTimesCCMDateMoved: 0,
        WeeksDiffbwOldestandLatestCCMDate: 0,
        PGCompleteDate: []
      });
    }

    if (i < jiraKeys.length - 1) {
      await new Promise(resolve => setTimeout(resolve, INTER_ITEM_DELAY_MS));
    }
  }

  return results;
}

/**
 * Transform field history JSON to checkpoint history format expected by UI
 * 
 * @param {Array} fieldHistoryData - Array from JIRA-fields-history-for-project-dates.json
 * @returns {Object} Transformed data in format: { [key]: { [fieldName]: [{date, changedAt}] } }
 */
function transformFieldHistoryToCheckpointHistory(fieldHistoryData) {
  const checkpointHistory = {};
  
  // Field name mapping from JSON keys to UI field names
  const fieldMapping = {
    'codeCompleteDate': 'commitGate',        // Commit Gate (CG) - customfield_35863
    'PGCompleteDate': 'promotionGate',      // Promotion Gate - customfield_35864
    'testPlanDate': 'testPlan',             // Test Plan - customfield_11068
    'fsdsDoneDate': 'fsdsDone',             // FS/DS Done - customfield_13861
    'codeCompleteDateFull': 'codeComplete',  // Code Complete - customfield_11067
    'statusUpdateDate': 'statusUpdateDate'   // Status Update Date - customfield_45660
  };
  
  fieldHistoryData.forEach(item => {
    const key = item.key;
    if (!key) return;
    
    checkpointHistory[key] = {};
    
    // Transform each date field
    Object.keys(fieldMapping).forEach(jsonField => {
      const dates = item[jsonField];
      const uiFieldName = fieldMapping[jsonField];
      
      if (Array.isArray(dates) && dates.length > 0) {
        // Convert date strings to history entries
        // Sort dates chronologically (oldest first) to maintain order
        const sortedDates = [...dates].sort((a, b) => {
          const dateA = new Date(a);
          const dateB = new Date(b);
          return dateA - dateB;
        });
        
        checkpointHistory[key][uiFieldName] = sortedDates.map((date, index) => ({
          date: date,
          changedAt: new Date().toISOString(), // We don't have exact change time from JSON
          isCurrent: index === sortedDates.length - 1 // Last date is current
        }));
      } else {
        // Initialize empty array for fields with no dates
        checkpointHistory[key][uiFieldName] = [];
      }
    });
  });
  
  return checkpointHistory;
}

module.exports = {
  fetchFieldHistory,
  fetchFieldHistoryForMultiple,
  transformFieldHistoryToCheckpointHistory,
  DATE_FIELDS
};

