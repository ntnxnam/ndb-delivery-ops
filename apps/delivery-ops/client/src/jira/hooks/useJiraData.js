import { useState, useCallback, useEffect } from 'react';
import { jiraApiService } from '../services/jiraApiService';
import { useNotifications } from '../../shared/services/notificationService';
import { useAuth } from '../../auth/hooks/useAuth';

export const useJiraData = (options = {}) => {
  const { 
    autoConnect = true, 
    enableCache = true,
    cacheInvalidationTime = 5 * 60 * 1000 // 5 minutes
  } = options;
  
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { isAuthenticated, testConnectionAndRefreshPermissions } = useAuth();
  const { success: showSuccess, error: showError } = useNotifications();

  // Test JIRA connection and refresh permissions - dual-purpose for better UX
  const testConnection = useCallback(async () => {
    // #region agent log
    // Removed debug telemetry
    // #endregion
    
    if (!isAuthenticated) {
      setError('User not authenticated');
      return false;
    }

    setLoading(true);
    setError(null);
    
    try {
      // #region agent log
      // Removed debug telemetry
      // #endregion
      
      // Use the enhanced auth method that tests connection AND refreshes permissions
      // This provides better value to users by doing both operations in one action
      const result = await testConnectionAndRefreshPermissions();

      // #region agent log
      // Removed debug telemetry
      // #endregion
      
      if (result.success) {
        setConnectionStatus({
          success: true,
          message: result.permissionsRefreshed 
            ? `${result.message} • Permissions refreshed` 
            : result.message,
          permissionsRefreshed: result.permissionsRefreshed
        });
        setIsConnected(true);
        
        // Show enhanced success message when permissions are refreshed
        const successMsg = result.permissionsRefreshed 
          ? 'JIRA connection successful • Permissions updated'
          : 'JIRA connection successful';
        showSuccess(successMsg);
        
        return true;
      } else {
        throw new Error(result.message || 'Connection test failed');
      }
    } catch (err) {
      console.error('JIRA connection test or permission refresh failed:', err);
      
      // #region agent log
      // Removed debug telemetry
      // #endregion
      
      // Fix: Ensure we always pass a proper string message, never an object
      const errorMessage = err?.message || err?.error || (typeof err === 'string' ? err : 'Connection test failed');
      
      // #region agent log
      // Removed debug telemetry
      // #endregion
      
      setConnectionStatus({
        success: false,
        message: errorMessage
      });
      setIsConnected(false);
      setError(errorMessage);
      showError(errorMessage);
      return false;
    } finally {
      setLoading(false);
      
      // Clear status after 5 seconds
      setTimeout(() => setConnectionStatus(null), 5000);
    }
  }, [isAuthenticated, testConnectionAndRefreshPermissions, showSuccess, showError]);

  // Validate JIRA ticket
  const validateTicket = useCallback(async (jiraKey) => {
    if (!jiraKey) {
      throw new Error('JIRA key is required');
    }

    try {
      const result = await jiraApiService.validateTicket(jiraKey, {
        loadingKey: 'jira_validate_ticket',
        useCache: enableCache
      });
      
      if (result.success) {
        return result;
      } else {
        throw new Error(result.message || 'Ticket validation failed');
      }
    } catch (err) {
      console.error('JIRA ticket validation failed:', err);
      throw err;
    }
  }, [enableCache]);

  // Fetch JIRA ticket data
  const fetchTicket = useCallback(async (jiraKey) => {
    if (!jiraKey) {
      throw new Error('JIRA key is required');
    }

    try {
      const result = await jiraApiService.fetchTicket(jiraKey, {
        loadingKey: 'jira_fetch_ticket',
        useCache: enableCache
      });
      
      if (result.success) {
        return result;
      } else {
        throw new Error(result.message || 'Failed to fetch ticket data');
      }
    } catch (err) {
      console.error('JIRA ticket fetch failed:', err);
      throw err;
    }
  }, [enableCache]);

  // Search issues by JQL
  const searchByJql = useCallback(async (jql, searchOptions = {}) => {
    if (!jql) {
      throw new Error('JQL query is required');
    }

    try {
      const result = await jiraApiService.searchByJql(jql, {
        loadingKey: 'jira_jql_search',
        useCache: enableCache,
        ...searchOptions
      });
      
      if (result.success) {
        return result;
      } else {
        throw new Error(result.message || 'JQL search failed');
      }
    } catch (err) {
      console.error('JIRA JQL search failed:', err);
      throw err;
    }
  }, [enableCache]);

  // Fetch epics for a ticket
  const fetchEpics = useCallback(async (jiraKey) => {
    if (!jiraKey) {
      throw new Error('JIRA key is required');
    }

    try {
      const result = await jiraApiService.fetchEpics(jiraKey, {
        loadingKey: 'jira_fetch_epics',
        useCache: enableCache
      });
      
      if (result.success) {
        return result;
      } else {
        throw new Error(result.message || 'Failed to fetch epics');
      }
    } catch (err) {
      console.error('JIRA epics fetch failed:', err);
      throw err;
    }
  }, [enableCache]);

  // Get issue breakdown
  const getIssueBreakdown = useCallback(async (jiraKey) => {
    if (!jiraKey) {
      throw new Error('JIRA key is required');
    }

    try {
      const result = await jiraApiService.getIssueBreakdown(jiraKey, {
        loadingKey: 'jira_issue_breakdown',
        useCache: enableCache
      });
      
      if (result.success) {
        return result;
      } else {
        throw new Error(result.message || 'Failed to get issue breakdown');
      }
    } catch (err) {
      console.error('JIRA issue breakdown failed:', err);
      throw err;
    }
  }, [enableCache]);

  // Clear cache
  const clearCache = useCallback((pattern = null) => {
    jiraApiService.clearCache(pattern);
    showSuccess('JIRA cache cleared');
  }, [showSuccess]);

  // Get cache statistics
  const getCacheStats = useCallback(() => {
    return jiraApiService.getCacheStats();
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect && isAuthenticated) {
      testConnection();
    }
  }, [autoConnect, isAuthenticated]); // Only run when auth status changes

  return {
    // Connection state
    isConnected,
    connectionStatus,
    loading,
    error,
    
    // Connection actions
    testConnection,
    
    // Data fetching
    validateTicket,
    fetchTicket,
    searchByJql,
    fetchEpics,
    getIssueBreakdown,
    
    // Cache management
    clearCache,
    getCacheStats,
    
    // Computed properties
    canFetch: isAuthenticated && isConnected
  };
};