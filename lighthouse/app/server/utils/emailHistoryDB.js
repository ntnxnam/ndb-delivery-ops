const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'emailHistory.json');

// Simple JSON-based database (TinyDB-like functionality)
class SimpleDB {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[EmailHistoryDB] Error loading database:', error);
    }
    return [];
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('[EmailHistoryDB] Error saving database:', error);
      throw error;
    }
  }

  async insert(record) {
    this.data.push(record);
    this.save();
    return record;
  }

  async all() {
    return [...this.data];
  }

  async clear() {
    this.data = [];
    this.save();
  }
}

const db = new SimpleDB(dbPath);

/**
 * Save email send event to database
 * SECURITY: Only stores non-sensitive data - no tokens, passwords, or auth credentials
 * @param {Object} emailData - Email send data
 * @param {string} emailData.username - Username who sent the email
 * @param {string} emailData.userEmail - Email address of sender
 * @param {Array<string>} emailData.to - Recipients (TO)
 * @param {Array<string>} emailData.cc - Recipients (CC)
 * @param {string} emailData.subject - Email subject
 * @param {string|null} emailData.jiraKey - JIRA key if applicable
 * @param {Array<string>|null} emailData.releaseVersions - Release versions if applicable
 * @param {string} emailData.messageId - SMTP message ID
 * @param {Object} emailData.metadata - Additional metadata (will be filtered for security)
 * @returns {Promise<Object>} Saved email record
 */
async function saveEmailHistory(emailData) {
  // Extract only non-sensitive data - explicitly exclude tokens
  const { username, userEmail, to, cc, subject, jiraKey, releaseVersions, messageId, type: explicitType } = emailData;
  
  // Only include safe metadata - filter out any sensitive fields
  const safeMetadata = {};
  if (emailData.metadata) {
    // Whitelist only safe metadata fields
    const allowedMetadataFields = ['contentSize', 'ip', 'userAgent', 'isTest', 'hasJiraData', 'hasEpics', 'attachPdf', 'tableHtmlSize', 'hasNotes', 'issueCount', 'columnCount'];
    for (const field of allowedMetadataFields) {
      if (emailData.metadata[field] !== undefined) {
        safeMetadata[field] = emailData.metadata[field];
      }
    }
  }
  
  const record = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9), // Unique ID
    timestamp: new Date().toISOString(),
    username: username || 'unknown',
    userEmail: userEmail || 'unknown',
    to: Array.isArray(to) ? to : [to],
    cc: Array.isArray(cc) ? cc : (cc ? [cc] : []),
    subject: subject || '',
    jiraKey: jiraKey || null,
    releaseVersions: releaseVersions || null,
    messageId: messageId || null,
    metadata: safeMetadata, // Only safe metadata, no tokens
    type: explicitType || (jiraKey ? 'jira' : (releaseVersions ? 'release-versions' : 'general'))
  };
  
  await db.insert(record);
  return record;
}

/**
 * Get email history with optional filters
 * @param {Object} filters - Optional filters
 * @param {string} filters.username - Filter by username
 * @param {string} filters.jiraKey - Filter by JIRA key
 * @param {string} filters.releaseVersion - Filter by release version
 * @param {number} filters.limit - Limit number of results (default: 100)
 * @param {number} filters.offset - Offset for pagination (default: 0)
 * @returns {Promise<Array>} Array of email records
 */
async function getEmailHistory(filters = {}) {
  let records = await db.all();
  
  // Apply filters
  if (filters.username) {
    records = records.filter(r => 
      r.username?.toLowerCase().includes(filters.username.toLowerCase()) ||
      r.userEmail?.toLowerCase().includes(filters.username.toLowerCase())
    );
  }
  
  if (filters.jiraKey) {
    records = records.filter(r => r.jiraKey === filters.jiraKey);
  }
  
  if (filters.releaseVersion) {
    records = records.filter(r => 
      r.releaseVersions && r.releaseVersions.includes(filters.releaseVersion)
    );
  }
  
  // Sort by timestamp (newest first)
  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Apply pagination
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;
  
  return records.slice(offset, offset + limit);
}

