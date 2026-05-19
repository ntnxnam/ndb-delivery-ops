import { useState, useCallback } from 'react';

export const useLoading = () => {
  const [loadingStates, setLoadingStates] = useState({});

  const startLoading = useCallback((key, config = {}) => {
    setLoadingStates(prev => ({
      ...prev,
      [key]: {
        isLoading: true,
        startTime: Date.now(),
        message: config.message || 'Loading...',
        showProgress: config.showProgress || false,
        progress: 0,
        canCancel: config.canCancel || false,
        estimatedTime: config.estimatedTime,
        stage: config.stage || 'initializing',
        error: null
      }
    }));
  }, []);

  const updateProgress = useCallback((key, progress, stage, message) => {
    setLoadingStates(prev => {
      if (!prev[key]) return prev;
      
      return {
        ...prev,
        [key]: {
          ...prev[key],
          progress: Math.min(Math.max(progress, 0), 100),
          stage: stage || prev[key].stage,
          message: message || prev[key].message
        }
      };
    });
  }, []);

  const setLoadingError = useCallback((key, error) => {
    setLoadingStates(prev => {
      if (!prev[key]) return prev;
      
      return {
        ...prev,
        [key]: {
          ...prev[key],
          error: error,
          isLoading: false
        }
      };
    });
  }, []);

  const stopLoading = useCallback((key) => {
    setLoadingStates(prev => {
      const newState = { ...prev };
      delete newState[key];
      return newState;
    });
  }, []);

  const isLoading = useCallback((key) => {
    return loadingStates[key]?.isLoading || false;
  }, [loadingStates]);

  const getLoadingState = useCallback((key) => {
    return loadingStates[key] || null;
  }, [loadingStates]);

  return {
    loadingStates,
    startLoading,
    updateProgress,
    setLoadingError,
    stopLoading,
    isLoading,
    getLoadingState
  };
};