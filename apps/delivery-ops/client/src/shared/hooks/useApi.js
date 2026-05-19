import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/apiService';
import { useLoading } from './useLoading';

export const useApi = (url, options = {}) => {
  const {
    method = 'GET',
    body = null,
    headers = {},
    autoFetch = false,
    loadingKey = null,
    onProgress: _onProgress = null,
    errorContext = '',
    estimatedTime = null,
    stages = []
  } = options;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);
  const { startLoading, updateProgress, stopLoading, setLoadingError, isLoading } = useLoading();

  const execute = useCallback(async (overrideOptions = {}) => {
    const finalOptions = { ...options, ...overrideOptions };
    const finalLoadingKey = finalOptions.loadingKey || loadingKey || `api_${url.replace(/[^a-zA-Z0-9]/g, '_')}`;

    try {
      setError(null);
      
      // Start loading state
      if (finalLoadingKey) {
        startLoading(finalLoadingKey, {
          message: finalOptions.initialMessage || 'Loading...',
          showProgress: !!finalOptions.estimatedTime,
          canCancel: true,
          estimatedTime: finalOptions.estimatedTime || estimatedTime,
          stage: finalOptions.stages?.[0] || stages[0] || 'connecting'
        });
      }

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      const result = await apiService.request(url, {
        method: finalOptions.method || method,
        body: finalOptions.body || body,
        headers: { ...headers, ...finalOptions.headers },
        signal: abortControllerRef.current.signal,
        loadingKey: finalLoadingKey,
        onProgress: finalLoadingKey ? {
          updateProgress: (progress, stage, message) => {
            updateProgress(finalLoadingKey, progress, stage, message);
          }
        } : null,
        errorContext: finalOptions.errorContext || errorContext,
        estimatedTime: finalOptions.estimatedTime || estimatedTime,
        stages: finalOptions.stages || stages
      });

      setData(result);
      
      if (finalLoadingKey) {
        stopLoading(finalLoadingKey);
      }
      
      return result;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('API request was cancelled');
        return null;
      }
      
      setError(err);
      
      if (finalLoadingKey) {
        setLoadingError(finalLoadingKey, err.message);
        // Don't stop loading immediately on error - let user see the error
        setTimeout(() => stopLoading(finalLoadingKey), 2000);
      }
      
      throw err;
    }
  }, [url, method, body, headers, loadingKey, errorContext, estimatedTime, stages, startLoading, updateProgress, stopLoading, setLoadingError, options]);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    if (loadingKey) {
      stopLoading(loadingKey);
    }
  }, [loadingKey, stopLoading]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      execute();
    }
    
    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [autoFetch, execute]);

  return {
    data,
    error,
    loading: loadingKey ? isLoading(loadingKey) : false,
    execute,
    cancel
  };
};