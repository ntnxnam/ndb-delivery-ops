/**
 * User Service
 * 
 * Handles user-related operations:
 * - Username/email normalization
 * - User field extraction from JIRA data
 * - User authorization checks
 */

const allowedUsersConfig = require('../config/allowedUsers.json');

/**
 * Normalize username/email to username format
 * Accepts both 'namratha.singh' and 'namratha.singh@nutanix.com' and returns 'namratha.singh'
 * 
 * @param {string} input - Username or email address
 * @returns {string|null} - Normalized username or null if input is invalid
 */
function normalizeToUsername(input) {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  // If it's an email, extract the username part
  if (trimmed.includes('@')) {
    const username = trimmed.split('@')[0];
    return username;
  }
  return trimmed;
}

/**
 * Convert username to email format
 * Converts 'namratha.singh' to 'namratha.singh@nutanix.com'
 * 
 * @param {string} username - Username (e.g., 'namratha.singh')
 * @returns {string|null} - Email address or null if username is invalid
 */
function usernameToEmail(username) {
  if (!username) return null;
  const normalized = normalizeToUsername(username);
  return `${normalized}@nutanix.com`;
}

/**
 * Extract user display name from JIRA user field
 * Works for assignee, QA Contact, TPM Owner, etc.
 * 
 * @param {object|string|null} userField - JIRA user field (object or string)
 * @param {string} issueKey - JIRA issue key for logging (optional)
 * @param {string} fieldName - Field name for logging (optional)
 * @returns {string} - Display name or 'N/A' if not available
 */
function extractUserName(userField, issueKey = 'UNKNOWN', fieldName = 'user') {
  if (!userField) {
    return 'N/A';
  }
  
  // If it's already a string, return it
  if (typeof userField === 'string') {
    return userField;
  }
  
  // If it's an object, extract display name
  if (typeof userField === 'object') {
    const userName = userField.displayName || 
                     userField.name || 
                     userField.emailAddress || 
                     userField.email || 
                     userField.key || 
                     userField.value ||
                     null;
    
    if (userName) {
      return userName;
    }
  }
  
  return 'N/A';
}

/**
 * Extract assignee name (specific for assignee field which might be null)
 * Includes debug logging for troubleshooting
 * 
 * @param {object|string|null} assigneeField - JIRA assignee field
 * @param {string} issueKey - JIRA issue key for logging
 * @returns {string} - Assignee name or 'N/A' if not available
 */
function extractAssigneeName(assigneeField, issueKey = 'UNKNOWN') {
  if (!assigneeField) {
    return 'N/A';
  }
  return extractUserName(assigneeField, issueKey, 'assignee');
}

/**
 * Check if user is authorized for Release Versions page/endpoints.
 *
 * Controlled by RELEASE_VERSIONS_PAGE_ACCESS env var:
 *   'all'       – any authenticated user is allowed (default)
 *   'allowlist' – only users in allowedUsers.json → allowedUsers
 *   'none'      – no one is allowed
 *
 * @param {string} username - Username to check (can be username or email)
 * @returns {object} - { authorized: boolean, normalizedUsername: string, userEmail: string }
 */
function checkReleaseVersionsAuthorization(username) {
  if (!username) {
    return {
      authorized: false,
      error: 'Username is required for authorization check. Please provide your Nutanix username (e.g., namratha.singh).'
    };
  }

  const normalizedUsername = normalizeToUsername(username);
  const pageAccess = (process.env.RELEASE_VERSIONS_PAGE_ACCESS || 'all').toLowerCase().trim();

  if (pageAccess === 'none') {
    return {
      authorized: false,
      error: 'Access to Release Versions is currently disabled.',
      normalizedUsername
    };
  }

  if (pageAccess === 'all') {
    return {
      authorized: true,
      normalizedUsername,
      userEmail: usernameToEmail(normalizedUsername)
    };
  }

  // 'allowlist' or any unrecognised value → enforce allowlist
  const AUTHORIZED_USERS = allowedUsersConfig.allowedUsers || ['namratha.singh'];
  const isAuthorized = AUTHORIZED_USERS.some(authorized =>
    normalizedUsername === normalizeToUsername(authorized)
  );

  if (!isAuthorized) {
    return {
      authorized: false,
      error: 'Access denied. You are not authorized to access this endpoint.',
      normalizedUsername
    };
  }

  return {
    authorized: true,
    normalizedUsername,
    userEmail: usernameToEmail(normalizedUsername)
  };
}

/**
 * Check if user is authorized to VIEW KPIs (read-only access).
 * Any authenticated user (with a username) can view KPIs.
 *
 * @param {string} username - Username to check (can be username or email)
 * @returns {object} - { authorized: boolean, normalizedUsername: string }
 */
