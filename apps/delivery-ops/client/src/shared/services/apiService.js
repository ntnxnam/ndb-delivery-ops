import { getApiBase, getAuthHeaders } from '../../utils/api';

class ApiService {
  constructor() {
    this.apiBase = getApiBase();
    this.activeRequests = new Map();
  }

  async request(url, options = {}) {
    const {
      method = 'GET',
      body = null,
      headers = {},
      signal = null,
      loadingKey = null,
      onProgress = null,
      errorContext = '',
      estimatedTime = null,
      stages = []
    } = options;

    const requestId = `${loadingKey || 'request'}_${Date.now()}`;
    const fullUrl = url.startsWith('http') ? url : `${this.apiBase}${url}`;

    try {
      // Create abort controller if not provided
      const controller = signal ? null : new AbortController();
      const requestSignal = signal || controller?.signal;

      if (controller) {
        this.activeRequests.set(requestId, controller);
      }

      // Simulate progress for better UX
      if (loadingKey && onProgress && estimatedTime) {
        this.simulateProgress(loadingKey, onProgress, stages, estimatedTime);
      }

      // Prepare headers
      const { headers: authHeaders } = getAuthHeaders();
      const requestHeaders = {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...headers
      };

      // Prepare request options
      const requestOptions = {
        method,
        headers: requestHeaders,
        signal: requestSignal
      };

      if (body && method !== 'GET') {
        requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const response = await fetch(fullUrl, requestOptions);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = this.getErrorMessage(response.status, errorData, errorContext);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      // Handle different types of errors
      if (error.name === 'AbortError') {
        throw error; // Re-throw abort errors as-is
      }

      // Transform network errors to user-friendly messages
      const userFriendlyError = this.transformError(error, errorContext);
      throw userFriendlyError;

    } finally {
      if (this.activeRequests.has(requestId)) {
        this.activeRequests.delete(requestId);
      }
    }
  }

  simulateProgress(loadingKey, progressHandler, stages, estimatedTime) {
    let progress = 0;
    let stageIndex = 0;
    const totalSteps = Math.ceil(estimatedTime / 500);

    const progressInterval = setInterval(() => {
      progress += (85 / totalSteps); // Only go to 85% via simulation

      if (progress >= 85) {
        clearInterval(progressInterval);
        return;
      }

      // Update stage based on progress
      const expectedStageIndex = Math.floor((progress / 85) * stages.length);
      if (expectedStageIndex !== stageIndex && stages[expectedStageIndex]) {
        stageIndex = expectedStageIndex;
        progressHandler.updateProgress(
          progress,
          stages[stageIndex],
          this.getStageMessage(stages[stageIndex])
        );
      } else {
        progressHandler.updateProgress(progress);
      }
    }, 500);

    // Store interval for cleanup
    this.activeRequests.set(`${loadingKey}_progress`, progressInterval);
  }

  getStageMessage(stage) {
    const messages = {
      'connecting': 'Connecting to server...',
      'authenticating': 'Authenticating...',
      'fetching': 'Fetching data...',
      'processing': 'Processing results...',
      'formatting': 'Formatting data...',
      'finalizing': 'Almost done...',
      'querying': 'Running query...',
      'validating': 'Validating data...',
      'parsing': 'Parsing response...'
    };
    return messages[stage] || `${stage.charAt(0).toUpperCase() + stage.slice(1)}...`;
  }

  getErrorMessage(status, errorData, context) {
    const baseContext = context ? ` while ${context}` : '';
    
    switch (status) {
      case 400:
        return errorData.message || `Bad request${baseContext}. Please check your input.`;
      case 401:
        return `Authentication failed${baseContext}. Please check your credentials.`;
      case 403:
        return `Access denied${baseContext}. You don't have permission for this action.`;
      case 404:
        return `Resource not found${baseContext}. The requested data may have been moved or deleted.`;
      case 429:
        return `Too many requests${baseContext}. Please wait a moment and try again.`;
      case 500:
        return `Server error${baseContext}. Please try again in a moment.`;
      case 502:
      case 503:
      case 504:
        return `Service temporarily unavailable${baseContext}. Please try again later.`;
      default:
        return errorData.message || errorData.error || `Request failed${baseContext}`;
    }
  }

  transformError(error, context) {
    if (error.message.includes('fetch')) {
      if (error.message.includes('timeout')) {
        return new Error(`The request timed out${context ? ` while ${context}` : ''}. Please check your connection and try again.`);
      }
      if (error.message.includes('network')) {
        return new Error(`Network error${context ? ` while ${context}` : ''}. Please check your internet connection.`);
      }
    }
    
    // Return the original error if we can't transform it
    return error;
  }

  cancelRequest(requestId) {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      if (controller.abort) {
        controller.abort();
      } else {
        // It's a progress interval
        clearInterval(controller);
      }
      this.activeRequests.delete(requestId);
    }
  }

  cancelAllRequests() {
    this.activeRequests.forEach((controller, _requestId) => {
      if (controller.abort) {
        controller.abort();
      } else {
        clearInterval(controller);
      }
    });
    this.activeRequests.clear();
  }
}

export const apiService = new ApiService();