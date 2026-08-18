const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { JIRA_API_V2 } = require('../config/api');
const { extractApiError, getJiraErrorMessage } = require('../utils/errorMessages');
const { requireAuth } = require('../middleware/authMiddleware');
const allowedUsersConfig = require('../config/allowedUsers.json');
const logger = require('../utils/logger');

/**
 * Comprehensive login endpoint that validates credentials and returns permissions
 * This replaces the need for separate authentication and permission API calls
 */
router.post('/login', async (req, res) => {
  try {
    const { username, jiraToken } = req.body;
    
    if (!jiraToken) {
      return res.status(400).json({
        success: false,
        error: 'JIRA token is required'
      });
    }

    // Step 1: Validate JIRA credentials and extract user info
    let jiraUserInfo = null;
    try {
      const jiraResponse = await axios.get(JIRA_API_V2.MYSELF, {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      jiraUserInfo = jiraResponse.data;
      logger.info(`[AUTH] JIRA user info retrieved:`, {
        accountId: jiraUserInfo.accountId,
        displayName: jiraUserInfo.displayName,
        emailAddress: jiraUserInfo.emailAddress,
        name: jiraUserInfo.name
      });
      
    } catch (error) {
      const errorResponse = extractApiError(error, 'JIRA', { baseUrl: JIRA_API_V2.BASE_URL });
      const errorMessage = errorResponse.userMessage || 'Invalid JIRA credentials';
      logger.error(`[AUTH] ❌ JIRA validation failed:`, errorMessage);
      
      return res.status(401).json({
        success: false,
        error: errorMessage
      });
    }

    // Step 2: Extract username from JIRA info or use provided username
    let normalizedUsername;
    if (username) {
      normalizedUsername = username.toLowerCase().replace(/@.*$/, '');
      // Verify the username matches JIRA if both are provided
      const jiraUsername = (jiraUserInfo.name || jiraUserInfo.emailAddress || '').toLowerCase().replace(/@.*$/, '');
      if (jiraUsername && jiraUsername !== normalizedUsername) {
        logger.warn(`[AUTH] Username mismatch: provided=${normalizedUsername}, jira=${jiraUsername}`);
      }
    } else {
      // Extract username from JIRA user info
      if (jiraUserInfo.emailAddress) {
        normalizedUsername = jiraUserInfo.emailAddress.toLowerCase().replace(/@.*$/, '');
      } else if (jiraUserInfo.name) {
        normalizedUsername = jiraUserInfo.name.toLowerCase().replace(/@.*$/, '');
      } else {
        return res.status(400).json({
          success: false,
          error: 'Could not extract username from JIRA token. Please ensure your JIRA account has an email address.'
        });
      }
    }

    // Step 3: Fetch user permissions from allowedUsers config
    const permissions = transformLegacyPermissions(allowedUsersConfig, normalizedUsername);
    
    // Step 4: Return complete authentication and authorization data
    const responseData = {
      success: true,
      user: {
        username: normalizedUsername,
        email: `${normalizedUsername}@nutanix.com`,
        displayName: jiraUserInfo.displayName || jiraUserInfo.name || normalizedUsername
      },
      permissions: permissions.permissions,
      roles: permissions.roles,
      isSuperAdmin: permissions.isSuperAdmin,
      isAdmin: permissions.isAdmin,
      jiraConnected: true,
      jiraUser: {
        accountId: jiraUserInfo.accountId,
        displayName: jiraUserInfo.displayName
      }
    };

    logger.info(`[AUTH] ✅ ${normalizedUsername} authenticated with ${permissions.permissions.length} permissions`);
    
    res.json(responseData);

  } catch (error) {
    logger.error('[AUTH] Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during authentication'
    });
  }
});

/**
 * Transform legacy permission arrays to new permission system
 * This is a consolidated version of the client-side logic
 */
function transformLegacyPermissions(serverData, username) {
  const normalizedUsername = username.toLowerCase().replace(/@.*$/, '');
  const permissions = new Set();
  const roles = new Set();

  // Permission mappings from legacy arrays to new permissions.
  // Keep in sync with client/src/auth/constants/permissions.js LEGACY_PERMISSION_MAPPING.
  // Users in `allowedUsers` get release_trends_view as well so the Release Trends and
  // Release Analysis tabs are visible to everyone with baseline release access.
  const LEGACY_PERMISSION_MAPPING = {
    allowedUsers: ['release_versions_view', 'release_trends_view'],
    releaseVersionsEmailSenders: ['release_versions_email'],
    emailHistoryAllowedUsers: ['email_history_view'],
    kpiTabAllowedUsers: ['kpi_view'],
    genericEmailerAllowedUsers: ['email_send_generic'],
    releaseSetupAllowedUsers: ['release_setup_manage'],
    releaseConfigAllowedUsers: ['release_config_manage'],
    sprintReportAllowedUsers: ['sprint_reports_view']
  };

  // Check each legacy permission array
  Object.entries(LEGACY_PERMISSION_MAPPING).forEach(([legacyKey, permissionList]) => {
    if (serverData[legacyKey] && Array.isArray(serverData[legacyKey])) {
      const normalizedUsers = serverData[legacyKey].map(user => 
        user.toLowerCase().replace(/@.*$/, '')
      );
      if (normalizedUsers.includes(normalizedUsername)) {
        permissionList.forEach(permission => permissions.add(permission));
      }
    }
  });

  // Handle special admin roles
  const isSuperAdmin = serverData.superAdminUsers && 
    serverData.superAdminUsers.some(user => 
      user.toLowerCase().replace(/@.*$/, '') === normalizedUsername
    );
    
  const isAdmin = serverData.adminUsers && 
    serverData.adminUsers.some(user => 
      user.toLowerCase().replace(/@.*$/, '') === normalizedUsername
    );

  if (isSuperAdmin) {
    roles.add('super_admin');
    // Super admin gets all permissions
    Object.values(LEGACY_PERMISSION_MAPPING).flat().forEach(permission => 
      permissions.add(permission)
    );
    // Add admin-specific permissions
    permissions.add('admin_panel_access');
    permissions.add('user_management');
    permissions.add('team_management');
    permissions.add('system_config');
  }

  if (isAdmin) {
    roles.add('admin');
    permissions.add('admin_panel_access');
    permissions.add('user_management');
  }

  // Determine additional roles based on permissions
  if (permissions.has('release_setup_manage')) {
    roles.add('release_manager');
  }
  if (permissions.has('email_send_generic')) {
    roles.add('email_sender');
  }
  if (permissions.has('sprint_reports_view')) {
    roles.add('sprint_manager');
  }
  if (permissions.has('kpi_view')) {
    roles.add('kpi_manager');
  }

  // Default permissions for all authenticated users — every content page is open
  permissions.add('email_send_release');
  permissions.add('release_versions_view');
  permissions.add('release_trends_view');
  permissions.add('sprint_reports_view');
  permissions.add('kpi_view');
  permissions.add('email_history_view');

  return {
    permissions: Array.from(permissions),
    roles: Array.from(roles),
    isSuperAdmin: !!isSuperAdmin,
    isAdmin: !!isAdmin
  };
}

// VooDoo API Key Management
const crypto = require('crypto');
const voodooService = require('../services/voodooService');

// Simple encryption for API keys (should use proper key management in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-32-chars-for-dev-only'; // 32 chars
const IV_LENGTH = 16; // For AES, this is always 16

function encryptAPIKey(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptAPIKey(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = textParts.join(':');
  const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Store VooDoo API key
router.post('/voodoo-key', requireAuth(), async (req, res) => {
  try {
    const { apiKey } = req.body;
    const username = req.user.username;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid API key is required' 
      });
    }

    // Validate the API key with VooDoo service
    const isValid = await voodooService.validateAPIKey(apiKey);
    if (!isValid) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid VooDoo API key. Please check and try again.' 
      });
    }

    // Encrypt and store the API key
    const encryptedKey = encryptAPIKey(apiKey);
    
    // Store in user profile (extend existing user storage)
    const userProfilePath = path.join(__dirname, '../config/userProfiles', `${username}.json`);
    let userProfile = {};
    
    if (fs.existsSync(userProfilePath)) {
      userProfile = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
    }
    
    userProfile.voodooApiKey = encryptedKey;
    userProfile.voodooKeyUpdated = new Date().toISOString();
    
    // Ensure directory exists
    const userProfileDir = path.dirname(userProfilePath);
    if (!fs.existsSync(userProfileDir)) {
      fs.mkdirSync(userProfileDir, { recursive: true });
    }
    
    fs.writeFileSync(userProfilePath, JSON.stringify(userProfile, null, 2));

    console.log(`[VooDoo] API key stored for user: ${username}`);
    
    res.json({ 
      success: true, 
      message: 'VooDoo API key stored successfully',
      keyStored: true 
    });

  } catch (error) {
    console.error('Error storing VooDoo API key:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to store API key', 
      message: error.message 
    });
  }
});

