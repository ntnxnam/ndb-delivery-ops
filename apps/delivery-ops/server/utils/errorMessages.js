/**
 * Centralized error message mapping for HTTP status codes, network errors, and API-specific errors
 */

const { JIRA_BASE_URL } = require('../config/api');

// HTTP Status Code to Error Message Mapping
const HTTP_STATUS_MESSAGES = {
  400: {
    title: 'Bad Request',
    description: 'The request was invalid or malformed. Please check your input and try again.',
    userMessage: 'Invalid request. Please check your input and try again.'
  },
  401: {
    title: 'Unauthorized',
    description: 'Authentication failed. Your token may be invalid, expired, or missing required permissions.',
    userMessage: 'Authentication failed. Please check your token and try again.'
  },
  403: {
    title: 'Forbidden',
    description: 'You do not have permission to access this resource.',
    userMessage: 'Access denied. You do not have permission to perform this action.'
  },
  404: {
    title: 'Not Found',
    description: 'The requested resource was not found.',
    userMessage: 'The requested resource was not found. Please verify the resource exists and you have access.'
  },
  408: {
    title: 'Request Timeout',
    description: 'The request took too long to process.',
    userMessage: 'Request timed out. Please try again.'
  },
  429: {
    title: 'Too Many Requests',
    description: 'Rate limit exceeded. Please wait before making another request.',
    userMessage: 'Too many requests. Please wait a moment and try again.'
  },
  500: {
    title: 'Internal Server Error',
    description: 'An unexpected error occurred on the server.',
    userMessage: 'An internal server error occurred. Please try again later.'
  },
  502: {
    title: 'Bad Gateway',
    description: 'The server received an invalid response from an upstream server.',
    userMessage: 'Service temporarily unavailable. Please try again later.'
  },
  503: {
    title: 'Service Unavailable',
    description: 'The service is temporarily unavailable.',
    userMessage: 'Service temporarily unavailable. Please try again later.'
  },
  504: {
    title: 'Gateway Timeout',
    description: 'The server did not receive a timely response from an upstream server.',
    userMessage: 'Request timed out. Please try again.'
  }
};

// Network Error Code to Error Message Mapping
const NETWORK_ERROR_MESSAGES = {
  ECONNABORTED: {
    title: 'Connection Aborted',
    description: 'The connection was aborted before completion.',
    userMessage: 'Connection was interrupted. Please check your network and try again.'
  },
  ETIMEDOUT: {
    title: 'Connection Timeout',
    description: 'The connection timed out while waiting for a response.',
    userMessage: 'Connection timed out. Please check your network connection and try again.'
  },
  ENOTFOUND: {
    title: 'Host Not Found',
    description: 'The hostname could not be resolved.',
    userMessage: 'Unable to reach the server. Please check your network connection and the server URL.'
  },
  EAI_AGAIN: {
    title: 'DNS Lookup Failed',
    description: 'DNS lookup failed. The hostname could not be resolved.',
    userMessage: 'DNS lookup failed. Please check your network connection and the server URL.'
  },
  ECONNREFUSED: {
    title: 'Connection Refused',
    description: 'The connection was refused by the server.',
    userMessage: 'Connection refused. The server may be down or not accepting connections.'
  },
  ECONNRESET: {
    title: 'Connection Reset',
    description: 'The connection was reset by the peer.',
    userMessage: 'Connection was reset. Please try again.'
  },
  EPIPE: {
    title: 'Broken Pipe',
    description: 'The connection was broken.',
    userMessage: 'Connection was broken. Please try again.'
  }
};

// JIRA API Specific Error Messages
const JIRA_ERROR_MESSAGES = {
  INVALID_TOKEN: {
    title: 'Invalid JIRA Token',
    description: 'The JIRA token is invalid, expired, or does not have the required permissions.',
    userMessage: `Your JIRA token is invalid or expired. Please verify your token at: ${JIRA_BASE_URL}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`
  },
  TOKEN_MISMATCH: {
    title: 'JIRA Token Mismatch',
    description: 'The provided JIRA token belongs to a different user than specified.',
    userMessage: 'The JIRA token belongs to a different user. Please use the token that belongs to your account.'
  },
  ISSUE_NOT_FOUND: {
    title: 'JIRA Issue Not Found',
    description: 'The requested JIRA issue does not exist or you do not have permission to view it.',
    userMessage: 'JIRA issue not found. Please verify the issue key is correct and you have permission to view it.'
  },
  INVALID_ISSUE_TYPE: {
    title: 'Invalid Issue Type',
    description: 'The JIRA issue type is not allowed for this operation.',
    userMessage: 'This issue type is not supported. Allowed types: Feature, Initiative, X-FEAT, Capability.'
  },
  PERMISSION_DENIED: {
    title: 'Permission Denied',
    description: 'You do not have permission to perform this action on the JIRA issue.',
    userMessage: 'You do not have permission to access this JIRA issue. Please contact your administrator.'
  }
};

