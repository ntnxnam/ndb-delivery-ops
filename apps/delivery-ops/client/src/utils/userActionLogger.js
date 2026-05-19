import axios from 'axios';

/**
 * Logs a user action for audit purposes
 * @param {string} action - User-defined action name (e.g., "VERSION_CHANGED", "FETCH_ITEMS_CLICKED")
 * @param {string} resource - Resource being acted upon (e.g., "NDB-2.11", "FEAT-12345")
 * @param {Object} metadata - Additional metadata about the action
 */
export async function logUserAction(action, resource = '', metadata = {}) {
  try {
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || 'unknown';
    const jiraToken = localStorage.getItem('jiraToken') || '';
    
    if (!jiraToken) {
      console.warn('[UserActionLogger] No JIRA token, skipping action log');
      return;
    }

    // Send to backend to log
    await axios.post('/api/jira/log-user-action', {
      action,
      resource,
      username,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
      }
    }, {
      headers: {
        'Authorization': `Bearer ${jiraToken}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    // Don't throw - logging failures shouldn't break the app
    console.warn('[UserActionLogger] Failed to log action:', err.message);
  }
}

/**
 * Convenience functions for common actions
 */
export const UserActions = {
  // Release Versions actions
  VERSION_CHANGED: 'VERSION_CHANGED',
  FETCH_VERSIONS_CLICKED: 'FETCH_VERSIONS_CLICKED',
  FETCH_ITEMS_CLICKED: 'FETCH_ITEMS_CLICKED',
  EMAIL_SEND_CLICKED: 'EMAIL_SEND_CLICKED',
  EXEC_SUMMARY_CLICKED: 'EXEC_SUMMARY_CLICKED',
  
  // Email Sender actions
  JIRA_KEY_VALIDATED: 'JIRA_KEY_VALIDATED',
  JIRA_DATA_FETCHED: 'JIRA_DATA_FETCHED',
  EPICS_FETCHED: 'EPICS_FETCHED',
  ISSUE_BREAKDOWN_FETCHED: 'ISSUE_BREAKDOWN_FETCHED',
  EMAIL_SENT: 'EMAIL_SENT',
  
  // Auth actions
  LOGIN_ATTEMPTED: 'LOGIN_ATTEMPTED',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  
  // Confluence actions
  CONFLUENCE_EXTRACTED: 'CONFLUENCE_EXTRACTED',
  
  // JIRA Query actions
  JIRA_QUERY_EXECUTED: 'JIRA_QUERY_EXECUTED'
};

