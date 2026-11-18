import axios from 'axios';
import { applyAxiosInterceptors, requestKey, withRequestGate } from '../../utils/requestGate';

applyAxiosInterceptors(axios);

/**
 * Canonical API wrapper — single source of truth for all HTTP calls.
 * Previously split between utils/api.js and this file; consolidated per Phase 4.
 * utils/api.js now re-exports from here for backward compat.
 */

// ── Auth / base helpers ──────────────────────────────────────────────

export const getApiBase = () => process.env.REACT_APP_API_URL || '';

const normalizeToUsername = (input) => {
  if (!input) return null;
  const trimmed = String(input).trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed.split('@')[0];
  return trimmed;
};

export const getAuthHeaders = (jiraToken = null, username = null) => {
  const headers = {};
  const jira = jiraToken || localStorage.getItem('jiraToken');
  if (!jira) {
    console.warn('getAuthHeaders: No JIRA token found in localStorage or options');
  }
  const storedUsername = username || localStorage.getItem('username') || localStorage.getItem('userEmail');
  const normalizedUsername = normalizeToUsername(storedUsername);
  if (jira) headers['Authorization'] = `Bearer ${jira}`;
  if (normalizedUsername) {
    headers['X-Username'] = normalizedUsername;
    headers['X-User-Email'] = `${normalizedUsername}@nutanix.com`;
  }
  return { headers };
};

// ── Axios authenticated helpers ──────────────────────────────────────

export const authenticatedPost = async (url, data = {}, options = {}, axiosConfig = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);
  const requestData = { ...data };
  const normalizedUsername = normalizeToUsername(username || localStorage.getItem('username') || localStorage.getItem('userEmail'));
  if (normalizedUsername) {
    if (!requestData.username) requestData.username = normalizedUsername;
    if (!requestData.userEmail) requestData.userEmail = `${normalizedUsername}@nutanix.com`;
  }
  let timeout = 60000;
  if (url.includes('/release-items-history')) timeout = 300000;
  else if (url.includes('/sos-items-history')) timeout = 180000;
  else if (url.includes('/release-items-commit') || url.includes('/release-items-long-term')) timeout = 180000;
  else if (url.includes('/api/jira/release-items') || url.includes('/api/release-dataset/project-status') || url.includes('/api/release-dataset/per-release')) timeout = 180000;
  else if (url.includes('/sprint-report') || url.includes('/sprint-report-trends')) timeout = 300000;
  else if (url.includes('/api/jira/sprints')) timeout = 90000;
  else if (url.includes('/inspect-base-filter') || url.includes('/project-scope') || url.includes('/board-calendar')) timeout = 120000;
  else if (url.includes('/api/ai/weekly-skim')) timeout = 600000;
  else if (url.includes('/api/ai/')) timeout = 180000;
  else if (url.includes('/system-test-scale')) timeout = 180000;
  else if (url.includes('/outstanding-report')) timeout = 180000;
  const config = { ...authHeaders, timeout, ...axiosConfig, requestGate: { managed: true, ignoreFailureCooldown } };
  return withRequestGate(requestKey('POST', url, data), () => axios.post(url, requestData, config), { ignoreFailureCooldown });
};

export const authenticatedPut = async (url, data = {}, options = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);
  const requestData = { ...data };
  const normalizedUsername = normalizeToUsername(username || localStorage.getItem('username') || localStorage.getItem('userEmail'));
  if (normalizedUsername) {
    if (!requestData.username) requestData.username = normalizedUsername;
    if (!requestData.userEmail) requestData.userEmail = `${normalizedUsername}@nutanix.com`;
  }
  return withRequestGate(requestKey('PUT', url, data), () => axios.put(url, requestData, { ...authHeaders, timeout: 60000, requestGate: { managed: true, ignoreFailureCooldown } }), { ignoreFailureCooldown });
};

export const authenticatedGet = async (url, params = {}, options = {}, axiosConfig = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);
  let timeout = 30000;
  if (url.includes('/system-test-scale')) timeout = 180000;
  else if (url.includes('/release-items') || url.includes('/project-status') || url.includes('/per-release') || url.includes('/release-dataset/synopsis') || url.includes('/release-dataset/outstanding')) timeout = 180000;
  return withRequestGate(requestKey('GET', url, null, params), () => axios.get(url, { ...authHeaders, params, timeout, ...axiosConfig, requestGate: { managed: true, ignoreFailureCooldown } }), { ignoreFailureCooldown });
};