// Confluence API Specific Error Messages
const CONFLUENCE_ERROR_MESSAGES = {
  INVALID_TOKEN: {
    title: 'Invalid Confluence Token',
    description: 'The Confluence token is invalid, expired, or does not have the required permissions.',
    userMessage: 'Your Confluence token is invalid or expired. Please verify your token at: https://confluence.eng.nutanix.com:8443/plugins/personalaccesstokens/usertokens.action'
  },
  TOKEN_MISMATCH: {
    title: 'Confluence Token Mismatch',
    description: 'The provided Confluence token belongs to a different user than specified.',
    userMessage: 'The Confluence token belongs to a different user. Please use the token that belongs to your account.'
  },
  PAGE_NOT_FOUND: {
    title: 'Confluence Page Not Found',
    description: 'The requested Confluence page does not exist or you do not have permission to view it.',
    userMessage: 'Confluence page not found. Please verify the page ID or URL is correct and you have permission to view it.'
  },
  PERMISSION_DENIED: {
    title: 'Permission Denied',
    description: 'You do not have permission to access this Confluence resource.',
    userMessage: 'You do not have permission to access this Confluence resource. Please contact your administrator.'
  }
};

/**
 * Get error message for HTTP status code
 * @param {number} statusCode - HTTP status code
 * @param {string} service - Service name (e.g., 'JIRA', 'Confluence')
 * @param {object} context - Additional context (e.g., { jiraKey: 'FEAT-123' })
 * @returns {object} Error message object
 */
function getHttpErrorMessage(statusCode, service = '', context = {}) {
  const baseMessage = HTTP_STATUS_MESSAGES[statusCode] || {
    title: `HTTP ${statusCode} Error`,
    description: 'An error occurred while processing your request.',
    userMessage: `An error occurred (HTTP ${statusCode}). Please try again.`
  };

  // Service-specific customizations
  if (service === 'JIRA') {
    if (statusCode === 401) {
      return {
        ...baseMessage,
        title: JIRA_ERROR_MESSAGES.INVALID_TOKEN.title,
        userMessage: JIRA_ERROR_MESSAGES.INVALID_TOKEN.userMessage,
        ...(context.jiraKey && { jiraKey: context.jiraKey })
      };
    }
    if (statusCode === 404 && context.jiraKey) {
      return {
        ...baseMessage,
        title: JIRA_ERROR_MESSAGES.ISSUE_NOT_FOUND.title,
        userMessage: `${JIRA_ERROR_MESSAGES.ISSUE_NOT_FOUND.userMessage} (${context.jiraKey})`,
        jiraKey: context.jiraKey
      };
    }
    if (statusCode === 403) {
      return {
        ...baseMessage,
        title: JIRA_ERROR_MESSAGES.PERMISSION_DENIED.title,
        userMessage: JIRA_ERROR_MESSAGES.PERMISSION_DENIED.userMessage
      };
    }
  }

  if (service === 'Confluence') {
    if (statusCode === 401) {
      return {
        ...baseMessage,
        title: CONFLUENCE_ERROR_MESSAGES.INVALID_TOKEN.title,
        userMessage: CONFLUENCE_ERROR_MESSAGES.INVALID_TOKEN.userMessage
      };
    }
    if (statusCode === 404) {
      return {
        ...baseMessage,
        title: CONFLUENCE_ERROR_MESSAGES.PAGE_NOT_FOUND.title,
        userMessage: CONFLUENCE_ERROR_MESSAGES.PAGE_NOT_FOUND.userMessage
      };
    }
    if (statusCode === 403) {
      return {
        ...baseMessage,
        title: CONFLUENCE_ERROR_MESSAGES.PERMISSION_DENIED.title,
        userMessage: CONFLUENCE_ERROR_MESSAGES.PERMISSION_DENIED.userMessage
      };
    }
  }

  return baseMessage;
}

/**
 * Get error message for network error code
 * @param {string} errorCode - Network error code (e.g., 'ECONNABORTED')
 * @param {string} service - Service name (e.g., 'JIRA', 'Confluence')
 * @param {string} baseUrl - Base URL of the service
 * @returns {object} Error message object
 */
