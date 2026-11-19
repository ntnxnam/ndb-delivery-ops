import { useState, useEffect } from 'react';
import { authenticatedGet } from '../shared/services/apiService';

// Module-level cache so release-versions-columns is only called once per app load
// (avoids duplicate calls under React Strict Mode or when multiple consumers mount)
let columnsConfigCache = null;
let columnsConfigPromise = null;

/**
 * Custom hook for managing column configuration
 * @returns {object} - { columnsConfig, defaultVersion, setDefaultVersion }
 */
export function useColumnConfig() {
  const [columnsConfig, setColumnsConfig] = useState(columnsConfigCache);
  const [defaultVersion, setDefaultVersion] = useState('');

  useEffect(() => {
    const jiraToken = localStorage.getItem('jiraToken');
    if (!jiraToken) {
      return;
    }

    const load = async () => {
      if (columnsConfigCache) {
        setColumnsConfig(columnsConfigCache);
        if (columnsConfigCache.defaultReleaseVersion) {
          setDefaultVersion(columnsConfigCache.defaultReleaseVersion);
        }
        return;
      }
      if (!columnsConfigPromise) {
        columnsConfigPromise = authenticatedGet('/api/config/release-versions-columns')
          .then((res) => {
            columnsConfigCache = res.data;
            return res.data;
          })
          .catch((err) => {
            console.error('[Columns Config] Error loading config:', err?.response?.data || err);
            columnsConfigPromise = null;
            throw err;
          });
      }

      try {
        const data = await columnsConfigPromise;
        setColumnsConfig(data);
        if (data?.defaultReleaseVersion) {
          setDefaultVersion(data.defaultReleaseVersion);
        }
      } catch {
        setColumnsConfig(null);
      }
    };

    load();
  }, []);

  return {
    columnsConfig,
    defaultVersion,
    setDefaultVersion
  };
}

