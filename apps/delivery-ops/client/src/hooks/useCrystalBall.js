import { useState, useEffect, useRef } from 'react';
import { authenticatedGet, authenticatedPost } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';
import { useTeam } from '../contexts/TeamContext';

/**
 * Crystal Ball hook for AI-powered release predictions and insights with team context
 */
export function useCrystalBall() {
  const { registerTeamChangeCallback } = useTeam();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [predictions, setPredictions] = useState(null);
  const [trendAnalysis, setTrendAnalysis] = useState(null);
  const [riskForecast, setRiskForecast] = useState(null);
  
  const jiraTokenRef = useRef('');
  const usernameRef = useRef('');

  // Store token and username in refs to avoid re-renders
  useEffect(() => {
    jiraTokenRef.current = localStorage.getItem('jiraToken') || '';
    usernameRef.current = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  }, []);

  // Clear data when team changes
  useEffect(() => {
    const cleanup = registerTeamChangeCallback(() => {
      console.log('[useCrystalBall] Team changed - clearing predictions');
      setPredictions(null);
      setTrendAnalysis(null);
      setRiskForecast(null);
      setError('');
      setLoading(false);
    });
    return cleanup;
  }, [registerTeamChangeCallback]);

  // Check Crystal Ball status
  const checkStatus = async () => {
    try {
      const response = await authenticatedGet('/api/crystalball/status', {
        jiraToken: jiraTokenRef.current,
        username: usernameRef.current
      });

      setStatus(response.data);
      return response.data;
    } catch (error) {
      console.error('Error checking Crystal Ball status:', error);
      setStatus({ success: false, enabled: false, error: error.message });
      return null;
    }
  };

  // Predict release completion
  const predictRelease = async (releaseVersion, teamId, features) => {
    if (!releaseVersion || !teamId || !features) {
      setError('Release version, team ID, and features are required');
      return null;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authenticatedPost('/api/crystalball/predict-release',
        { releaseVersion, teamId, features },
        {
          jiraToken: jiraTokenRef.current,
          username: usernameRef.current
        }
      );

      if (response.data.success) {
        setPredictions(response.data.predictions);
        return response.data.predictions;
      } else {
        setError(response.data.error || 'Prediction failed');
        return null;
      }
    } catch (error) {
      console.error('Error predicting release:', error);
      const errorMessage = getUserFacingMessage(error, {
        context: 'crystalball-prediction',
        fallback: 'Failed to generate release predictions. Please try again.'
      });
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Get trend analysis
  const getTrendAnalysis = async (releaseVersion, teamId, days = 30) => {
    if (!releaseVersion || !teamId) {
      setError('Release version and team ID are required');
      return null;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authenticatedGet(
        `/api/crystalball/trend-analysis?releaseVersion=${encodeURIComponent(releaseVersion)}&teamId=${encodeURIComponent(teamId)}&days=${days}`,
        {
          jiraToken: jiraTokenRef.current,
          username: usernameRef.current
        }
      );

      if (response.data.success) {
        setTrendAnalysis(response.data.analysis);
        return response.data.analysis;
      } else {
        setError(response.data.error || 'Trend analysis failed');
        return null;
      }
    } catch (error) {
      console.error('Error getting trend analysis:', error);
      const errorMessage = getUserFacingMessage(error, {
        context: 'crystalball-trends',
        fallback: 'Failed to generate trend analysis. Please try again.'
      });
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Get risk forecast
  const getRiskForecast = async (releaseVersion, teamId) => {
    if (!releaseVersion || !teamId) {
      setError('Release version and team ID are required');
      return null;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authenticatedGet(
        `/api/crystalball/risk-forecast?releaseVersion=${encodeURIComponent(releaseVersion)}&teamId=${encodeURIComponent(teamId)}`,
        {
          jiraToken: jiraTokenRef.current,
          username: usernameRef.current
        }
      );

      if (response.data.success) {
        setRiskForecast(response.data.forecast);
        return response.data.forecast;
      } else {
        setError(response.data.error || 'Risk forecast failed');
        return null;
      }
    } catch (error) {
      console.error('Error getting risk forecast:', error);
      const errorMessage = getUserFacingMessage(error, {
        context: 'crystalball-risk',
        fallback: 'Failed to generate risk forecast. Please try again.'
      });
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Clear all data
  const clearData = () => {
    setPredictions(null);
    setTrendAnalysis(null);
    setRiskForecast(null);
    setError('');
  };

  // Check if Crystal Ball is available and enabled
  const isEnabled = () => {
    return status?.success && status?.enabled;
  };

  return {
    // State
    status,
    loading,
    error,
    predictions,
    trendAnalysis,
    riskForecast,
    
    // Actions
    checkStatus,
    predictRelease,
    getTrendAnalysis,
    getRiskForecast,
    clearData,
    
    // Utilities
    isEnabled
  };
}