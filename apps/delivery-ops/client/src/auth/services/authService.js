import { getApiBase } from '../../utils/api';

/**
 * Clean Authentication Service
 * 
 * Handles JIRA-based authentication with the following flow:
 * 1. User provides username and JIRA token
 * 2. Server validates token against JIRA API (/rest/api/2/myself)
 * 3. Server returns user info and permissions
 * 4. Client stores credentials and manages auth state
 * 
 * Key methods:
 * - login(username, jiraToken) - Primary authentication
 * - testConnectionAndRefreshPermissions() - Test connection + refresh permissions
 * - checkAuth() - Check if user is authenticated
 * - clearAuth() - Clear all auth data
 * 
 * Removed redundant methods:
 * - validateCredentials() -> use login() directly
 * - testJiraConnection() -> use testConnectionAndRefreshPermissions()
 */
class AuthService {
  constructor() {
    this.apiBase = getApiBase();
  }

  // Check if user is currently authenticated
  checkAuth() {
    // Try v1 credential migration first
    this.migrateV1Credentials();
    
    const storedUsername = localStorage.getItem('username') || localStorage.getItem('userEmail');
    const jiraToken = localStorage.getItem('jiraToken');
    return !!(storedUsername && jiraToken);
  }

  // Auto-login with stored credentials (for seamless v2 experience)
  async autoLogin() {
    if (!this.checkAuth()) {
      return false;
    }

    const storedUsername = localStorage.getItem('username') || localStorage.getItem('userEmail');
    const jiraToken = localStorage.getItem('jiraToken');
    const normalizedUsername = this.normalizeUsername(storedUsername);

    try {
      // Validate stored credentials and refresh permissions silently
      const response = await fetch(`${this.apiBase}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: normalizedUsername,
          jiraToken
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Update cached permissions with fresh data
          localStorage.setItem('userPermissions', JSON.stringify(data.permissions || []));
          localStorage.setItem('userRoles', JSON.stringify(data.roles || []));
          localStorage.setItem('permissionsCacheTime', Date.now().toString());
          
          return {
            success: true,
            user: data.user,
            permissions: data.permissions,
            roles: data.roles,
            silentLogin: true
          };
        }
      }
      
      // If validation fails, clear invalid credentials
      this.clearAuth();
      return false;
    } catch (error) {
      console.warn('Auto-login failed, will require manual login:', error.message);
      // Don't clear auth on network errors - might be temporary
      return false;
    }
  }

  // Test JIRA connection and refresh permissions - dual-purpose for better UX
  async testConnectionAndRefreshPermissions() {
    const jiraToken = localStorage.getItem('jiraToken');
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail');
    
    if (!jiraToken || !username) {
      throw new Error('JIRA token or username not found. Please log out and log back in.');
    }

    const normalizedUsername = this.normalizeUsername(username);

    // Use the comprehensive login endpoint for both connection test AND permission refresh
    // This provides better UX by doing both operations in a single user action
    const response = await fetch(`${this.apiBase}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: normalizedUsername,
        jiraToken
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Fix: Properly extract user-friendly message from structured error response
      let errorMessage = 'Connection test failed';
      if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.error) {
        // Handle structured error objects from JIRA API
        if (typeof errorData.error === 'object' && errorData.error.userMessage) {
          errorMessage = errorData.error.userMessage;
        } else if (typeof errorData.error === 'object' && errorData.error.description) {
          errorMessage = errorData.error.description;
        } else if (typeof errorData.error === 'string') {
          errorMessage = errorData.error;
        }
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (data.success) {
      // Update cached permissions with fresh data from server
      localStorage.setItem('userPermissions', JSON.stringify(data.permissions || []));
      localStorage.setItem('userRoles', JSON.stringify(data.roles || []));
      localStorage.setItem('permissionsCacheTime', Date.now().toString());
      
      return {
        success: true,
        message: `✅ Connected as ${data.user.displayName || data.user.username}`,
        username: data.user.username,
        displayName: data.user.displayName,
        // Return refreshed permissions so UI can update immediately
        permissions: data.permissions,
        roles: data.roles,
        permissionsRefreshed: true
      };
    } else {
      throw new Error(data.message || 'Connection test failed');
    }
  }

  // Removed legacy testJiraConnection - use testConnectionAndRefreshPermissions() directly

  // Comprehensive login that validates credentials and fetches permissions in single call
  async login(username, jiraToken) {
    
    if (!jiraToken) {
      throw new Error('JIRA token is required');
    }

    // If username is not provided, server will extract it from JIRA token
    const requestBody = { jiraToken };
    if (username) {
      requestBody.username = this.normalizeUsername(username);
    }

    const response = await fetch(`${this.apiBase}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Fix: Properly extract user-friendly message from structured error response
      let errorMessage = 'Login failed';
      if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.error) {
        // Handle structured error objects from JIRA API
        if (typeof errorData.error === 'object' && errorData.error.userMessage) {
          errorMessage = errorData.error.userMessage;
        } else if (typeof errorData.error === 'object' && errorData.error.description) {
          errorMessage = errorData.error.description;
        } else if (typeof errorData.error === 'string') {
          errorMessage = errorData.error;
        }
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (data.success) {
      // Store credentials using info from server response
      const serverUsername = data.user.username;
      localStorage.setItem('username', serverUsername);
      localStorage.setItem('userEmail', data.user.email);
      localStorage.setItem('jiraToken', jiraToken);
      
      // Cache permissions to avoid future API calls
      localStorage.setItem('userPermissions', JSON.stringify(data.permissions || []));
      localStorage.setItem('userRoles', JSON.stringify(data.roles || []));
      localStorage.setItem('permissionsCacheTime', Date.now().toString());
      
      return {
        success: true,
        user: {
          username: serverUsername,
          email: data.user.email,
          displayName: data.user.displayName
        },
        permissions: data.permissions || [],
        roles: data.roles || [],
        isSuperAdmin: !!data.isSuperAdmin,
        isAdmin: !!data.isAdmin
      };
    } else {
      throw new Error(data.message || 'Login failed');
    }
  }

  // Removed redundant validateCredentials - use login() directly

  // Get current user info with cached permissions
  getCurrentUser() {
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail');
    const jiraToken = localStorage.getItem('jiraToken');
    
    if (!username || !jiraToken) {
      return null;
    }

    const normalizedUsername = this.normalizeUsername(username);
    const permissions = this.getCachedPermissions();
    
    return {
      username: normalizedUsername,
      email: `${normalizedUsername}@nutanix.com`,
      hasJiraToken: !!jiraToken,
      ...permissions
    };
  }

  // Get cached permissions if they're still valid
  getCachedPermissions() {
    try {
      const permissions = JSON.parse(localStorage.getItem('userPermissions') || '[]');
      const roles = JSON.parse(localStorage.getItem('userRoles') || '[]');
      const cacheTime = parseInt(localStorage.getItem('permissionsCacheTime') || '0');
      
      // Cache is valid for 24 hours
      const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      const isValid = cacheTime && (Date.now() - cacheTime < CACHE_DURATION);
      
      if (isValid) {
        return {
          permissions,
          roles,
          isCached: true
        };
      }
    } catch (error) {
      console.warn('Failed to parse cached permissions:', error);
    }
    
    return {
      permissions: [],
      roles: [],
      isCached: false
    };
  }

  // Check if permissions need refresh
  shouldRefreshPermissions() {
    const cacheTime = parseInt(localStorage.getItem('permissionsCacheTime') || '0');
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    return !cacheTime || (Date.now() - cacheTime >= CACHE_DURATION);
  }

  // Normalize username
  normalizeUsername(input) {
    if (!input) return '';
    const trimmed = String(input).trim().toLowerCase();
    if (trimmed.includes('@')) {
      return trimmed.split('@')[0];
    }
    return trimmed;
  }

  // Migrate from v1 credentials if they exist
  migrateV1Credentials() {
    // Check for old v1 credential keys and migrate them
    const oldKeys = ['auth_username', 'auth_token', 'user_name', 'jira_token'];
    let migrated = false;

    oldKeys.forEach(oldKey => {
      const oldValue = localStorage.getItem(oldKey);
      if (oldValue) {
        if (oldKey.includes('username') || oldKey.includes('user_name')) {
          if (!localStorage.getItem('username')) {
            localStorage.setItem('username', oldValue);
            localStorage.setItem('userEmail', `${oldValue}@nutanix.com`);
            migrated = true;
          }
        } else if (oldKey.includes('token')) {
          if (!localStorage.getItem('jiraToken')) {
            localStorage.setItem('jiraToken', oldValue);
            migrated = true;
          }
        }
        // Clean up old keys
        localStorage.removeItem(oldKey);
      }
    });

    if (migrated) {
      console.log('✅ Migrated v1 credentials to v2 format');
    }

    return migrated;
  }

  // Clear authentication data and cached permissions
  clearAuth() {
    // Clear v2 keys
    localStorage.removeItem('username');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('jiraToken');
    localStorage.removeItem('userPermissions');
    localStorage.removeItem('userRoles');
    localStorage.removeItem('permissionsCacheTime');

    // Clear any potential v1 legacy keys
    const legacyKeys = ['auth_username', 'auth_token', 'user_name', 'jira_token'];
    legacyKeys.forEach(key => localStorage.removeItem(key));
  }
}

export const authService = new AuthService();