function checkKpiViewAuthorization(username) {
  if (!username) {
    return { authorized: false, normalizedUsername: null };
  }

  const normalizedUsername = normalizeToUsername(username);
  return {
    authorized: true,
    normalizedUsername
  };
}

/**
 * Check if user is authorized for KPI tab admin (add/edit/delete/reorder).
 * Uses kpiTabAllowedUsers from allowedUsers.json.
 *
 * @param {string} username - Username to check (can be username or email)
 * @returns {object} - { authorized: boolean, normalizedUsername: string }
 */
function checkKpiTabAuthorization(username) {
  const allowed = allowedUsersConfig.kpiTabAllowedUsers || [];

  if (!username) {
    return { authorized: false, normalizedUsername: null };
  }

  const normalizedUsername = normalizeToUsername(username);
  const isAuthorized = allowed.some((u) => normalizeToUsername(u) === normalizedUsername);

  return {
    authorized: isAuthorized,
    normalizedUsername
  };
}

/**
 * Check if user is authorized for Sprint Report tab.
 * Uses sprintReportAllowedUsers from allowedUsers.json.
 *
 * @param {string} username - Username to check (can be username or email)
 * @returns {object} - { authorized: boolean, normalizedUsername: string }
 */
function checkSprintReportAuthorization(username) {
  const allowed = allowedUsersConfig.sprintReportAllowedUsers || [];

  if (!username) {
    return { authorized: false, normalizedUsername: null };
  }

  const normalizedUsername = normalizeToUsername(username);
  const isAuthorized = allowed.length === 0 || allowed.some((u) => normalizeToUsername(u) === normalizedUsername);

  return {
    authorized: isAuthorized,
    normalizedUsername
  };
}

/**
 * Check if user is authorized to modify KPIs for a given team (add/edit/delete/reorder).
 * Uses kpiAdminUsers from allowedUsers.json, keyed by teamId.
 * Users not in the admin list can still view KPIs and load widgets.
 *
 * @param {string} username - Username to check (can be username or email)
 * @param {string} teamId - Team identifier (e.g. 'ndb')
 * @returns {object} - { authorized: boolean, normalizedUsername: string }
 */
function checkKpiAdminAuthorization(username, teamId) {
  const adminMap = allowedUsersConfig.kpiAdminUsers || {};

  if (!username || !teamId) {
    return { authorized: false, normalizedUsername: null };
  }

  const normalizedUsername = normalizeToUsername(username);
  const teamAdmins = adminMap[teamId];

  if (!Array.isArray(teamAdmins)) {
    return { authorized: true, normalizedUsername };
  }

  const isAuthorized = teamAdmins.some((u) => normalizeToUsername(u) === normalizedUsername);

  return { authorized: isAuthorized, normalizedUsername };
}

/**
 * Extract email address from JIRA user object (for CC from project team fields)
 * @param {object|string|null} userField - JIRA user field
 * @returns {string|null}
 */
function extractEmailFromJiraUser(userField) {
  if (!userField) return null;
  if (typeof userField === 'string') {
    if (userField.includes('@')) return userField.toLowerCase();
    return usernameToEmail(userField);
  }
  if (typeof userField === 'object') {
    if (userField.emailAddress) return userField.emailAddress.toLowerCase();
    if (userField.email) return userField.email.toLowerCase();
    if (userField.key) return usernameToEmail(userField.key);
    if (userField.name) {
      if (userField.name.includes('@')) return userField.name.toLowerCase();
      return usernameToEmail(userField.name);
    }
  }
  return null;
}

/**
 * Extract email addresses from JIRA user array (e.g. watchers)
 * @param {Array|object|null} userArray
 * @returns {Array<string>}
 */
function extractEmailsFromJiraUserArray(userArray) {
  if (!userArray) return [];
  const emails = [];
  if (userArray.watchers && Array.isArray(userArray.watchers)) {
    userArray.watchers.forEach(watcher => {
      const email = extractEmailFromJiraUser(watcher);
      if (email) emails.push(email);
    });
  } else if (Array.isArray(userArray)) {
    userArray.forEach(user => {
      const email = extractEmailFromJiraUser(user);
      if (email) emails.push(email);
    });
  } else {
    const email = extractEmailFromJiraUser(userArray);
    if (email) emails.push(email);
  }
  return emails;
}

module.exports = {
  normalizeToUsername,
  usernameToEmail,
  extractUserName,
  extractAssigneeName,
  checkReleaseVersionsAuthorization,
  checkKpiViewAuthorization,
  checkKpiTabAuthorization,
  checkSprintReportAuthorization,
  checkKpiAdminAuthorization,
  extractEmailFromJiraUser,
  extractEmailsFromJiraUserArray
};

