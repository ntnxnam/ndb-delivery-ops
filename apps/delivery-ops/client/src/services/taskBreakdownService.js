/**
 * Task Breakdown Service
 * Centralized service for fetching and caching JIRA issue breakdown data
 */

import { authenticatedPost } from '../utils/api';

// Cache for breakdown data with TTL
const breakdownCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {Object} data - Breakdown data
 * @property {number} timestamp - When cached
 */

/**
 * Clear expired cache entries
 */
function clearExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of breakdownCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      breakdownCache.delete(key);
    }
  }
}

/**
 * Get breakdown data from cache if valid
 * @param {string} jiraKey - JIRA key to check
 * @returns {Object|null} Cached data or null
 */
function getCachedBreakdown(jiraKey) {
  clearExpiredCache();
  const entry = breakdownCache.get(jiraKey);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

/**
 * Cache breakdown data
 * @param {string} jiraKey - JIRA key
 * @param {Object} data - Breakdown data to cache
 */
function setCachedBreakdown(jiraKey, data) {
  breakdownCache.set(jiraKey, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Process raw tickets data client-side to generate breakdown
 * @param {Array} tickets - Array of ticket objects from API
 * @param {number} totalCount - Total count from API
 * @returns {Object} Processed breakdown data
 */
function processTicketsClientSide(tickets, totalCount) {
  // Categorize status based on actual JIRA workflow statuses
  const categorizeStatus = (status) => {
    switch (status) {
      case 'Done':
      case 'Closed':
        return 'Done';
      case 'Resolved':
        return 'To Be Verified';
      case 'In Progress':
      case 'Development':
      case 'Code Review':
      case 'In Review':
      case 'Testing':
      case 'QA':
      case 'UAT':
      case 'Pending Merge':
        return 'In Progress';
      case 'To Do':
      case 'Open':
      case 'Backlog':
      case 'New':
      case 'Ready':
      case 'Ready for Development':
      case 'Selected for Development':
        return 'To Do';
      case 'Blocked':
      case 'On Hold':
      case 'Need Info':
      case 'Needs Info':
      case 'Waiting':
      case 'Waiting for Information':
      case 'Pending':
        return 'Blocked';
      default:
        return 'Other';
    }
  };

  // Separate Done/Closed tickets from outstanding tickets
  const doneTickets = tickets.filter(ticket => 
    ticket.status === 'Done' || ticket.status === 'Closed'
  );
  const outstandingTickets = tickets.filter(ticket => 
    ticket.status !== 'Done' && ticket.status !== 'Closed'
  );

  // Build breakdown from outstanding tickets only
  const breakdown = {};
  
  outstandingTickets.forEach(ticket => {
    const issueType = ticket.issueType;
    const status = ticket.status;

    if (!breakdown[issueType]) {
      breakdown[issueType] = {
        total: 0,
        statuses: {}
      };
    }
    
    breakdown[issueType].total++;
    if (!breakdown[issueType].statuses[status]) {
      breakdown[issueType].statuses[status] = 0;
    }
    breakdown[issueType].statuses[status]++;
  });

  // Format the breakdown with status categories
  const formattedBreakdown = Object.entries(breakdown).map(([type, data]) => {
    const statusCategories = {
      'Done': {},
      'To Be Verified': {},
      'In Progress': {},
      'To Do': {},
      'Blocked': {},
      'Other': {}
    };
    
    Object.entries(data.statuses).forEach(([status, count]) => {
      const category = categorizeStatus(status);
      statusCategories[category][status] = count;
    });
    
    return {
      type,
      total: data.total,
      statusCategories
    };
  }).sort((a, b) => b.total - a.total);

  // Calculate overall completion statistics
  let totalDone = doneTickets.length; // Count of Done/Closed tickets
  let totalToBeVerified = 0;
  let totalInProgress = 0;
  let totalToDo = 0;
  let totalBlocked = 0;
  let totalOther = 0;

  formattedBreakdown.forEach(({ statusCategories }) => {
    Object.values(statusCategories['To Be Verified']).forEach(count => totalToBeVerified += count);
    Object.values(statusCategories['In Progress']).forEach(count => totalInProgress += count);
    Object.values(statusCategories['To Do']).forEach(count => totalToDo += count);
    Object.values(statusCategories['Blocked']).forEach(count => totalBlocked += count);
    Object.values(statusCategories['Other']).forEach(count => totalOther += count);
  });

  const overallStats = {
    done: totalDone,
    toBeVerified: totalToBeVerified,
    inProgress: totalInProgress,
    toDo: totalToDo,
    blocked: totalBlocked,
    other: totalOther,
    completionRate: totalCount > 0 ? (((totalDone + totalToBeVerified) / totalCount) * 100).toFixed(1) : '0.0'
  };

  return {
    total: totalCount, // True total (including Done/Closed)
    breakdown: formattedBreakdown,
    overallStats: overallStats,
    outstandingCount: outstandingTickets.length // Count of remaining work
  };
}

/**
 * Fetch breakdown data for a single JIRA key
 * @param {string} jiraKey - JIRA key to fetch breakdown for
 * @param {string} jiraToken - JIRA authentication token
 * @param {string} username - Username for API call
 * @returns {Promise<Object>} Breakdown data
 */
async function fetchSingleBreakdown(jiraKey, jiraToken, username) {
  // Check cache first
  const cached = getCachedBreakdown(jiraKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await authenticatedPost('/api/jira/issue-breakdown', {
      jiraKey: jiraKey.trim()
    }, { jiraToken, username });

    if (response.data.success) {
      // Check if this is the new client-processing format
      if (response.data.clientProcessing && response.data.tickets) {
        const breakdownData = processTicketsClientSide(response.data.tickets, response.data.total);
        breakdownData.jiraSearchUrl = response.data.jiraSearchUrl;
        breakdownData.outstandingUrl = response.data.outstandingUrl;
        
        // Cache the result
        setCachedBreakdown(jiraKey, breakdownData);
        return breakdownData;
      } else {
        // Legacy server-processed format
        const breakdownData = {
          total: response.data.total,
          breakdown: response.data.breakdown,
          overallStats: response.data.overallStats,
          jiraSearchUrl: response.data.jiraSearchUrl
        };
        
        // Cache the result
        setCachedBreakdown(jiraKey, breakdownData);
        return breakdownData;
      }
    } else {
      console.warn(`Failed to fetch breakdown for ${jiraKey}:`, response.data.error);
      return null;
    }
  } catch (err) {
    console.warn(`Error fetching breakdown for ${jiraKey}:`, err.message);
    return null;
  }
}

/**
 * Fetch breakdown data using optimized bulk API
 * @param {string[]} jiraKeys - Array of JIRA keys
 * @param {string} jiraToken - JIRA authentication token 
 * @param {string} username - Username for API call
 * @returns {Promise<Object>} Bulk response with results for each key
 */
async function fetchBulkBreakdown(jiraKeys, jiraToken, username) {
  try {
    const response = await authenticatedPost('/api/jira/issue-breakdown', {
      jiraKeys: jiraKeys
    }, { jiraToken, username });

    if (response.data.success && response.data.isBulk) {
      return response.data.results;
    } else {
      console.warn('Unexpected bulk response format:', response.data);
      return {};
    }
  } catch (err) {
    console.warn('Error in bulk breakdown fetch:', err.message);
    throw err;
  }
}

/**
 * Fetch breakdown data using individual requests (fallback method)
 * @param {string[]} uncachedKeys - Keys that need fetching
 * @param {string} jiraToken - JIRA authentication token
 * @param {string} username - Username for API call
 * @param {Map} results - Results map to populate
 */
async function fetchIndividualBreakdowns(uncachedKeys, jiraToken, username, results) {
  // Batch uncached keys with concurrency limit
  const BATCH_SIZE = 5;
  const batches = [];
  for (let i = 0; i < uncachedKeys.length; i += BATCH_SIZE) {
    batches.push(uncachedKeys.slice(i, i + BATCH_SIZE));
  }

  // Process batches sequentially to respect rate limits
  for (const batch of batches) {
    const promises = batch.map(key => 
      fetchSingleBreakdown(key, jiraToken, username)
        .then(data => ({ key, data }))
        .catch(err => ({ key, data: null, error: err.message }))
    );

    const batchResults = await Promise.all(promises);
    
    batchResults.forEach(({ key, data, error }) => {
      if (data) {
        results.set(key, data);
      } else if (error) {
        console.warn(`Failed to fetch breakdown for ${key}:`, error);
        results.set(key, null);
      }
    });
  }
}

/**
 * Fetch breakdown data for multiple JIRA keys with smart bulk optimization
 * @param {string[]} jiraKeys - Array of JIRA keys
 * @param {string} jiraToken - JIRA authentication token 
 * @param {string} username - Username for API call
 * @returns {Promise<Map<string, Object>>} Map of jiraKey -> breakdown data
 */
export async function fetchBreakdownsForKeys(jiraKeys, jiraToken, username) {
  const results = new Map();
  
  if (!jiraKeys || jiraKeys.length === 0) {
    return results;
  }

  // Deduplicate keys
  const uniqueKeys = [...new Set(jiraKeys.filter(key => key && key.trim()))];
  
  if (uniqueKeys.length === 0) {
    return results;
  }

  // Check cache first and separate cached vs non-cached keys
  const cachedKeys = [];
  const uncachedKeys = [];
  
  for (const key of uniqueKeys) {
    const cached = getCachedBreakdown(key);
    if (cached) {
      results.set(key, cached);
      cachedKeys.push(key);
    } else {
      uncachedKeys.push(key);
    }
  }

  console.log(`[fetchBreakdownsForKeys] Found ${cachedKeys.length} cached, ${uncachedKeys.length} need fetching`);
  
  // If all are cached, return early
  if (uncachedKeys.length === 0) {
    return results;
  }

  // Smart bulk vs individual request decision
  // Bulk mode disabled: the server-side attribution in groupBreakdownByProject
  // can't correctly map tickets back to parent FEATs (required custom fields
  // are not fetched). Individual requests use JQL functions that are accurate.
  const BULK_THRESHOLD = Infinity;
  
  if (uncachedKeys.length >= BULK_THRESHOLD) {
    console.log(`[fetchBreakdownsForKeys] Using bulk API for ${uncachedKeys.length} keys`);
    
    try {
      // Single bulk request for all uncached keys
      const bulkResults = await fetchBulkBreakdown(uncachedKeys, jiraToken, username);
      
      // Process bulk results and cache them
      uncachedKeys.forEach(key => {
        const bulkResult = bulkResults[key];
        // Processing breakdown data for key
        
        if (bulkResult && bulkResult.success) {
          const breakdownData = {
            total: bulkResult.total,
            breakdown: bulkResult.breakdown,
            overallStats: bulkResult.overallStats
          };
          
          // Breakdown data loaded successfully
          
          // Cache the result
          setCachedBreakdown(key, breakdownData);
          results.set(key, breakdownData);
        } else {
          console.warn(`No bulk result for ${key}, available keys:`, Object.keys(bulkResults));
          results.set(key, null);
        }
      });
      
    } catch (error) {
      console.warn('Bulk fetch failed, falling back to individual requests:', error.message);
      
      // Fallback to individual requests if bulk fails
      await fetchIndividualBreakdowns(uncachedKeys, jiraToken, username, results);
    }
    
  } else {
    console.log(`[fetchBreakdownsForKeys] Using individual requests for ${uncachedKeys.length} keys`);
    await fetchIndividualBreakdowns(uncachedKeys, jiraToken, username, results);
  }

  return results;
}

/**
 * Format breakdown data for compact display
 * @param {Object} breakdownData - Raw breakdown data from API
 * @returns {string} Formatted display string
 */
export function formatBreakdownForDisplay(breakdownData) {
  if (!breakdownData || !breakdownData.breakdown || breakdownData.breakdown.length === 0) {
    return 'No sub-tasks found';
  }

  const parts = [];
  
  // Sort breakdown by total count (descending) and take top issue types
  const sortedBreakdown = breakdownData.breakdown
    .sort((a, b) => b.total - a.total)
    .slice(0, 3); // Show top 3 issue types to keep it compact

  for (const item of sortedBreakdown) {
    const statusParts = [];
    const categories = ['Done', 'To Be Verified', 'In Progress', 'To Do', 'Blocked'];
    
    for (const category of categories) {
      const categoryData = item.statusCategories[category];
      if (categoryData && Object.keys(categoryData).length > 0) {
        const count = Object.values(categoryData).reduce((sum, c) => sum + c, 0);
        if (count > 0) {
          // Use abbreviated category names for compactness
          const shortName = category === 'To Be Verified' ? 'TBV' : 
                           category === 'In Progress' ? 'InProg' : 
                           category === 'To Do' ? 'ToDo' : category;
          statusParts.push(`${count} ${shortName}`);
        }
      }
    }
    
    if (statusParts.length > 0) {
      parts.push(`${item.type}: ${statusParts.join(', ')}`);
    }
  }

  // Show ellipsis if there are more issue types
  if (breakdownData.breakdown.length > 3) {
    parts.push('...');
  }

  return parts.length > 0 ? parts.join(' | ') : 'No breakdown available';
}

/**
 * Get summary statistics from breakdown data
 * @param {Object} breakdownData - Raw breakdown data from API
 * @returns {Object} Summary statistics
 */
export function getBreakdownSummary(breakdownData) {
  if (!breakdownData || !breakdownData.overallStats) {
    return {
      total: 0,
      done: 0,
      toBeVerified: 0,
      inProgress: 0,
      remaining: 0,
      completionRate: 0
    };
  }

  const stats = breakdownData.overallStats;
  return {
    total: breakdownData.total || 0,
    done: stats.done || 0,
    toBeVerified: stats.toBeVerified || 0,
    inProgress: stats.inProgress || 0,
    remaining: breakdownData.outstandingCount || (stats.toDo || 0) + (stats.inProgress || 0) + (stats.blocked || 0) + (stats.other || 0),
    completionRate: parseFloat(stats.completionRate || '0')
  };
}

/**
 * Clear all cached breakdown data
 */
export function clearBreakdownCache() {
  breakdownCache.clear();
}

/**
 * Get cache statistics for debugging
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
  clearExpiredCache();
  return {
    size: breakdownCache.size,
    keys: Array.from(breakdownCache.keys())
  };
}