import { useState, useCallback, useEffect } from 'react';
import { releaseService } from '../services/releaseService';
import { useNotifications } from '../../shared/services/notificationService';

export const useReleaseData = (initialVersion = null, options = {}) => {
  const { autoFetch = true, enableCache = true } = options;
  
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(initialVersion);
  const [releaseItems, setReleaseItems] = useState([]);
  const [checkpointHistory, setCheckpointHistory] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { error: showError } = useNotifications();

  // Fetch all release versions
  const fetchVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await releaseService.getReleaseVersions({
        loadingKey: 'fetch_versions',
        useCache: enableCache
      });
      
      if (result.success) {
        setVersions(result.versions || []);
        
        // Set default version if none selected
        if (!selectedVersion && result.versions?.length > 0) {
          setSelectedVersion(result.versions[0].name);
        }
      } else {
        throw new Error(result.message || 'Failed to fetch versions');
      }
    } catch (err) {
      console.error('Failed to fetch versions:', err);
      setError(err.message);
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedVersion, enableCache, showError]);

  // Fetch release items for selected version
  const fetchReleaseItems = useCallback(async (version = selectedVersion, labels = []) => {
    if (!version) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await releaseService.getReleaseItems(version, labels, {
        loadingKey: 'fetch_release_items',
        useCache: enableCache
      });
      
      if (result.success) {
        setReleaseItems(result.items || []);
      } else {
        throw new Error(result.message || 'Failed to fetch release items');
      }
    } catch (err) {
      console.error('Failed to fetch release items:', err);
      setError(err.message);
      showError(err.message);
      setReleaseItems([]);
    } finally {
      setLoading(false);
    }
  }, [selectedVersion, enableCache, showError]);

  // Fetch checkpoint history
  const fetchCheckpointHistory = useCallback(async (version = selectedVersion) => {
    if (!version) return;
    
    try {
      const result = await releaseService.getCheckpointHistory(version, {
        loadingKey: 'fetch_checkpoint_history',
        useCache: enableCache
      });
      
      if (result.success) {
        setCheckpointHistory(result.history || {});
      } else {
        throw new Error(result.message || 'Failed to fetch checkpoint history');
      }
    } catch (err) {
      console.error('Failed to fetch checkpoint history:', err);
      // Don't show error for checkpoint history as it's supplementary data
    }
  }, [selectedVersion, enableCache]);

  // Change selected version
  const changeVersion = useCallback(async (newVersion) => {
    if (newVersion === selectedVersion) return;
    
    setSelectedVersion(newVersion);
    
    // Fetch data for new version
    if (newVersion) {
      await Promise.all([
        fetchReleaseItems(newVersion),
        fetchCheckpointHistory(newVersion)
      ]);
    }
  }, [selectedVersion, fetchReleaseItems, fetchCheckpointHistory]);

  // Refresh current data
  const refresh = useCallback(async () => {
    if (selectedVersion) {
      await Promise.all([
        fetchReleaseItems(),
        fetchCheckpointHistory()
      ]);
    }
  }, [selectedVersion, fetchReleaseItems, fetchCheckpointHistory]);

  // Clear cache
  const clearCache = useCallback((pattern = null) => {
    releaseService.clearCache(pattern);
  }, []);

  // Auto-fetch versions on mount
  useEffect(() => {
    if (autoFetch) {
      fetchVersions();
    }
  }, [autoFetch]); // Only run on mount

  // Auto-fetch items when version changes
  useEffect(() => {
    if (selectedVersion && autoFetch) {
      fetchReleaseItems();
      fetchCheckpointHistory();
    }
  }, [selectedVersion, autoFetch]); // Only run when selectedVersion changes

  return {
    // Data
    versions,
    selectedVersion,
    releaseItems,
    checkpointHistory,
    loading,
    error,
    
    // Actions
    fetchVersions,
    fetchReleaseItems,
    fetchCheckpointHistory,
    changeVersion,
    refresh,
    clearCache,
    
    // Computed properties
    hasVersions: versions.length > 0,
    hasItems: releaseItems.length > 0,
    currentVersionData: versions.find(v => v.name === selectedVersion),
    
    // Cache info
    cacheStats: releaseService.getCacheStats()
  };
};