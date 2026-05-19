import { useCallback } from 'react';
import { useNotifications } from '../services/notificationService';

export const useErrorHandler = () => {
  const { error: showError, warning: showWarning } = useNotifications();

  // Handle API errors with user-friendly messages
  const handleApiError = useCallback((error, context = '') => {
    let userMessage = 'An unexpected error occurred';
    let shouldRetry = false;
    let retryDelay = 0;

    if (error.response) {
      // HTTP error responses
      const { status, data } = error.response;
      
      switch (status) {
        case 400:
          userMessage = data.message || 'Invalid request. Please check your input and try again.';
          break;
        case 401:
          userMessage = 'Authentication failed. Please check your credentials and log in again.';
          break;
        case 403:
          userMessage = 'Access denied. You don\'t have permission to perform this action.';
          break;
        case 404:
          userMessage = 'The requested resource was not found. It may have been moved or deleted.';
          break;
        case 429:
          userMessage = 'Too many requests. Please wait a moment and try again.';
          shouldRetry = true;
          retryDelay = 5000; // 5 seconds
          break;
        case 500:
          userMessage = 'Server error. Please try again in a moment.';
          shouldRetry = true;
          retryDelay = 3000; // 3 seconds
          break;
        case 502:
        case 503:
        case 504:
          userMessage = 'Service temporarily unavailable. Please try again later.';
          shouldRetry = true;
          retryDelay = 10000; // 10 seconds
          break;
        default:
          userMessage = data.message || data.error || 'Request failed. Please try again.';
      }
    } else if (error.request) {
      // Network errors
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        userMessage = 'Request timed out. Please check your connection and try again.';
        shouldRetry = true;
        retryDelay = 2000;
      } else if (error.message.includes('Network Error')) {
        userMessage = 'Network error. Please check your internet connection.';
        shouldRetry = true;
        retryDelay = 5000;
      } else {
        userMessage = 'Unable to connect to the server. Please try again.';
        shouldRetry = true;
        retryDelay = 3000;
      }
    } else {
      // Other errors
      userMessage = error.message || 'An unexpected error occurred';
    }

    // Add context if provided
    const contextualMessage = context 
      ? `Failed ${context}: ${userMessage}`
      : userMessage;

    // Show appropriate notification
    if (shouldRetry) {
      showWarning(contextualMessage, {
        action: {
          label: 'Retry',
          onClick: () => {
            // Retry callback can be provided by the caller
            if (error.retry) {
              setTimeout(error.retry, retryDelay);
            }
          }
        },
        duration: retryDelay + 2000
      });
    } else {
      showError(contextualMessage);
    }

    return {
      userMessage: contextualMessage,
      shouldRetry,
      retryDelay,
      originalError: error
    };
  }, [showError, showWarning]);

  // Handle validation errors
  const handleValidationError = useCallback((errors, context = 'form validation') => {
    if (Array.isArray(errors)) {
      // Multiple validation errors
      const message = `${context} failed:\n• ${errors.join('\n• ')}`;
      showError(message, { duration: 8000 });
    } else if (typeof errors === 'object') {
      // Field-specific errors
      const fieldErrors = Object.entries(errors)
        .map(([field, error]) => `${field}: ${error}`)
        .join('\n• ');
      const message = `${context} failed:\n• ${fieldErrors}`;
      showError(message, { duration: 8000 });
    } else {
      // Single error message
      showError(`${context} failed: ${errors}`);
    }

    return {
      userMessage: `${context} failed`,
      errors: errors
    };
  }, [showError]);

  // Handle authentication errors
  const handleAuthError = useCallback((error) => {
    console.error('Authentication error:', error);
    
    if (error.response?.status === 401) {
      showError('Your session has expired. Please log in again.', {
        action: {
          label: 'Login',
          onClick: () => {
            // Clear local storage and redirect to login
            localStorage.removeItem('username');
            localStorage.removeItem('userEmail');
            localStorage.removeItem('jiraToken');
            window.location.href = '/login';
          }
        },
        persistent: true
      });
    } else {
      showError('Authentication failed. Please check your credentials.');
    }

    return {
      userMessage: 'Authentication failed',
      shouldRedirect: error.response?.status === 401
    };
  }, [showError]);

  // Handle permission errors
  const handlePermissionError = useCallback((error, resource = 'resource') => {
    console.error('Permission error:', error);
    
    const message = `You don't have permission to access ${resource}. Contact your administrator if you believe this is an error.`;
    
    showError(message, {
      action: {
        label: 'Go Back',
        onClick: () => {
          window.history.back();
        }
      }
    });

    return {
      userMessage: message,
      shouldGoBack: true
    };
  }, [showError]);

  // Generic error handler that routes to appropriate specific handler
  const handleError = useCallback((error, options = {}) => {
    
    const { context = '', type = 'api' } = options;

    switch (type) {
      case 'validation':
        return handleValidationError(error, context);
      case 'auth':
        return handleAuthError(error);
      case 'permission':
        return handlePermissionError(error, context);
      case 'api':
      default:
        return handleApiError(error, context);
    }
  }, [handleApiError, handleValidationError, handleAuthError, handlePermissionError]);

  return {
    handleError,
    handleApiError,
    handleValidationError,
    handleAuthError,
    handlePermissionError
  };
};