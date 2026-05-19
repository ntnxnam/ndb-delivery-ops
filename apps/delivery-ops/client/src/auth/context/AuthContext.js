import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';

const AuthContext = createContext(null);

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    // Check auth synchronously on initial render
    return authService.checkAuth();
  });
  
  // Initialize user data from cache if available
  const [user, setUser] = useState(() => {
    const currentUser = authService.getCurrentUser();
    return currentUser ? {
      username: currentUser.username,
      email: currentUser.email
    } : null;
  });
  
  const [userPermissions, setUserPermissions] = useState(() => {
    const cached = authService.getCachedPermissions();
    return cached.isCached ? cached.permissions : [];
  });
  
  const [userRoles, setUserRoles] = useState(() => {
    const cached = authService.getCachedPermissions();
    return cached.isCached ? cached.roles : [];
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Normalize username helper
  const normalizeUsername = useCallback((input) => {
    if (!input) return '';
    const trimmed = String(input).trim().toLowerCase();
    if (trimmed.includes('@')) {
      return trimmed.split('@')[0];
    }
    return trimmed;
  }, []);

  // Auto-login on app startup for seamless v2 experience
  useEffect(() => {
    const attemptAutoLogin = async () => {
      // Only try auto-login if we have stored credentials but no current auth state
      if (authService.checkAuth() && !user) {
        setLoading(true);
        
        try {
          const autoLoginResult = await authService.autoLogin();
          
          if (autoLoginResult && autoLoginResult.success) {
            setIsAuthenticated(true);
            setUser(autoLoginResult.user);
            setUserPermissions(autoLoginResult.permissions);
            setUserRoles(autoLoginResult.roles);
            console.log(`✅ Auto-login successful for ${autoLoginResult.user.username}`);
          }
        } catch (error) {
          console.warn('Auto-login failed:', error.message);
          // Don't show error to user - they'll just see login form
        } finally {
          setLoading(false);
        }
      }
    };

    attemptAutoLogin();
  }, [user]); // Include user dependency for ESLint

  // Load user data and permissions (with caching)
  const loadUserData = useCallback(async () => {
    if (!isAuthenticated) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const currentUser = authService.getCurrentUser();
      
      if (currentUser) {
        setUser({
          username: currentUser.username,
          email: currentUser.email
        });
        
        // Use cached permissions - refresh is now handled via Test Connection button
        setUserPermissions(currentUser.permissions || []);
        setUserRoles(currentUser.roles || []);
        
        if (currentUser.isCached) {
          console.log('✅ Using cached permissions');
        } else if (authService.shouldRefreshPermissions()) {
          console.log('⚠️  Permissions cache is stale. Use "Test Connection & Refresh Permissions" to update.');
        }
      }
    } catch (err) {
      console.error('Failed to load user data:', err);
      setError(err.message);
      // Don't log out on permission fetch failure - user is still authenticated
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Load user data when authentication state changes
  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  const login = useCallback(async (username, jiraToken) => {
    
    setLoading(true);
    setError(null);
    
    try {
      // Use the comprehensive login API that validates credentials and fetches permissions
      const loginResult = await authService.login(username, jiraToken);
      
      if (loginResult.success) {
        setIsAuthenticated(true);
        setUser(loginResult.user);
        setUserPermissions(loginResult.permissions);
        setUserRoles(loginResult.roles);
        
        console.log(`✅ Login successful with ${loginResult.permissions.length} permissions loaded`);
        return true;
      } else {
        throw new Error('Login failed');
      }
    } catch (err) {
      
      console.error('Login failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Use authService to clear all authentication data and cached permissions
    authService.clearAuth();
    
    setIsAuthenticated(false);
    setUser(null);
    setUserPermissions([]);
    setUserRoles([]);
    setError(null);
  }, []);

  // Test connection and refresh permissions in one action - better UX pattern
  const testConnectionAndRefreshPermissions = useCallback(async () => {
    if (!user?.username) {
      throw new Error('No user logged in');
    }
    
    try {
      setLoading(true);
      setError(null);
      
      // Use the dual-purpose method that tests connection AND refreshes permissions
      const result = await authService.testConnectionAndRefreshPermissions();
      
      if (result.permissionsRefreshed) {
        // Update UI state with fresh permissions
        setUserPermissions(result.permissions || []);
        setUserRoles(result.roles || []);
      }
      
      return {
        success: true,
        message: result.message,
        permissionsRefreshed: result.permissionsRefreshed
      };
    } catch (err) {
      console.error('Connection test or permission refresh failed:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [user?.username]);

  // Legacy method for backward compatibility - now uses the enhanced dual-purpose method
  const refreshPermissions = useCallback(async () => {
    return await testConnectionAndRefreshPermissions();
  }, [testConnectionAndRefreshPermissions]);

  const value = {
    // Auth state
    isAuthenticated,
    user,
    loading,
    error,
    
    // Permissions
    userPermissions,
    userRoles,
    
    // Actions
    login,
    logout,
    refreshPermissions,
    testConnectionAndRefreshPermissions, // Enhanced dual-purpose method
    
    // Utilities
    normalizeUsername
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};