/**
 * JIRA Service
 * 
 * Handles JIRA-related business logic:
 * - JIRA API calls with retry logic
 * - Risk indicator formatting and sorting
 * - Issue data transformation
 * - JQL query building
 */

const axios = require('axios');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { JIRA_API_V2 } = require('../config/api');
const logger = require('../utils/logger');

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Canonical JIRA auth + content-type headers. Use this from every service
 * that talks to JIRA so the auth scheme stays in one place if it ever
 * needs to change (e.g. PAT -> OAuth bearer migration).
 */
function jiraHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Create HTTPS agent for JIRA API calls.
 * Uses HTTPS_PROXY or HTTP_PROXY when set (e.g. corporate VPN/proxy).
 * @returns {https.Agent|HttpsProxyAgent} - Configured agent
 */
function createHttpsAgent() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  if (proxyUrl) {
    return new HttpsProxyAgent(proxyUrl);
  }
  return new https.Agent({
    rejectUnauthorized: NODE_ENV === 'production',
    keepAlive: true,
    maxSockets: 50
  });
}

/**
 * Retry JIRA API calls with exponential backoff
 * Handles rate limiting (429 errors) with automatic retries
 * 
 * @param {Function} apiCall - Function that returns a Promise for the API call
 * @param {number} maxRetries - Maximum number of retry attempts (default: 5)
 * @returns {Promise} - Result of the API call
 */
