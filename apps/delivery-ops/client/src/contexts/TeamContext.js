import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getApiBase, getAuthHeaders } from '../utils/api';

const TeamContext = createContext(null);

/**
 * Hook to access team context
 * Must be used within TeamProvider
 */
export const useTeam = () => {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error('useTeam must be used within TeamProvider');
  }
  return context;
};

/**
 * Team context provider that manages team selection and ensures all pages
 * work in the context of the selected team
 */
export const TeamProvider = ({ children }) => {
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(() => 
    localStorage.getItem('releaseVersionSelectedTeamId') || ''
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // Track active API requests to cancel them on team change
  const activeRequestsRef = useRef(new Set());
  const teamChangeCallbacksRef = useRef(new Set());

  /**
   * Register a callback to be called when team changes
   * Useful for components to cleanup their state
   */
  const registerTeamChangeCallback = useCallback((callback) => {
    teamChangeCallbacksRef.current.add(callback);
    return () => teamChangeCallbacksRef.current.delete(callback);
  }, []);

  /**
   * Clear all team-specific cached data and state
   */
  const clearTeamData = useCallback(() => {
    // Clear version selections and other team-specific cache
    localStorage.removeItem('selectedVersion');
    
    // Cancel active API requests
    activeRequestsRef.current.forEach(controller => {
      if (controller && typeof controller.abort === 'function') {
        controller.abort();
      }
    });
    activeRequestsRef.current.clear();

    // Notify all registered components to clear their state
    teamChangeCallbacksRef.current.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in team change callback:', error);
      }
    });

    console.log('[TeamContext] Cleared team-specific data and cancelled active requests');
  }, []);

  /**
   * Change the selected team with proper cleanup
   */
  const changeTeam = useCallback((newTeamId) => {
    if (newTeamId === selectedTeamId) {
      return; // No change needed
    }

    console.log(`[TeamContext] Changing team from ${selectedTeamId} to ${newTeamId}`);
    
    setIsTransitioning(true);
    
    // Clear all team-specific data first
    clearTeamData();
    
    // Update team selection
    setSelectedTeamId(newTeamId);
    localStorage.setItem('releaseVersionSelectedTeamId', newTeamId || '');
    
    // Dispatch custom event for any components listening
    window.dispatchEvent(new CustomEvent('teamChanged', { 
      detail: { 
        previousTeamId: selectedTeamId,
        newTeamId: newTeamId,
        timestamp: Date.now()
      } 
    }));

    // Clear transition state after a short delay to allow components to update
    setTimeout(() => setIsTransitioning(false), 100);
  }, [selectedTeamId, clearTeamData]);

  /**
   * Register an AbortController for team-aware API calls
   */
  const registerApiRequest = useCallback((controller) => {
    if (controller && typeof controller.abort === 'function') {
      activeRequestsRef.current.add(controller);
      return () => activeRequestsRef.current.delete(controller);
    }
    return () => {};
  }, []);

  /**
   * Get the currently selected team object
   */
  const selectedTeam = teams.find(team => team.id === selectedTeamId) || null;

  /**
   * A stored team id counts as selected even if the teams list has not
   * loaded yet — otherwise a failed /api/config/teams fetch hides every
   * page that gates on hasTeamSelected, with no picker to recover.
   */
  const hasTeamSelected = Boolean(selectedTeamId);

  /**
   * Fetch teams configuration from API
   */
  const fetchTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      
      console.log('[TeamContext] Fetching teams from API...');
      console.log('[TeamContext] API URL:', `${getApiBase()}/api/config/teams`);
      
      const { headers: authHeaders } = getAuthHeaders();
      const response = await fetch(`${getApiBase()}/api/config/teams`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const responseData = await response.json();
      
      console.log('[TeamContext] Teams API response:', responseData);
      
      if (responseData && Array.isArray(responseData.teams)) {
        setTeams(responseData.teams);
        
        // Handle team selection logic
        const stored = localStorage.getItem('releaseVersionSelectedTeamId');
        const defaultId = responseData.defaultTeamId || responseData.teams[0]?.id;
        const teamExists = stored && responseData.teams.some(t => t.id === stored);
        const effective = teamExists ? stored : defaultId;
        
        if (effective) {
          setSelectedTeamId(prev => {
            if (effective !== prev) {
              localStorage.setItem('releaseVersionSelectedTeamId', effective);
              console.log(`[TeamContext] Auto-selected team: ${effective}`);
            }
            return effective;
          });
        }
        
        console.log(`[TeamContext] Loaded ${responseData.teams.length} teams`);
      } else {
        console.error('[TeamContext] Invalid response format:', responseData);
        setError('Invalid teams data received');
      }
    } catch (error) {
      console.error('[TeamContext] Failed to fetch teams config:', error);
      setError('Failed to load teams configuration: ' + (error?.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch teams once on mount
  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  // Listen for storage changes (team selection from other tabs)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'releaseVersionSelectedTeamId' && e.newValue !== selectedTeamId) {
        console.log('[TeamContext] Team changed in another tab');
        changeTeam(e.newValue || '');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [selectedTeamId, changeTeam]);

  // Cleanup on unmount
  useEffect(() => {
    const activeRequests = activeRequestsRef.current;
    const teamChangeCallbacks = teamChangeCallbacksRef.current;
    
    return () => {
      // Cancel any pending requests
      activeRequests.forEach(controller => {
        if (controller && typeof controller.abort === 'function') {
          controller.abort();
        }
      });
      activeRequests.clear();
      teamChangeCallbacks.clear();
    };
  }, []);

  const contextValue = {
    // Team state
    teams,
    selectedTeamId,
    selectedTeam,
    hasTeamSelected,
    loading,
    error,
    isTransitioning,
    
    // Actions
    changeTeam,
    fetchTeams,
    clearTeamData,
    
    // Utilities for components
    registerTeamChangeCallback,
    registerApiRequest,
    
    // Computed values
    showTeamSelector: true
  };

  return (
    <TeamContext.Provider value={contextValue}>
      {children}
    </TeamContext.Provider>
  );
};

export default TeamContext;