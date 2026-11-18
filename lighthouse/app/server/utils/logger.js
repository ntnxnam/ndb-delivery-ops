const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log file paths
const authLogPath = path.join(logsDir, 'auth.log');
const auditLogPath = path.join(logsDir, 'audit.log');
const emailLogPath = path.join(logsDir, 'email.log');
const errorLogPath = path.join(logsDir, 'error.log');
const jiraFetchLogPath = path.join(logsDir, 'jira-fetch.log');

// Helper to format timestamp
function getTimestamp() {
  return new Date().toISOString();
}

// Helper to format log entry
function formatLogEntry(level, category, message, metadata = {}) {
  const entry = {
    timestamp: getTimestamp(),
    level,
    category,
    message,
    ...metadata
  };
  return JSON.stringify(entry);
}

// Helper to write to log file
function writeToLog(filePath, entry) {
  try {
    fs.appendFileSync(filePath, entry + '\n', 'utf8');
  } catch (error) {
    console.error(`Failed to write to log file ${filePath}:`, error);
  }
}

// Logger object
const logger = {
  // Authentication logging
  auth: {
    success: (username, service, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'AUTH_SUCCESS', `User ${username} successfully authenticated with ${service}`, {
        username,
        service,
        ...metadata
      });
      console.log(`[AUTH] ✅ ${username} authenticated with ${service}`);
      writeToLog(authLogPath, entry);
    },
    
    failure: (username, service, reason, metadata = {}) => {
      const entry = formatLogEntry('WARN', 'AUTH_FAILURE', `User ${username} failed to authenticate with ${service}: ${reason}`, {
        username,
        service,
        reason,
        ...metadata
      });
      console.warn(`[AUTH] ❌ ${username} failed to authenticate with ${service}: ${reason}`);
      writeToLog(authLogPath, entry);
    },
    
    tokenValidation: (username, service, isValid, metadata = {}) => {
      const level = isValid ? 'INFO' : 'WARN';
      const category = isValid ? 'TOKEN_VALID' : 'TOKEN_INVALID';
      const message = isValid 
        ? `Token validation successful for ${username} with ${service}`
        : `Token validation failed for ${username} with ${service}`;
      const entry = formatLogEntry(level, category, message, {
        username,
        service,
        isValid,
        ...metadata
      });
      console.log(`[AUTH] ${isValid ? '✅' : '❌'} Token validation for ${username} (${service}): ${isValid ? 'VALID' : 'INVALID'}`);
      writeToLog(authLogPath, entry);
    },
    
    tokenMismatch: (username, tokenOwner, service, metadata = {}) => {
      const entry = formatLogEntry('ERROR', 'TOKEN_MISMATCH', `Token mismatch: User ${username} provided token belonging to ${tokenOwner} for ${service}`, {
        username,
        tokenOwner,
        service,
        ...metadata
      });
      console.error(`[AUTH] ⚠️ Token mismatch: ${username} provided token belonging to ${tokenOwner} (${service})`);
      writeToLog(authLogPath, entry);
    }
  },

  // Authorization logging
  authorization: {
    granted: (username, resource, action, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'AUTHZ_GRANTED', `User ${username} granted access to ${resource} for ${action}`, {
        username,
        resource,
        action,
        ...metadata
      });
      console.log(`[AUTHZ] ✅ ${username} granted access to ${resource} (${action})`);
      writeToLog(auditLogPath, entry);
    },
    
    denied: (username, resource, action, reason, metadata = {}) => {
      const entry = formatLogEntry('WARN', 'AUTHZ_DENIED', `User ${username} denied access to ${resource} for ${action}: ${reason}`, {
        username,
        resource,
        action,
        reason,
        ...metadata
      });
      console.warn(`[AUTHZ] ❌ ${username} denied access to ${resource} (${action}): ${reason}`);
      writeToLog(auditLogPath, entry);
    }
  },

  // Email logging
  email: {
    sent: (from, to, cc, subject, jiraKey, releaseVersions, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'EMAIL_SENT', `Email sent from ${from}`, {
        from,
        to: Array.isArray(to) ? to : [to],
        cc: Array.isArray(cc) ? cc : (cc ? [cc] : []),
        subject,
        jiraKey: jiraKey || null,
        releaseVersions: releaseVersions || null,
        ...metadata
      });
      console.log(`[EMAIL] 📧 Email sent from ${from} - Subject: "${subject}"${jiraKey ? ` - JIRA: ${jiraKey}` : ''}${releaseVersions ? ` - Versions: ${releaseVersions.join(', ')}` : ''}`);
      writeToLog(emailLogPath, entry);
    },
    
    failed: (from, to, subject, error, jiraKey, releaseVersions, metadata = {}) => {
      const entry = formatLogEntry('ERROR', 'EMAIL_FAILED', `Email failed to send from ${from}`, {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        error: error.message || error,
        errorCode: error.code,
        jiraKey: jiraKey || null,
        releaseVersions: releaseVersions || null,
        ...metadata
      });
      console.error(`[EMAIL] ❌ Email failed from ${from} - Subject: "${subject}"${jiraKey ? ` - JIRA: ${jiraKey}` : ''} - Error: ${error.message || error}`);
      writeToLog(emailLogPath, entry);
      writeToLog(errorLogPath, entry);
    },
    
    attempt: (from, to, subject, jiraKey, releaseVersions, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'EMAIL_ATTEMPT', `Email send attempt from ${from}`, {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        jiraKey: jiraKey || null,
        releaseVersions: releaseVersions || null,
        ...metadata
      });
      console.log(`[EMAIL] 📤 Email send attempt from ${from} - Subject: "${subject}"${jiraKey ? ` - JIRA: ${jiraKey}` : ''}${releaseVersions ? ` - Versions: ${releaseVersions.join(', ')}` : ''}`);
      writeToLog(emailLogPath, entry);
    }
  },

  // General audit logging
  audit: {
    action: (username, action, resource, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'AUDIT', `User ${username} performed action: ${action} on ${resource}`, {
        username,
        action,
        resource,
        ...metadata
      });
      console.log(`[AUDIT] 📝 ${username} - ${action} - ${resource}`);
      writeToLog(auditLogPath, entry);
    },
    
    dataAccess: (username, resource, action, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'DATA_ACCESS', `User ${username} accessed ${resource} for ${action}`, {
        username,
        resource,
        action,
        ...metadata
      });
      console.log(`[AUDIT] 🔍 ${username} accessed ${resource} (${action})`);
      writeToLog(auditLogPath, entry);
    }
  },

  // Error logging
  error: (message, error, metadata = {}) => {
    const entry = formatLogEntry('ERROR', 'ERROR', message, {
      error: error.message || error,
      stack: error.stack,
      ...metadata
    });
    console.error(`[ERROR] ❌ ${message}:`, error.message || error);
    writeToLog(errorLogPath, entry);
  },

  // Info logging
  info: (message, metadata = {}) => {
    const entry = formatLogEntry('INFO', 'INFO', message, metadata);
    console.log(`[INFO] ℹ️ ${message}`);
    writeToLog(auditLogPath, entry);
  },

  // JIRA fetch logging
  jira: {
    fetch: (jiraKey, action, message, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'JIRA_FETCH', message, {
        jiraKey,
        action,
        ...metadata
      });
      console.log(`[JIRA] 🔍 ${jiraKey} - ${action}: ${message}`);
      writeToLog(jiraFetchLogPath, entry);
    },
    
    fieldNames: (jiraKey, count, sampleFields, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'JIRA_FIELD_NAMES', `Available field names: ${count}`, {
        jiraKey,
        fieldCount: count,
        sampleFields,
        ...metadata
      });
      console.log(`[JIRA] 📋 ${jiraKey} - Available field names: ${count}`);
      writeToLog(jiraFetchLogPath, entry);
    },
    
    fieldMetadata: (jiraKey, fieldsAdded, totalFields, customFields, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'JIRA_FIELD_METADATA', `Fetched field metadata: added ${fieldsAdded} new fields`, {
        jiraKey,
        fieldsAdded,
        totalFields,
        customFields,
        ...metadata
      });
      console.log(`[JIRA] 📋 ${jiraKey} - Fetched field metadata: added ${fieldsAdded} new fields (total: ${totalFields})`);
      writeToLog(jiraFetchLogPath, entry);
    },
    
    epics: (jiraKey, epicCount, totalIssues, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'JIRA_EPICS', `Found ${epicCount} epics out of ${totalIssues} total issues`, {
        jiraKey,
        epicCount,
        totalIssues,
        ...metadata
      });
      console.log(`[JIRA] 📋 ${jiraKey} - Found ${epicCount} epics out of ${totalIssues} total issues`);
      writeToLog(jiraFetchLogPath, entry);
    },
    
    issueBreakdown: (jiraKey, total, breakdown, overallStats, metadata = {}) => {
      const entry = formatLogEntry('INFO', 'JIRA_ISSUE_BREAKDOWN', `Issue breakdown: ${total} total issues`, {
        jiraKey,
        total,
        breakdown,
        overallStats,
        ...metadata
      });
      console.log(`[JIRA] 📊 ${jiraKey} - Issue breakdown: ${total} total issues`);
      writeToLog(jiraFetchLogPath, entry);
    },
    
    warning: (jiraKey, message, metadata = {}) => {
      const entry = formatLogEntry('WARN', 'JIRA_WARNING', message, {
        jiraKey,
        ...metadata
      });
      console.warn(`[JIRA] ⚠️ ${jiraKey} - ${message}`);
      writeToLog(jiraFetchLogPath, entry);
    },
    
    error: (jiraKey, message, error, metadata = {}) => {
      const entry = formatLogEntry('ERROR', 'JIRA_ERROR', message, {
        jiraKey,
        error: error?.message || error,
        ...metadata
      });
      console.error(`[JIRA] ❌ ${jiraKey} - ${message}:`, error?.message || error);
      writeToLog(jiraFetchLogPath, entry);
      writeToLog(errorLogPath, entry);
    }
  }
};

module.exports = logger;