// Check VooDoo API key status
router.get('/voodoo-key/status', requireAuth(), async (req, res) => {
  try {
    const username = req.user.username;
    const userProfilePath = path.join(__dirname, '../config/userProfiles', `${username}.json`);
    
    if (!fs.existsSync(userProfilePath)) {
      return res.json({ 
        success: true, 
        hasApiKey: false 
      });
    }
    
    const userProfile = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
    const hasApiKey = !!(userProfile.voodooApiKey);
    
    res.json({ 
      success: true, 
      hasApiKey,
      keyUpdated: userProfile.voodooKeyUpdated || null
    });

  } catch (error) {
    console.error('Error checking VooDoo API key status:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check API key status', 
      message: error.message 
    });
  }
});

// Clear VooDoo API key
router.delete('/voodoo-key', requireAuth(), async (req, res) => {
  try {
    const username = req.user.username;
    const userProfilePath = path.join(__dirname, '../config/userProfiles', `${username}.json`);
    
    if (fs.existsSync(userProfilePath)) {
      const userProfile = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
      delete userProfile.voodooApiKey;
      delete userProfile.voodooKeyUpdated;
      
      fs.writeFileSync(userProfilePath, JSON.stringify(userProfile, null, 2));
    }

    console.log(`[VooDoo] API key cleared for user: ${username}`);
    
    res.json({ 
      success: true, 
      message: 'VooDoo API key cleared successfully' 
    });

  } catch (error) {
    console.error('Error clearing VooDoo API key:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear API key', 
      message: error.message 
    });
  }
});

// Helper function to get VooDoo API key for internal use
async function getVooDooAPIKey(username) {
  try {
    const userProfilePath = path.join(__dirname, '../config/userProfiles', `${username}.json`);
    
    if (!fs.existsSync(userProfilePath)) {
      return null;
    }
    
    const userProfile = JSON.parse(fs.readFileSync(userProfilePath, 'utf8'));
    
    if (!userProfile.voodooApiKey) {
      return null;
    }
    
    return decryptAPIKey(userProfile.voodooApiKey);
  } catch (error) {
    console.error('Error retrieving VooDoo API key:', error.message);
    return null;
  }
}

// Export the helper function
router.getVooDooAPIKey = getVooDooAPIKey;

module.exports = router;