/**
 * Get email statistics
 * @returns {Promise<Object>} Statistics object
 */
async function getEmailStatistics() {
  const records = await db.all();
  const byTimestampDesc = [...records].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    total: records.length,
    byType: {
      jira: records.filter(r => r.type === 'jira').length,
      'release-versions': records.filter(r => r.type === 'release-versions').length,
      general: records.filter(r => r.type === 'general').length,
      'generic-reminder': records.filter(r => r.type === 'generic-reminder').length
    },
    byUser: records.reduce((acc, r) => {
      const user = r.username || r.userEmail || 'unknown';
      acc[user] = (acc[user] || 0) + 1;
      return acc;
    }, {}),
    lastSent: byTimestampDesc.length > 0 ? byTimestampDesc[0].timestamp : null
  };
}

/**
 * Delete email records by filters
 * @param {Object} filters - Filters to match records for deletion
 * @param {string} filters.username - Delete emails by username
 * @param {string} filters.jiraKey - Delete emails by JIRA key
 * @param {string} filters.releaseVersion - Delete emails by release version
 * @param {Date} filters.beforeDate - Delete emails before this date
 * @param {Date} filters.afterDate - Delete emails after this date
 * @param {boolean} filters.testOnly - Only delete emails marked as test
 * @returns {Promise<number>} Number of records deleted
 */
async function deleteEmailHistory(filters = {}) {
  let records = await db.all();
  const initialCount = records.length;
  
  // Apply filters to determine which records to delete
  records = records.filter(record => {
    // Test only filter
    if (filters.testOnly && !record.metadata?.isTest) {
      return true; // Keep non-test records
    }
    
    // Username filter
    if (filters.username) {
      const usernameMatch = record.username?.toLowerCase().includes(filters.username.toLowerCase()) ||
                           record.userEmail?.toLowerCase().includes(filters.username.toLowerCase());
      if (!usernameMatch) return true; // Keep if doesn't match
    }
    
    // JIRA key filter
    if (filters.jiraKey && record.jiraKey !== filters.jiraKey) {
      return true; // Keep if doesn't match
    }
    
    // Release version filter
    if (filters.releaseVersion) {
      const hasVersion = record.releaseVersions && record.releaseVersions.includes(filters.releaseVersion);
      if (!hasVersion) return true; // Keep if doesn't match
    }
    
    // Date range filters
    if (filters.beforeDate) {
      const recordDate = new Date(record.timestamp);
      if (recordDate >= filters.beforeDate) return true; // Keep if after beforeDate
    }
    
    if (filters.afterDate) {
      const recordDate = new Date(record.timestamp);
      if (recordDate <= filters.afterDate) return true; // Keep if before afterDate
    }
    
    // If we get here, this record matches all filters - delete it
    return false;
  });
  
  // Rebuild database with only records to keep
  await db.clear();
  for (const record of records) {
    await db.insert(record);
  }
  
  return initialCount - records.length;
}

/**
 * Delete email record by ID
 * @param {string} id - Record ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteEmailById(id) {
  const records = await db.all();
  const filtered = records.filter(r => r.id !== id);
  
  if (filtered.length === records.length) {
    return false; // Record not found
  }
  
  await db.clear();
  for (const record of filtered) {
    await db.insert(record);
  }
  
  return true;
}

/**
 * Delete all test emails
 * @returns {Promise<number>} Number of test emails deleted
 */
async function deleteTestEmails() {
  return await deleteEmailHistory({ testOnly: true });
}

module.exports = {
  saveEmailHistory,
  getEmailHistory,
  getEmailStatistics,
  deleteEmailHistory,
  deleteEmailById,
  deleteTestEmails
};

