import axios from 'axios';
import { applyAxiosInterceptors, requestKey, withRequestGate } from './requestGate';

applyAxiosInterceptors(axios);

/**
 * API base URL for all requests. Use relative (empty string) so requests go to same origin.
 * Only set REACT_APP_API_URL when the backend is on a different origin (e.g. dev with backend on another port).
 * Relative paths like '/api/jira/sprints' always resolve to current origin (e.g. ndb-qa.dev.nutanix.com:6100).
 */
export const getApiBase = () => process.env.REACT_APP_API_URL || '';

/**
 * Helper to normalize username (accept both 'namratha.singh' and 'namratha.singh@nutanix.com')
 */
const normalizeToUsername = (input) => {
  if (!input) return null;
  const trimmed = String(input).trim().toLowerCase();
  if (trimmed.includes('@')) {
    return trimmed.split('@')[0];
  }
  return trimmed;
};

/**
 * Creates an axios request config with authentication headers
 * NOTE: System accepts username format (e.g., 'namratha.singh') not email format
 * @param {string} jiraToken - JIRA token (optional)
 * @param {string} username - Username (optional, for authorization - accepts both 'namratha.singh' and 'namratha.singh@nutanix.com')
 * @returns {object} Axios request config object
 */
export const getAuthHeaders = (jiraToken = null, username = null) => {
  const headers = {};
  
  // Get token from localStorage if not provided
  const jira = jiraToken || localStorage.getItem('jiraToken');
  
  // Debug: Log token retrieval
  if (!jira) {
    console.warn('getAuthHeaders: No JIRA token found in localStorage or options');
  }
  
  // Get username from localStorage if not provided (prefer 'username' key, fallback to 'userEmail')
  const storedUsername = username || localStorage.getItem('username') || localStorage.getItem('userEmail');
  const normalizedUsername = normalizeToUsername(storedUsername);
  
  // Add JIRA token to Authorization header
  if (jira) {
    headers['Authorization'] = `Bearer ${jira}`;
  }
  
  // Add username for authorization checks (system accepts username format)
  if (normalizedUsername) {
    headers['X-Username'] = normalizedUsername;
    headers['X-User-Email'] = `${normalizedUsername}@nutanix.com`; // Also send email for backward compatibility
  }
  
  return { headers };
};

/**
 * Makes an authenticated POST request. Identical in-flight calls are coalesced;
 * failed calls are gated by requestGate so a render loop cannot flood the network.
 * NOTE: System accepts username format (e.g., 'namratha.singh') not email format
 * @param {string} url - API endpoint URL
 * @param {object} data - Request body data
 * @param {object} options - Additional options (jiraToken, username)
 * @param {object} axiosConfig - Additional axios configuration (e.g., signal for AbortController)
 * @returns {Promise} Axios response
 */
export const authenticatedPost = async (url, data = {}, options = {}, axiosConfig = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);

  // Merge username into data if provided (for backward compatibility, also include userEmail)
  const requestData = { ...data };
  const normalizedUsername = normalizeToUsername(username || localStorage.getItem('username') || localStorage.getItem('userEmail'));
  if (normalizedUsername) {
    if (!requestData.username) {
      requestData.username = normalizedUsername;
    }
    if (!requestData.userEmail) {
      requestData.userEmail = `${normalizedUsername}@nutanix.com`; // For backward compatibility
    }
  }
  
  // Longer timeouts for release-items and sprint report: server may paginate (multiple JIRA calls + delays)
  let timeout = 60000;
  if (url.includes('/release-items-history')) timeout = 300000; // 5 min
  else if (url.includes('/sos-items-history')) timeout = 180000; // 3 min (JIRA changelog fetch for multiple items)
  else if (url.includes('/release-items-commit') || url.includes('/release-items-long-term')) timeout = 180000; // 3 min each
  else if (url.includes('/sprint-report') || url.includes('/sprint-report-trends')) timeout = 300000; // 5 min (matches server)
  else if (url.includes('/api/jira/sprints')) timeout = 90000; // 90s for sprints list (paginated Jira Agile API; cold cache + many sprints)
  
  const config = {
    ...authHeaders,
    timeout,
    ...axiosConfig,
    requestGate: { managed: true, ignoreFailureCooldown },
  };

  return withRequestGate(
    requestKey('POST', url, data),
    () => axios.post(url, requestData, config),
    { ignoreFailureCooldown }
  );
};

/**
 * Makes an authenticated PUT request
 * NOTE: System accepts username format (e.g., 'namratha.singh') not email format
 * @param {string} url - API endpoint URL
 * @param {object} data - Request body data
 * @param {object} options - Additional options (jiraToken, username)
 * @returns {Promise} Axios response
 */
export const authenticatedPut = async (url, data = {}, options = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);
  
  // Merge username into data if provided (for backward compatibility, also include userEmail)
  const requestData = { ...data };
  const normalizedUsername = normalizeToUsername(username || localStorage.getItem('username') || localStorage.getItem('userEmail'));
  if (normalizedUsername) {
    if (!requestData.username) {
      requestData.username = normalizedUsername;
    }
    if (!requestData.userEmail) {
      requestData.userEmail = `${normalizedUsername}@nutanix.com`; // For backward compatibility
    }
  }
  
  return withRequestGate(
    requestKey('PUT', url, data),
    () => axios.put(url, requestData, {
      ...authHeaders,
      timeout: 60000,
      requestGate: { managed: true, ignoreFailureCooldown },
    }),
    { ignoreFailureCooldown }
  );
};

/**
 * Makes an authenticated GET request
 * NOTE: System accepts username format (e.g., 'namratha.singh') not email format
 * @param {string} url - API endpoint URL
 * @param {object} params - Query parameters
 * @param {object} options - Additional options (jiraToken, username)
 * @param {object} axiosConfig - Additional axios configuration (e.g., signal for AbortController)
 * @returns {Promise} Axios response
 */
export const authenticatedGet = async (url, params = {}, options = {}, axiosConfig = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);

  return withRequestGate(
    requestKey('GET', url, null, params),
    () => axios.get(url, {
      ...authHeaders,
      params,
      timeout: 30000,
      ...axiosConfig,
      requestGate: { managed: true, ignoreFailureCooldown },
    }),
    { ignoreFailureCooldown }
  );
};

/**
 * Makes an authenticated DELETE request
 * NOTE: System accepts username format (e.g., 'namratha.singh') not email format
 * @param {string} url - API endpoint URL
 * @param {object} data - Request body data (for DELETE with body)
 * @param {object} options - Additional options (jiraToken, username)
 * @returns {Promise} Axios response
 */
export const authenticatedDelete = async (url, data = {}, options = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);

  return withRequestGate(
    requestKey('DELETE', url, data),
    () => axios.delete(url, {
      data,
      ...authHeaders,
      timeout: 60000,
      requestGate: { managed: true, ignoreFailureCooldown },
    }),
    { ignoreFailureCooldown }
  );
};
