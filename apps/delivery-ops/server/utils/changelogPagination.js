/**
 * Changelog Pagination Utility
 * 
 * Handles fetching all changelog histories for JIRA issues when pagination is required.
 * Implements multiple strategies to handle JIRA API limitations.
 * 
 * @module changelogPagination
 */

const axios = require('axios');

/**
 * Fetches all changelog histories for a JIRA issue using multiple pagination strategies
 * 
 * @param {string} baseUrl - JIRA base URL
 * @param {string} jiraKey - JIRA issue key (e.g., 'FEAT-18452')
 * @param {string|null} issueId - JIRA issue ID (optional, for Strategy 2)
 * @param {string} token - JIRA authentication token
 * @param {https.Agent} httpsAgent - HTTPS agent for API calls
 * @param {Function} retryJiraCall - Retry wrapper function for JIRA API calls
 * @param {Object} logger - Logger object with jira.warning and jira.info methods
 * @param {Object|null} preFetchedIssue - Optional pre-fetched issue object (to avoid duplicate API calls)
 * @returns {Promise<{histories: Array, paginationInfo: Object, warnings: Array}>}
 *   - histories: Array of all changelog history entries
 *   - paginationInfo: Object with total, fetched, strategies used
 *   - warnings: Array of warning messages
 */
