const axios = require('axios');
const path = require('path');
const { JIRA_API_V2 } = require('../../config/api');
const logger = require('../../utils/logger');
const { extractApiError, getJiraErrorMessage, formatErrorResponse } = require('../../utils/errorMessages');
const { createHttpsAgent } = require('../../services/jiraService');
const tokenCache = require('../../utils/tokenCache');

// Helper functions
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  
  // Support both "Bearer <token>" and just "<token>"
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return authHeader;
}

function normalizeToUsername(input) {
  if (!input) return '';
  const trimmed = String(input).trim().toLowerCase();
  if (trimmed.includes('@')) {
    return trimmed.split('@')[0];
  }
  return trimmed;
}

function isValidUsername(username) {
  if (!username) return false;
  const usernameRegex = /^[a-z0-9._-]+$/i;
  return usernameRegex.test(username.trim());
}

/**
 * Validates JIRA Bearer token and ensures it belongs to the provided username
 * @param {string} token - JIRA Bearer token
 * @param {string} username - Expected username (normalized)
 * @returns {Promise<{valid: boolean, userData?: object, error?: string, skipUserValidation?: boolean}>}
 */
async function validateJiraToken(token, username) {
  const cleanToken = token.trim();
  
  // Check cache first
  const cachedResult = tokenCache.get(cleanToken, username);
  if (cachedResult) {
    console.log(`[TokenCache] ✅ Cache hit for user: ${username}`);
    return cachedResult;
  }
  
  console.log(`[TokenCache] 🔍 Cache miss for user: ${username}, validating with JIRA API...`);
  const httpsAgent = createHttpsAgent();
  
  // Try /rest/api/2/myself first, fallback to /rest/api/2/serverInfo if needed
  let response = null;
  let userData = null;
  
  try {
    // First, try to get user info from /rest/api/2/myself
    try {
      response = await axios.get(JIRA_API_V2.MYSELF, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 30000  // Increased from 10s to 30s for better reliability
      });
      userData = response.data;
    } catch (myselfError) {
      // If /myself doesn't exist (404), try /rest/api/2/serverInfo to validate token
      if (myselfError.response?.status === 404) {
        console.log('/rest/api/2/myself not available, trying /rest/api/2/serverInfo');
        const serverInfoResponse = await axios.get(JIRA_API_V2.SERVER_INFO, {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: httpsAgent,
          timeout: 30000  // Increased from 10s to 30s for better reliability
        });
        
        // Token is valid if serverInfo returns successfully
        if (serverInfoResponse.data && serverInfoResponse.status === 200) {
          const result = {
            valid: true,
            userData: { name: username }, // Use provided username as fallback
            skipUserValidation: true
          };
          
          // Cache the successful validation
          tokenCache.set(cleanToken, username, result);
          
          return result;
        }
      }
      // Re-throw if it's not a 404
      throw myselfError;
    }

    // If we got here, we have user data from /myself endpoint
    // JIRA API v2 returns 'key' instead of 'accountId'
    if (!userData || (!userData.key && !userData.name)) {
      return { valid: false, error: 'Invalid JIRA token - no user data' };
    }

    // Extract username from JIRA v2 response
    const jiraEmail = userData.emailAddress || userData.email || '';
    const jiraUsername = jiraEmail ? normalizeToUsername(jiraEmail) : null;
    const jiraName = userData.name || userData.displayName || '';
    
    // Check if token belongs to the provided username
    if (jiraUsername && jiraUsername !== username) {
      return {
        valid: false,
        error: 'JIRA token mismatch',
        message: `The provided JIRA token belongs to '${jiraUsername}', but you specified username '${username}'. Please use the token that belongs to your account.`,
        providedUsername: username,
        tokenOwner: jiraUsername
      };
    }

    // If we don't have email but have name, try to match by name
    if (!jiraUsername && jiraName) {
      const nameUsername = normalizeToUsername(jiraName);
      if (nameUsername !== username) {
        return {
          valid: false,
          error: 'JIRA token mismatch',
          message: `The provided JIRA token belongs to '${nameUsername}', but you specified username '${username}'. Please use the token that belongs to your account.`,
          providedUsername: username,
          tokenOwner: nameUsername
        };
      }
    }

    const result = { valid: true, userData };
    
    // Cache the successful validation
    tokenCache.set(cleanToken, username, result);
    
    return result;
  } catch (apiError) {
    // Handle all network-level errors that mean JIRA is unreachable
    const networkCodes = ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'];
    if (networkCodes.includes(apiError.code)) {
      const isVpnError = apiError.code === 'ENOTFOUND' || apiError.code === 'EAI_AGAIN';
      const userMessage = isVpnError
        ? `Cannot reach JIRA (${apiError.code}). Please check that you are connected to the corporate VPN and try again.`
        : `Connection to JIRA was interrupted (${apiError.code}). This may be a temporary network issue. Please try again.`;
      console.error(`[JIRA Auth] Network error (${apiError.code}):`, apiError.message);
      return {
        valid: false,
        error: isVpnError ? 'JIRA Unreachable' : 'Connection Error',
        message: userMessage,
        reason: 'jira_unreachable',
        statusCode: 503
      };
    }
    
    // JIRA 429 on /myself is common after a server restart: the in-memory
    // token cache is empty, so every request re-validates, and JIRA is
    // often still rate-limiting the previous session. Allow a short grace
    // session so cache-backed pages (SoS, dataset) can load without
    // hammering /myself again.
    if (apiError.response?.status === 429) {
      console.warn(`[JIRA Auth] Rate limited validating token for ${username}; allowing a short grace session`);
      const grace = {
        valid: true,
        userData: { name: username },
        skipUserValidation: true,
        degraded: true,
      };
      tokenCache.set(cleanToken, username, grace);
      return grace;
    }

    // Use centralized error extraction for other errors
    const errorResponse = extractApiError(apiError, 'JIRA', { baseUrl: JIRA_API_V2.BASE_URL });
    return {
      valid: false,
      error: errorResponse.error,
      message: errorResponse.message,
      ...(errorResponse.reason && { reason: errorResponse.reason }),
      statusCode: errorResponse.statusCode
    };
  }
}

