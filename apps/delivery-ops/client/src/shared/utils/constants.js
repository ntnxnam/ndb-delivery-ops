// Application-wide constants

// API Configuration
export const API_CONFIG = {
  TIMEOUT: 30000, // 30 seconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second
};

// Loading States
export const LOADING_STATES = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error'
};

// Notification Types
export const NOTIFICATION_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

// Date Formats
export const DATE_FORMATS = {
  DISPLAY: 'dd/mmm/yyyy',
  ISO: 'yyyy-mm-dd',
  US: 'mm/dd/yyyy',
  RELATIVE: 'relative'
};

// JIRA Configuration
export const JIRA_CONFIG = {
  MAX_RESULTS: 500,
  DEFAULT_PAGE_SIZE: 50,
  VALID_OPERATORS: ['=', '!=', '~', '!~', '>', '>=', '<', '<=', 'IN', 'NOT IN', 'IS', 'IS NOT', 'WAS', 'WAS IN', 'WAS NOT', 'CHANGED'],
  COMMON_FIELDS: [
    'project', 'key', 'summary', 'status', 'assignee', 'reporter', 
    'created', 'updated', 'component', 'fixVersion', 'labels', 
    'priority', 'issuetype', 'resolution', 'description'
  ]
};

// Email Configuration
export const EMAIL_CONFIG = {
  MAX_RECIPIENTS: 100,
  MAX_SUBJECT_LENGTH: 200,
  MAX_BODY_LENGTH: 50000,
  NUTANIX_DOMAIN: '@nutanix.com'
};

// File Upload Configuration
export const FILE_CONFIG = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'],
  MAX_FILES: 5
};

// Pagination
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  MAX_PAGE_SIZE: 100
};

// Routes
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  EMAIL_SENDER: '/',
  RELEASE_VERSIONS: '/all-status',
  RELEASE_TRENDS: '/release-trends',
  RELEASE_SETUP: '/release-setup',
  GENERIC_EMAILER: '/generic-emailer',
  EMAIL_HISTORY: '/email-history',
  SPRINT_REPORT: '/sprint-report',
  KPI: '/kpis',
  ADMIN: '/admin'
};

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Progress Stages
export const PROGRESS_STAGES = {
  EMAIL: ['connecting', 'authenticating', 'composing', 'sending', 'finalizing'],
  JIRA: ['connecting', 'authenticating', 'querying', 'processing', 'formatting'],
  CONFLUENCE: ['connecting', 'authenticating', 'fetching', 'parsing', 'formatting'],
  EXPORT: ['preparing', 'generating', 'formatting', 'finalizing'],
  IMPORT: ['validating', 'parsing', 'processing', 'storing', 'finalizing']
};

// Local Storage Keys
export const STORAGE_KEYS = {
  USERNAME: 'username',
  USER_EMAIL: 'userEmail',
  JIRA_TOKEN: 'jiraToken',
  SELECTED_TEAM: 'releaseVersionSelectedTeamId',
  THEME: 'theme',
  PREFERENCES: 'userPreferences'
};

// Error Messages
export const ERROR_MESSAGES = {
  NETWORK: 'Network error. Please check your connection and try again.',
  TIMEOUT: 'Request timed out. Please try again.',
  UNAUTHORIZED: 'You are not authorized to perform this action.',
  FORBIDDEN: 'Access denied. You don\'t have permission for this action.',
  NOT_FOUND: 'The requested resource was not found.',
  SERVER_ERROR: 'Server error. Please try again later.',
  VALIDATION: 'Please check your input and try again.',
  UNKNOWN: 'An unexpected error occurred. Please try again.'
};

// Success Messages
export const SUCCESS_MESSAGES = {
  EMAIL_SENT: 'Email sent successfully!',
  DATA_SAVED: 'Data saved successfully!',
  DATA_UPDATED: 'Data updated successfully!',
  DATA_DELETED: 'Data deleted successfully!',
  CONNECTION_TEST: 'Connection test successful!',
  LOGIN: 'Login successful!',
  LOGOUT: 'Logged out successfully!'
};

// Theme Configuration
export const THEME = {
  COLORS: {
    PRIMARY: '#007bff',
    SECONDARY: '#6c757d',
    SUCCESS: '#28a745',
    DANGER: '#dc3545',
    WARNING: '#ffc107',
    INFO: '#17a2b8',
    LIGHT: '#f8f9fa',
    DARK: '#343a40'
  },
  BREAKPOINTS: {
    XS: '0px',
    SM: '576px',
    MD: '768px',
    LG: '992px',
    XL: '1200px',
    XXL: '1400px'
  }
};

// Regular Expressions
export const REGEX = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  NUTANIX_EMAIL: /^[^\s@]+@nutanix\.com$/i,
  JIRA_TOKEN: /^[A-Za-z0-9]{20,}$/,
  JIRA_KEY: /^[A-Z][A-Z0-9_]*-\d+$/,
  URL: /^https?:\/\/.+/,
  CONFLUENCE_URL: /^(https?:\/\/confluence\.eng\.nutanix\.com:8443)?\/?(pages\/(viewpage|viewinfo)\.action\?pageId=\d+|spaces\/\w+\/pages\/\d+)/
};

// Environment
export const ENV = {
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test'
};