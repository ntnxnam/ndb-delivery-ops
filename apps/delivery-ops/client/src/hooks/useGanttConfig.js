import { useState, useEffect } from 'react';
import axios from 'axios';

// Shared cache for release versions config to avoid duplicate fetches
// Defined at module level so both hooks can share it
let releaseVersionsConfigCache = null;
let releaseVersionsConfigPromise = null;
let fullConfigCache = null; // Cache the full config including sprintDates

/**
 * Custom hook for managing Gantt chart configuration
 * @param {string} selectedVersion - Selected release version
 * @returns {object} - { ganttConfig, sprintDates, loadingGanttConfig }
 */
export function useGanttConfig(selectedVersion) {
  const [ganttConfig, setGanttConfig] = useState(null);
  const [sprintDates, setSprintDates] = useState([]);
  const [loadingGanttConfig, setLoadingGanttConfig] = useState(false);

  useEffect(() => {
    const fetchGanttConfig = async () => {
      if (!selectedVersion) {
        setGanttConfig(null);
        setSprintDates([]);
        return;
      }

      setLoadingGanttConfig(true);
      try {
        // Use cached config if available, otherwise fetch
        let configData;
        if (fullConfigCache) {
          configData = fullConfigCache;
        } else if (releaseVersionsConfigPromise) {
          const response = await releaseVersionsConfigPromise;
          configData = response.data;
          fullConfigCache = response.data; // Cache the full response
          if (response.data?.releaseGateDates) {
            releaseVersionsConfigCache = response.data.releaseGateDates;
          }
        } else {
          releaseVersionsConfigPromise = axios.get('/api/config/release-versions');
          const response = await releaseVersionsConfigPromise;
          configData = response.data;
          fullConfigCache = response.data; // Cache the full response
          if (response.data?.releaseGateDates) {
            releaseVersionsConfigCache = response.data.releaseGateDates;
          }
        }
        
        if (configData) {
          // Set sprint dates from config
          if (configData.sprintDates && Array.isArray(configData.sprintDates)) {
            setSprintDates(configData.sprintDates.map(date => new Date(date)));
          } else {
            setSprintDates([]);
          }
          
          // Set version-specific config
          if (configData.releaseGateDates) {
            const versionConfig = configData.releaseGateDates[selectedVersion];
            
            if (versionConfig) {
              setGanttConfig(versionConfig);
            } else {
              setGanttConfig(null);
            }
          } else {
            setGanttConfig(null);
          }
        } else {
          setGanttConfig(null);
          setSprintDates([]);
        }
      } catch (error) {
        console.error('Error fetching Gantt config:', error);
        releaseVersionsConfigPromise = null; // Allow retry on failure
        setGanttConfig(null);
        setSprintDates([]);
      } finally {
        setLoadingGanttConfig(false);
      }
    };

    fetchGanttConfig();
  }, [selectedVersion]);

  return {
    ganttConfig,
    sprintDates,
    loadingGanttConfig
  };
}

/**
 * Custom hook for getting all release versions config (for dynamic base calculation)
 * Uses a shared cache to avoid duplicate fetches
 * @returns {object} - { allVersionsConfig, loadingAllVersions }
 */
export function useAllVersionsConfig() {
  const [allVersionsConfig, setAllVersionsConfig] = useState(releaseVersionsConfigCache);
  const [loadingAllVersions, setLoadingAllVersions] = useState(false);

  useEffect(() => {
    // If we already have cached data, use it
    if (releaseVersionsConfigCache) {
      setAllVersionsConfig(releaseVersionsConfigCache);
      return;
    }

    if (releaseVersionsConfigPromise) {
      releaseVersionsConfigPromise.then(response => {
        const data = response.data?.releaseGateDates;
        if (data) {
          releaseVersionsConfigCache = data;
          setAllVersionsConfig(data);
        }
        setLoadingAllVersions(false);
      }).catch(() => {
        setLoadingAllVersions(false);
      });
      return;
    }

    // Start new fetch
    const fetchAllVersions = async () => {
      setLoadingAllVersions(true);
      try {
        releaseVersionsConfigPromise = axios.get('/api/config/release-versions');
        const response = await releaseVersionsConfigPromise;
        if (response.data?.releaseGateDates) {
          releaseVersionsConfigCache = response.data.releaseGateDates;
          fullConfigCache = response.data; // Cache full response
          setAllVersionsConfig(releaseVersionsConfigCache);
        }
      } catch (error) {
        console.error('Error fetching all versions config:', error);
        releaseVersionsConfigPromise = null; // Allow retry on failure
        setAllVersionsConfig(null);
      } finally {
        setLoadingAllVersions(false);
      }
    };

    fetchAllVersions();
  }, []);

  return {
    allVersionsConfig,
    loadingAllVersions
  };
}