async function retryJiraCall(apiCall, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (error.response?.status === 429 && attempt < maxRetries - 1) {
        // Exponential backoff: 5s, 10s, 20s, 40s, 60s
        const delay = Math.min(Math.pow(2, attempt) * 5000, 60000);
        console.warn(`Rate limited, retrying in ${delay/1000}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      // If it's a 429 error on the last attempt, throw a more helpful error
      if (error.response?.status === 429) {
        throw new Error('JIRA rate limit exceeded. Please wait 60-90 seconds and try again.');
      }
      throw error;
    }
  }
}

/**
 * Format Risk Indicator value and determine color
 * 
 * @param {any} value - Risk indicator value (object, string, or null)
 * @returns {object} - { value: string, color: string }
 */
function formatRiskIndicator(value) {
  if (!value || value === null || value === undefined) {
    return { value: 'Not Set', color: 'transparent' };
  }
  
  // Extract the actual value string
  let valueStr;
  if (typeof value === 'object') {
    valueStr = value.value || value.name || JSON.stringify(value);
  } else {
    valueStr = String(value);
  }
  
  if (!valueStr || valueStr.trim() === '') {
    return { value: 'Not Set', color: 'transparent' };
  }
  
  // Determine color based on value
  const valueLower = valueStr.toLowerCase();
  const firstPart = valueStr.split('-')[0].trim().toLowerCase();
  
  let color = 'transparent';
  // Check for red/high risk indicators
  if (firstPart.includes('red') || valueLower.includes('red') || valueLower.includes('high') || valueLower.includes('critical')) {
    color = '#dc3545'; // Red
  }
  // Check for yellow/medium risk indicators
  else if (firstPart.includes('yellow') || valueLower.includes('yellow') || valueLower.includes('medium') || valueLower.includes('moderate') || valueLower.includes('at risk')) {
    color = '#ffc107'; // Yellow
  }
  // Check for green/low risk indicators
  else if (firstPart.includes('green') || valueLower.includes('green') || valueLower.includes('low') || valueLower.includes('minimal') || valueLower.includes('on track')) {
    color = '#28a745'; // Green
  }
  
  return { value: valueStr, color: color };
}

/**
 * Get Risk Indicator sort priority
 * Red (highest risk) = 0, Yellow = 1, Green = 2, Not Set = 3
 * 
 * @param {any} riskIndicator - Risk indicator value or object
 * @returns {number} - Priority (0-3)
 */
function getRiskIndicatorPriority(riskIndicator) {
  if (!riskIndicator) return 3; // Not Set
  
  // Handle both object format {value, color} and direct value
  const color = riskIndicator.color ? riskIndicator.color.toLowerCase() : null;
  const value = riskIndicator.value || riskIndicator;
  
  // If no color, check if value indicates a color
  if (!color || color === 'transparent') {
    if (typeof value === 'string') {
      const valueLower = value.toLowerCase();
      if (valueLower.includes('red') || valueLower.includes('high') || valueLower.includes('critical')) {
        return 0; // Red
      }
      if (valueLower.includes('yellow') || valueLower.includes('medium') || valueLower.includes('moderate') || valueLower.includes('at risk')) {
        return 1; // Yellow
      }
      if (valueLower.includes('green') || valueLower.includes('low') || valueLower.includes('minimal') || valueLower.includes('on track')) {
        return 2; // Green
      }
    }
    return 3; // Not Set
  }
  
  // Check by color hex code
  if (color === '#dc3545' || color === 'red' || color === '#de350b') return 0; // Red - highest priority
  if (color === '#ffc107' || color === 'yellow' || color === '#ff8b00') return 1; // Yellow
  if (color === '#28a745' || color === 'green' || color === '#00875a') return 2; // Green
  return 3; // Not Set or transparent
}

/**
 * Sort items by Risk Indicator priority
 * 
 * @param {Array} items - Array of items with customfield_23560 (risk indicator)
 * @returns {Array} - Sorted array
 */
function sortByRiskIndicator(items) {
  return items.sort((a, b) => {
    const priorityA = getRiskIndicatorPriority(a.customfield_23560);
    const priorityB = getRiskIndicatorPriority(b.customfield_23560);
    
    // If priorities are equal, sort by key alphabetically
    if (priorityA === priorityB) {
      return a.key.localeCompare(b.key);
    }
    
    return priorityA - priorityB;
  });
}

/**
 * Make a JIRA API GET request
 * 
 * @param {string} url - JIRA API URL
 * @param {string} token - JIRA Bearer token
 * @param {object} options - Additional options (params, timeout, etc.)
 * @returns {Promise} - Axios response
 */
async function jiraGet(url, token, options = {}) {
  const httpsAgent = createHttpsAgent();
  const config = {
    headers: jiraHeaders(token),
    httpsAgent,
    timeout: options.timeout || 30000,
    ...options,
  };
  return retryJiraCall(() => axios.get(url, config));
}

/**
 * Make a JIRA API POST request
 * 
 * @param {string} url - JIRA API URL
 * @param {string} token - JIRA Bearer token
 * @param {object} data - Request body data
 * @param {object} options - Additional options (params, timeout, etc.)
 * @returns {Promise} - Axios response
 */
async function jiraPost(url, token, data, options = {}) {
  const httpsAgent = createHttpsAgent();
  const config = {
    headers: jiraHeaders(token),
    httpsAgent,
    timeout: options.timeout || 30000,
    ...options,
    data,
  };
  return retryJiraCall(() => axios.post(url, data, config));
}

/**
 * Build a paginated JIRA-search fetcher that walks /rest/api/2/search
 * page-by-page and returns the full issue array.
 *
 * Returns a function with the signature `(jql, fields) => Promise<issues[]>`,
 * matching the shape that getAllItemKeysForVersion and other callers expect.
 * This replaces the half-dozen `fetchIssuesWithJQL` closures that used to be
 * scattered across release-history / risk-indicator handlers, each with
 * their own subtly different tuning.
 *
 * Tunables (all optional, defaults match the legacy handlers):
 *   - defaultFields : the `fields` param when the caller doesn't pass one
 *   - pageSize      : page size (JIRA's per-page max is 1000)
 *   - perPageDelayMs: wait this long between pages (be polite to JIRA)
 *   - timeoutMs     : per-call axios timeout
 */
function makeJiraSearchFetcher(jiraToken, {
  defaultFields = 'key,labels,fixVersions',
  pageSize = 1000,
  perPageDelayMs = 200,
  timeoutMs = 6000,
} = {}) {
  const httpsAgent = createHttpsAgent();
  return async function fetchIssuesWithJQL(jql, fields = defaultFields) {
    let allIssues = [];
    let startAt = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
        headers: jiraHeaders(jiraToken),
        httpsAgent,
        timeout: timeoutMs,
        params: { jql, fields, maxResults: pageSize, startAt },
      }));

      if (response.data && response.data.issues) {
        allIssues = [...allIssues, ...response.data.issues];
        const total = response.data.total || allIssues.length;
        startAt += response.data.issues.length;
        hasMore = allIssues.length < total && response.data.issues.length === pageSize;
        if (hasMore && perPageDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, perPageDelayMs));
        }
      } else {
        hasMore = false;
      }
    }
    return allIssues;
  };
}

/**
 * Convert a raw axios/JIRA error into the { statusCode, message, details }
 * shape that route handlers + sendServiceError expect.
 *
 * Unwraps the common JIRA error payload shapes (errorMessages[0],
 * errors{} dictionary) so the user sees the actual upstream complaint
 * instead of a generic "Request failed with status 400".
 *
 *   throw wrapJiraError(error, 'Failed to create version');
 *
 * If the error already has `statusCode` set (e.g. a validation error the
 * service threw itself) it's returned unchanged.
 */
function wrapJiraError(error, fallbackMessage = 'JIRA request failed') {
  if (error && error.statusCode) return error;
  const status = error?.response?.status || 500;
  const data = error?.response?.data;
  const jiraMsg = data?.errorMessages?.[0]
    || (data?.errors && typeof data.errors === 'object' && Object.values(data.errors).join(', '))
    || error?.message
    || fallbackMessage;
  const wrapped = new Error(jiraMsg);
  wrapped.statusCode = status;
  if (data) wrapped.details = data;
  return wrapped;
}

module.exports = {
  createHttpsAgent,
  retryJiraCall,
  jiraHeaders,
  formatRiskIndicator,
  getRiskIndicatorPriority,
  sortByRiskIndicator,
  jiraGet,
  jiraPost,
  makeJiraSearchFetcher,
  wrapJiraError,
};