async function fetchAllChangelogHistories(baseUrl, jiraKey, issueId, token, httpsAgent, retryJiraCall, logger, preFetchedIssue = null) {
  const warnings = [];
  const paginationInfo = {
    total: 0,
    fetched: 0,
    strategiesUsed: [],
    needsPagination: false
  };

  const issueUrl = `${baseUrl}/rest/api/2/issue/${jiraKey}`;
  
  try {
    let issue;
    
    // Use pre-fetched issue if provided, otherwise fetch it
    if (preFetchedIssue && preFetchedIssue.changelog) {
      issue = preFetchedIssue;
      console.log(`[History] ${jiraKey} - Using pre-fetched issue data`);
    } else {
      // Initial fetch with expand=changelog
      // Note: maxResults is NOT a valid parameter for /rest/api/2/issue/{key} endpoint
      // JIRA will return the default number of histories (usually 50-100)
      // We'll use pagination strategies to fetch all pages if needed
      const initialResponse = await retryJiraCall(() => axios.get(issueUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 30000,
        params: {
          expand: 'changelog'
        }
      }));
      issue = initialResponse.data;
    }
    let histories = issue.changelog?.histories || [];
    const changelog = issue.changelog || {};
    
    paginationInfo.total = changelog.total || histories.length;
    paginationInfo.fetched = histories.length;
    paginationInfo.needsPagination = !!(changelog.total && changelog.total > histories.length);

    // If no pagination needed, return early
    if (!paginationInfo.needsPagination) {
      console.log(`[History] ${jiraKey} - Changelog: ${histories.length} histories (no pagination needed)`);
      logger.jira.warning(jiraKey, `Changelog: ${histories.length} histories (no pagination needed)`);
      return {
        histories,
        paginationInfo: {
          ...paginationInfo,
          strategiesUsed: ['none']
        },
        warnings
      };
    }

    logger.jira.warning(jiraKey, `Changelog paginated: ${histories.length}/${paginationInfo.total} - Fetching additional pages...`);

    // Strategy 1: Try maxResults=total in a single call
    try {
      const maxResultsResponse = await retryJiraCall(() => axios.get(issueUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 30000,
        params: {
          expand: 'changelog',
          maxResults: paginationInfo.total
        }
      }));

      const maxResultsHistories = maxResultsResponse.data.changelog?.histories || [];
      if (maxResultsHistories.length >= paginationInfo.total) {
        console.log(`[History] ${jiraKey} - Strategy 1 (maxResults=total) succeeded: fetched ${maxResultsHistories.length} histories`);
        logger.jira.warning(jiraKey, `Strategy 1 (maxResults=total) succeeded: fetched ${maxResultsHistories.length} histories`);
        paginationInfo.strategiesUsed.push('maxResults=total');
        paginationInfo.fetched = maxResultsHistories.length;
        return {
          histories: maxResultsHistories,
          paginationInfo,
          warnings
        };
      } else if (maxResultsHistories.length > histories.length) {
        // Got more but not all - use this as base and continue
        histories = maxResultsHistories;
        paginationInfo.fetched = histories.length;
        logger.jira.warning(jiraKey, `Strategy 1 (maxResults=total) partial: ${histories.length}/${paginationInfo.total}`);
        paginationInfo.strategiesUsed.push('maxResults=total (partial)');
      }
    } catch (err) {
      logger.jira.warning(jiraKey, `Strategy 1 (maxResults=total) failed: ${err.message}`);
      warnings.push(`Strategy 1 failed: ${err.message}`);
    }

    // Strategy 2: Use issue ID with changelog endpoint (if available)
    if (issueId && histories.length < paginationInfo.total) {
      try {
        const changelogUrl = `${baseUrl}/rest/api/2/issue/${issueId}/changelog`;
        let startAt = histories.length;
        const maxResults = 100;
        
        while (histories.length < paginationInfo.total) {
          const changelogResponse = await retryJiraCall(() => axios.get(changelogUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            httpsAgent: httpsAgent,
            timeout: 30000,
            params: {
              startAt: startAt,
              maxResults: maxResults
            }
          }));

          const moreHistories = changelogResponse.data.values || changelogResponse.data.histories || [];
          if (moreHistories.length === 0) break;

          histories = [...histories, ...moreHistories];
          startAt += moreHistories.length;
          
          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, 500));
          
          console.log(`[History] ${jiraKey} - Strategy 2 (issue ID): Fetched page, total: ${histories.length}/${paginationInfo.total}`);
        }

        if (histories.length >= paginationInfo.total) {
          console.log(`[History] ${jiraKey} - Strategy 2 (issue ID) succeeded: fetched ${histories.length} histories`);
          logger.jira.warning(jiraKey, `Strategy 2 (issue ID) succeeded: fetched ${histories.length} histories`);
          paginationInfo.strategiesUsed.push('issue-id-endpoint');
          paginationInfo.fetched = histories.length;
          return {
            histories,
            paginationInfo,
            warnings
          };
        } else {
          logger.jira.warning(jiraKey, `Strategy 2 (issue ID) partial: ${histories.length}/${paginationInfo.total}`);
          paginationInfo.strategiesUsed.push('issue-id-endpoint (partial)');
        }
      } catch (err) {
        logger.jira.warning(jiraKey, `Strategy 2 (issue ID) failed: ${err.message}`);
        warnings.push(`Strategy 2 failed: ${err.message}`);
      }
    } else if (!issueId && histories.length < paginationInfo.total) {
      logger.jira.warning(jiraKey, 'Strategy 2 skipped: issue ID not available');
      warnings.push('Strategy 2 skipped: issue ID not available');
    }

    // Strategy 3: Multiple calls with expand=changelog and increasing maxResults
    // Note: This is a fallback if Strategies 1 and 2 don't work
    // JIRA API may not support this, but we try anyway
    if (histories.length < paginationInfo.total) {
      try {
        let maxResults = 1000; // Start with large value
        let attempts = 0;
        const maxAttempts = 5;

        while (histories.length < paginationInfo.total && attempts < maxAttempts) {
          const expandResponse = await retryJiraCall(() => axios.get(issueUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            httpsAgent: httpsAgent,
            timeout: 30000,
            params: {
              expand: 'changelog',
              maxResults: maxResults
            }
          }));

          const expandHistories = expandResponse.data.changelog?.histories || [];
          if (expandHistories.length > histories.length) {
            histories = expandHistories;
            paginationInfo.fetched = histories.length;
            console.log(`[History] ${jiraKey} - Strategy 3 (expand with maxResults): Fetched ${histories.length} histories`);
          } else {
            break; // No improvement
          }

          if (histories.length >= paginationInfo.total) {
            break; // Got all we need
          }

          maxResults = Math.min(maxResults * 2, paginationInfo.total); // Double maxResults
          attempts++;
          
          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (histories.length >= paginationInfo.total) {
          console.log(`[History] ${jiraKey} - Strategy 3 (expand with maxResults) succeeded: fetched ${histories.length} histories`);
          logger.jira.warning(jiraKey, `Strategy 3 (expand with maxResults) succeeded: fetched ${histories.length} histories`);
          paginationInfo.strategiesUsed.push('expand-maxResults');
        } else {
          logger.jira.warning(jiraKey, `Strategy 3 (expand with maxResults) partial: ${histories.length}/${paginationInfo.total}`);
          paginationInfo.strategiesUsed.push('expand-maxResults (partial)');
        }
      } catch (err) {
        logger.jira.warning(jiraKey, `Strategy 3 (expand with maxResults) failed: ${err.message}`);
        warnings.push(`Strategy 3 failed: ${err.message}`);
      }
    }

    // Final status
    paginationInfo.fetched = histories.length;
    if (histories.length < paginationInfo.total) {
      const missing = paginationInfo.total - histories.length;
      warnings.push(`Warning: Only fetched ${histories.length}/${paginationInfo.total} histories. ${missing} histories may be missing.`);
      logger.jira.warning(jiraKey, `Changelog pagination incomplete: ${histories.length}/${paginationInfo.total} histories fetched`);
    } else {
      console.log(`[History] ${jiraKey} - Changelog pagination complete: ${histories.length}/${paginationInfo.total} histories fetched`);
      logger.jira.warning(jiraKey, `Changelog pagination complete: ${histories.length}/${paginationInfo.total} histories fetched`);
    }

    return {
      histories,
      paginationInfo,
      warnings
    };

  } catch (error) {
    logger.jira.warning(jiraKey, `Error fetching changelog: ${error.message}`);
    warnings.push(`Error fetching changelog: ${error.message}`);
    
    // Return whatever we have (might be empty)
    return {
      histories: [],
      paginationInfo: {
        ...paginationInfo,
        strategiesUsed: ['error'],
        error: error.message
      },
      warnings
    };
  }
}

module.exports = {
  fetchAllChangelogHistories
};