function getNetworkErrorMessage(errorCode, service = '', baseUrl = '') {
  const baseMessage = NETWORK_ERROR_MESSAGES[errorCode] || {
    title: 'Network Error',
    description: 'A network error occurred.',
    userMessage: 'A network error occurred. Please check your connection and try again.'
  };

  // Add VPN/network guidance for host not found errors
  let userMessage = baseMessage.userMessage;
  if ((errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') && baseUrl && baseUrl.includes('nutanix.com')) {
    userMessage = `${baseMessage.userMessage} (${service} server: ${baseUrl})\n\n` +
      `⚠️  This appears to be an internal Nutanix server. Please ensure:\n` +
      `   • You are connected to the corporate VPN\n` +
      `   • Your network connection is active\n` +
      `   • DNS can resolve the hostname`;
  } else {
    userMessage = baseMessage.userMessage + (baseUrl ? ` (${service} server: ${baseUrl})` : '');
  }

  return {
    ...baseMessage,
    userMessage,
    service,
    baseUrl
  };
}

/**
 * Get error message for JIRA-specific errors
 * @param {string} errorType - Error type (e.g., 'TOKEN_MISMATCH')
 * @param {object} context - Additional context
 * @returns {object} Error message object
 */
function getJiraErrorMessage(errorType, context = {}) {
  const baseMessage = JIRA_ERROR_MESSAGES[errorType] || {
    title: 'JIRA Error',
    description: 'An error occurred while communicating with JIRA.',
    userMessage: 'An error occurred while communicating with JIRA. Please try again.'
  };

  return {
    ...baseMessage,
    ...context
  };
}

/**
 * Get error message for Confluence-specific errors
 * @param {string} errorType - Error type (e.g., 'TOKEN_MISMATCH')
 * @param {object} context - Additional context
 * @returns {object} Error message object
 */
function getConfluenceErrorMessage(errorType, context = {}) {
  const baseMessage = CONFLUENCE_ERROR_MESSAGES[errorType] || {
    title: 'Confluence Error',
    description: 'An error occurred while communicating with Confluence.',
    userMessage: 'An error occurred while communicating with Confluence. Please try again.'
  };

  return {
    ...baseMessage,
    ...context
  };
}

/**
 * Format error response for API
 * @param {object} errorInfo - Error information object
 * @param {number} statusCode - HTTP status code
 * @param {object} additionalDetails - Additional error details
 * @returns {object} Formatted error response
 */
function formatErrorResponse(errorInfo, statusCode, additionalDetails = {}) {
  return {
    error: errorInfo.title,
    message: errorInfo.userMessage,
    description: errorInfo.description,
    statusCode,
    ...additionalDetails
  };
}

/**
 * Extract error message from API response
 * @param {object} apiError - Axios error object
 * @param {string} service - Service name
 * @param {object} context - Additional context
 * @returns {object} Formatted error response
 */
function extractApiError(apiError, service = '', context = {}) {
  // Check for HTTP status code
  if (apiError.response?.status) {
    const statusCode = apiError.response.status;
    let errorInfo = getHttpErrorMessage(statusCode, service, context);
    
    // Extract additional details from API response
    const apiErrorMessages = apiError.response?.data?.errorMessages || [];
    const apiWarnings = apiError.response?.data?.warningMessages || [];
    const apiErrors = apiError.response?.data?.errors || {};
    const responseMessage = apiError.response?.data?.message;
    const responseError = apiError.response?.data?.error;

    // For 400/422, prefer the upstream API's message so the user sees the real validation error (e.g. JIRA JQL error)
    if ((statusCode === 400 || statusCode === 422) && (apiErrorMessages.length > 0 || responseMessage || responseError)) {
      const upstreamMessage = apiErrorMessages.length > 0
        ? apiErrorMessages.join(' ')
        : (responseMessage || responseError || errorInfo.userMessage);
      errorInfo = { ...errorInfo, userMessage: upstreamMessage };
    }
    
    const details = {
      ...errorInfo,
      apiErrorMessages: apiErrorMessages.length > 0 ? apiErrorMessages : undefined,
      apiWarnings: apiWarnings.length > 0 ? apiWarnings : undefined,
      apiErrors: Object.keys(apiErrors).length > 0 ? apiErrors : undefined,
      rawResponse: apiError.response?.data
    };

    return formatErrorResponse(errorInfo, statusCode, details);
  }

  // Check for network error code
  if (apiError.code && NETWORK_ERROR_MESSAGES[apiError.code]) {
    const errorInfo = getNetworkErrorMessage(
      apiError.code, 
      service, 
      context.baseUrl
    );
    
    // Map network errors to appropriate HTTP status codes
    let httpStatus = 500;
    if (apiError.code === 'ECONNABORTED' || apiError.code === 'ETIMEDOUT') {
      httpStatus = 504;
    } else if (apiError.code === 'ENOTFOUND' || apiError.code === 'EAI_AGAIN' || apiError.code === 'ECONNREFUSED') {
      httpStatus = 503;
    }

    return formatErrorResponse(errorInfo, httpStatus, {
      errorCode: apiError.code,
      service,
      baseUrl: context.baseUrl
    });
  }

  // Generic error - provide more helpful message
  let userMessage = 'An unexpected error occurred. Please try again.';
  if (apiError.message) {
    // Include the actual error message for better debugging
    userMessage = `${userMessage} (${apiError.message})`;
  }
  
  const errorInfo = {
    title: 'Unknown Error',
    description: apiError.message || 'An unexpected error occurred.',
    userMessage: userMessage
  };

  return formatErrorResponse(errorInfo, 500, {
    errorMessage: apiError.message,
    errorCode: apiError.code,
    // Include stack trace in development mode
    ...(process.env.NODE_ENV !== 'production' && {
      stack: apiError.stack
    })
  });
}

module.exports = {
  HTTP_STATUS_MESSAGES,
  NETWORK_ERROR_MESSAGES,
  JIRA_ERROR_MESSAGES,
  CONFLUENCE_ERROR_MESSAGES,
  getHttpErrorMessage,
  getNetworkErrorMessage,
  getJiraErrorMessage,
  getConfluenceErrorMessage,
  formatErrorResponse,
  extractApiError
};