/**
 * Express middleware to validate JIRA Bearer token
 * Attaches req.jiraToken, req.jiraUser, and req.username if valid
 */
const validateJiraTokenMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header only (Bearer token)
    const jiraToken = extractToken(req);
    
    console.log('validateJiraToken middleware:', {
      path: req.path,
      hasAuthHeader: !!req.headers.authorization,
      authHeaderPrefix: req.headers.authorization?.substring(0, 20) || 'none',
      tokenExtracted: !!jiraToken,
      tokenLength: jiraToken?.length,
      username: req.body?.username || req.headers['x-username']
    });

    if (!jiraToken) {
      logger.auth.failure(req.body?.username || 'unknown', 'JIRA', 'Token not provided in Authorization header', {
        path: req.path,
        method: req.method,
        hasAuthHeader: !!req.headers.authorization,
        ip: req.ip || req.connection.remoteAddress
      });
      return res.status(401).json({ 
        error: 'JIRA token is required. Please provide it as Bearer token in Authorization header.',
        message: 'No Authorization header found. Please ensure the token is sent as Bearer token in the Authorization header.'
      });
    }

    // Get username from request (body or header)
    const providedUsername = req.body?.username || req.body?.userEmail || req.headers['x-user-email'] || req.headers['x-username'];
    if (!providedUsername) {
      return res.status(400).json({ 
        error: 'Username is required. Please provide your Nutanix username (e.g., namratha.singh) in the request.' 
      });
    }

    // Normalize username
    const normalizedUsername = normalizeToUsername(providedUsername);
    if (!isValidUsername(normalizedUsername)) {
      return res.status(400).json({ 
        error: 'Invalid username format. Please provide your Nutanix username (e.g., namratha.singh).' 
      });
    }

    // Validate token
    const validationResult = await validateJiraToken(jiraToken, normalizedUsername);
    
    if (!validationResult.valid) {
      logger.auth.failure(normalizedUsername, 'JIRA', validationResult.error || 'Token validation failed', {
        path: req.path,
        ip: req.ip || req.connection.remoteAddress
      });
      
      // Handle token mismatch separately
      if (validationResult.error === 'JIRA token mismatch') {
        const mismatchError = getJiraErrorMessage('TOKEN_MISMATCH', {
          providedUsername: normalizedUsername,
          tokenOwner: validationResult.tokenOwner
        });
        return res.status(403).json(formatErrorResponse(mismatchError, 403, {
          providedUsername: normalizedUsername,
          tokenOwner: validationResult.tokenOwner
        }));
      }
      
      const statusCode = validationResult.statusCode || 401;
      return res.status(statusCode).json({
        error: validationResult.error || 'Failed to validate JIRA token',
        message: validationResult.message || validationResult.error,
        ...(validationResult.reason && { reason: validationResult.reason }),
        statusCode
      });
    }

    // Attach validated token and user info to request
    req.jiraToken = jiraToken.trim();
    req.jiraUser = validationResult.userData;
    req.username = normalizedUsername;
    
    logger.auth.success(normalizedUsername, 'JIRA', {
      endpoint: validationResult.skipUserValidation ? JIRA_API_V2.SERVER_INFO : JIRA_API_V2.MYSELF,
      ip: req.ip || req.connection.remoteAddress
    });
    
    next();
  } catch (error) {
    console.error('Token validation middleware error:', error);
    logger.auth.error(req.body?.username || 'unknown', 'JIRA', 'Unexpected error in token validation', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Authentication error' });
  }
};

module.exports = {
  validateJiraToken,
  validateJiraTokenMiddleware,
  extractToken,
  createHttpsAgent,
  normalizeToUsername,
  isValidUsername
};