export const authenticatedDelete = async (url, data = {}, options = {}) => {
  const { jiraToken, username, ignoreFailureCooldown = false } = options;
  const authHeaders = getAuthHeaders(jiraToken, username);
  return withRequestGate(requestKey('DELETE', url, data), () => axios.delete(url, { data, ...authHeaders, timeout: 60000, requestGate: { managed: true, ignoreFailureCooldown } }), { ignoreFailureCooldown });
};

// ── Fetch-based ApiService (progress-aware) ──────────────────────────

class ApiService {
  constructor() {
    this.apiBase = getApiBase();
    this.activeRequests = new Map();
  }
  async request(url, options = {}) {
    const { method = 'GET', body = null, headers = {}, signal = null, loadingKey = null, onProgress = null, errorContext = '', estimatedTime = null, stages = [], ignoreFailureCooldown = false } = options;
    const requestId = `${loadingKey || 'request'}_${Date.now()}`;
    const fullUrl = url.startsWith('http') ? url : `${this.apiBase}${url}`;
    try {
      const controller = signal ? null : new AbortController();
      const requestSignal = signal || controller?.signal;
      if (controller) this.activeRequests.set(requestId, controller);
      if (loadingKey && onProgress && estimatedTime) this.simulateProgress(loadingKey, onProgress, stages, estimatedTime);
      const { headers: authHeaders } = getAuthHeaders();
      const requestHeaders = { 'Content-Type': 'application/json', ...authHeaders, ...headers };
      const requestOptions = { method, headers: requestHeaders, signal: requestSignal };
      if (body && method !== 'GET') requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      const response = await withRequestGate(requestKey(method, fullUrl, body), () => fetch(fullUrl, requestOptions), { ignoreFailureCooldown });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(this.getErrorMessage(response.status, errorData, errorContext));
      }
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw this.transformError(error, errorContext);
    } finally {
      if (this.activeRequests.has(requestId)) this.activeRequests.delete(requestId);
    }
  }
  simulateProgress(loadingKey, progressHandler, stages, estimatedTime) {
    let progress = 0; let stageIndex = 0;
    const totalSteps = Math.ceil(estimatedTime / 500);
    const progressInterval = setInterval(() => {
      progress += 85 / totalSteps;
      if (progress >= 85) { clearInterval(progressInterval); return; }
      const expectedStageIndex = Math.floor((progress / 85) * stages.length);
      if (expectedStageIndex !== stageIndex && stages[expectedStageIndex]) {
        stageIndex = expectedStageIndex;
        progressHandler.updateProgress(progress, stages[expectedStageIndex], this.getStageMessage(stages[expectedStageIndex]));
      } else progressHandler.updateProgress(progress);
    }, 500);
    this.activeRequests.set(`${loadingKey}_progress`, progressInterval);
  }
  getStageMessage(stage) {
    const messages = { connecting: 'Connecting to server...', authenticating: 'Authenticating...', fetching: 'Fetching data...', processing: 'Processing results...', formatting: 'Formatting data...', finalizing: 'Almost done...', querying: 'Running query...', validating: 'Validating data...', parsing: 'Parsing response...' };
    return messages[stage] || `${stage.charAt(0).toUpperCase() + stage.slice(1)}...`;
  }
  getErrorMessage(status, errorData, context) {
    const baseContext = context ? ` while ${context}` : '';
    switch (status) {
      case 400: return errorData.message || `Bad request${baseContext}. Please check your input.`;
      case 401: return `Authentication failed${baseContext}. Please check your credentials.`;
      case 403: return `Access denied${baseContext}. You don't have permission for this action.`;
      case 404: return `Resource not found${baseContext}. The requested data may have been moved or deleted.`;
      case 429: return `Too many requests${baseContext}. Please wait a moment and try again.`;
      case 500: return `Server error${baseContext}. Please try again in a moment.`;
      case 502: case 503: case 504: return `Service temporarily unavailable${baseContext}. Please try again later.`;
      default: return errorData.message || errorData.error || `Request failed${baseContext}`;
    }
  }
  transformError(error, context) {
    if (error.message && error.message.includes('fetch')) {
      if (error.message.includes('timeout')) return new Error(`The request timed out${context ? ` while ${context}` : ''}. Please check your connection and try again.`);
      if (error.message.includes('network')) return new Error(`Network error${context ? ` while ${context}` : ''}. Please check your internet connection.`);
    }
    return error;
  }
  cancelRequest(requestId) {
    const c = this.activeRequests.get(requestId);
    if (c) { if (c.abort) c.abort(); else clearInterval(c); this.activeRequests.delete(requestId); }
  }
  cancelAllRequests() {
    this.activeRequests.forEach((c) => { if (c.abort) c.abort(); else clearInterval(c); });
    this.activeRequests.clear();
  }
}

export const apiService = new ApiService();
