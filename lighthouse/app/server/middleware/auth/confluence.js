const { CONFLUENCE_API } = require('../../config/api');
const logger = require('../../utils/logger');
const { extractApiError, getConfluenceErrorMessage, formatErrorResponse } = require('../../utils/errorMessages');
const { getConfluence } = require('../../utils/confluenceClient');

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
 * Validates Confluence Bearer token and ensures it belongs to the provided username
 * @param {string} token - Confluence Bearer token
 * @param {string} username - Expected username (normalized)
 * @returns {Promise<{valid: boolean, userData?: object, error?: string, skipUserValidation?: boolean}>}
 */
async function validateConfluenceToken(token, username) {
  const cleanToken = token.trim();
  const confluence = await getConfluence(cleanToken);
  
  // Try multiple endpoints to validate token
  const endpoints = [
    { url: CONFLUENCE_API.USER_CURRENT, name: 'user/current' },
    { url: CONFLUENCE_API.USER, name: 'user' },
    { url: `${CONFLUENCE_API.CONTENT}?limit=1`, name: 'content (with limit=1)' }
  ];
  
  let lastError = null;
  let response = null;
  
  for (const endpoint of endpoints) {
    try {
      response = await confluence.get(endpoint.url, { timeout: 10000 });

      // For /user endpoints, check for user data
      if (endpoint.url.includes('/user')) {
        if (response.data && response.data.userKey) {
          // Extract username from Confluence response
          // IMPORTANT: userKey is an account ID, NOT a username
          const confluenceEmail = response.data.email || '';
          const confluenceUsernameField = response.data.username || '';
          
          let confluenceUsername = null;
          if (confluenceEmail) {
            confluenceUsername = normalizeToUsername(confluenceEmail);
          } else if (confluenceUsernameField) {
            confluenceUsername = normalizeToUsername(confluenceUsernameField);
          }
          
          // Check if token belongs to the provided username
          if (confluenceUsername && confluenceUsername !== username) {
            return {
              valid: false,
              error: 'Confluence token mismatch',
              message: `The provided Confluence token belongs to '${confluenceUsername}', but you specified username '${username}'. Please use the token that belongs to your account.`,
              providedUsername: username,
              tokenOwner: confluenceUsername
            };
          }
          
          return { valid: true, userData: response.data };
        }
      } 
      // For /content endpoint, just check if we got a response
      else if (endpoint.url.includes('/content')) {
        if (response.data && response.status === 200) {
          // Token is valid, but we can't verify username match without user data
          return { valid: true, userData: { name: username }, skipUserValidation: true };
        }
      }
    } catch (apiError) {
      lastError = apiError;
      
      // If it's a 401/403, token is definitely invalid
      if (apiError.response?.status === 401 || apiError.response?.status === 403) {
        const errorMessage = apiError.response?.data?.message || 
                            apiError.response?.data?.errorMessages?.join(', ') ||
                            'Invalid Confluence token - authentication failed';
        return { valid: false, error: errorMessage };
      }
      
      // For 404, try next endpoint
      if (apiError.response?.status === 404) {
        continue;
      }
    }
  }
  
  // If all endpoints failed, use centralized error extraction
  if (lastError) {
    const errorResponse = extractApiError(lastError, 'Confluence', { baseUrl: CONFLUENCE_API.BASE_URL });
    return {
      valid: false,
      error: errorResponse.error,
      message: errorResponse.message,
      statusCode: errorResponse.statusCode
    };
  }
  
  return { valid: false, error: 'Invalid Confluence token - unable to authenticate with any endpoint' };
}

/**
 * Express middleware to validate Confluence Bearer token
 * Attaches req.confluenceToken, req.confluenceUser, and req.username if valid
 */
const validateConfluenceTokenMiddleware = async (req, res, next) => {
  try {
    const confluenceToken = extractToken(req);

    if (!confluenceToken) {
      return res.status(401).json({ 
        error: 'Confluence token is required. Please provide it as Bearer token in Authorization header.' 
      });
    }

    // Get username from request
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
    const validationResult = await validateConfluenceToken(confluenceToken, normalizedUsername);
    
    if (!validationResult.valid) {
      logger.auth.failure(normalizedUsername, 'Confluence', validationResult.error || 'Token validation failed', {
        path: req.path,
        ip: req.ip || req.connection.remoteAddress
      });
      
      // Handle token mismatch separately
      if (validationResult.error === 'Confluence token mismatch') {
        const mismatchError = getConfluenceErrorMessage('TOKEN_MISMATCH', {
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
        error: validationResult.error || 'Failed to validate Confluence token',
        message: validationResult.message || validationResult.error,
        statusCode
      });
    }

    // Attach validated token and user info to request
    req.confluenceToken = confluenceToken.trim();
    req.confluenceUser = validationResult.userData;
    req.username = normalizedUsername;
    
    logger.auth.success(normalizedUsername, 'Confluence', {
      endpoint: CONFLUENCE_API.USER_CURRENT,
      ip: req.ip || req.connection.remoteAddress
    });
    
    next();
  } catch (error) {
    console.error('Confluence token validation middleware error:', error);
    logger.auth.error(req.body?.username || 'unknown', 'Confluence', 'Unexpected error in token validation', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Authentication error' });
  }
};

module.exports = {
  validateConfluenceToken,
  validateConfluenceTokenMiddleware,
  extractToken,
  normalizeToUsername,
  isValidUsername
};

