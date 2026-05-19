/**
 * Release Trends page: select version, click Load release for pie charts; click Load widgets for release KPI widgets.
 * JIRA calls for widgets run only on explicit "Load widgets" click.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip
} from 'recharts';
import { useReleaseVersions, useReleaseItems } from '../hooks';
// Crystal Ball imports preserved for future use
// import { useCrystalBall } from '../hooks/useCrystalBall';
// import ReleaseRiskForecast from './ReleaseRiskForecast';
// import ReleaseDatePrediction from './ReleaseDatePrediction';
// import CrystalBallInsights from './CrystalBallInsights';

import { useTeam } from '../contexts/TeamContext';
import { authenticatedGet, authenticatedPost, getApiBase } from '../utils/api';
import { useTeams } from '../hooks/useTeams';
import { KPIWidgetCard, CARD_STYLES } from './KPIPage';
import CrystalBallIChat from './CrystalBallIChat';
import './ReleaseVersionTab.css';

const API_BASE = getApiBase();

const RISK_COLORS = {
  Green: '#28a745',
  Yellow: '#ffc107',
  Red: '#dc3545',
  'Not Set': '#adb5bd'
};

function getRiskLabel(item) {
  const raw = item && item.customfield_23560;
  if (!raw) return 'Not Set';
  const value = typeof raw === 'object' ? (raw.value || raw.name || '') : String(raw);
  const color = typeof raw === 'object' ? (raw.color || '').toLowerCase() : '';
  const v = (value || '').toLowerCase();
  if (color === '#dc3545' || color === 'red' || v.includes('red') || v.includes('high') || v.includes('critical')) return 'Red';
  if (color === '#ffc107' || color === 'yellow' || v.includes('yellow') || v.includes('medium') || v.includes('at risk')) return 'Yellow';
  if (color === '#28a745' || color === 'green' || v.includes('green') || v.includes('on track') || v.includes('low')) return 'Green';
  return 'Not Set';
}

function buildPieData(items) {
  const counts = { Green: 0, Yellow: 0, Red: 0, 'Not Set': 0 };
  (items || []).forEach((item) => {
    const label = getRiskLabel(item);
    if (counts[label] !== undefined) counts[label]++;
  });
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, value]) => ({ name, value, fill: RISK_COLORS[name] || '#adb5bd' }));
}

export default function ReleaseTrendsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const versionFromUrl = searchParams.get('version') || '';
  
  const { selectedTeamId: teamId, hasTeamSelected, isTransitioning } = useTeam();

  const {
    versions,
    selectedVersion,
    setSelectedVersion,
    loadingVersions,
    fetchVersions,
  } = useReleaseVersions();

  const {
    items,
    loadingItems,
    error: itemsError,
    setError: setItemsError,
    fetchItemsForVersion,
  } = useReleaseItems();

  // Crystal Ball hooks preserved for future use
  /*
  const {
    status: crystalBallStatus,
    loading: crystalBallLoading,
    error: crystalBallError,
    predictions,
    trendAnalysis,
    riskForecast,
    checkStatus,
    predictRelease,
    getTrendAnalysis,
    getRiskForecast,
    clearData,
    isEnabled
  } = useCrystalBall();
  */

  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const [, setTeams] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [kpisLoadError, setKpisLoadError] = useState('');
  const [releaseWidgetResults, setReleaseWidgetResults] = useState(null);
  const [releaseWidgetsLoading, setReleaseWidgetsLoading] = useState(false);
  const [loadingReleaseWidgetId, setLoadingReleaseWidgetId] = useState(null);

  // Executive Summary state
  const [executiveSummary, setExecutiveSummary] = useState(null);
  const [execSummaryLoading, setExecSummaryLoading] = useState(false);
  const [execSummaryError, setExecSummaryError] = useState(null);

  // AI VP Report state
  const [naiApiKey, setNaiApiKey] = useState(localStorage.getItem('nai_api_key') || '');
  const [naiApiKeyName, setNaiApiKeyName] = useState(localStorage.getItem('nai_api_key_name') || '');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [tempApiKeyName, setTempApiKeyName] = useState('');
  const [apiKeyValidating, setApiKeyValidating] = useState(false);
  const [aiVpReportLoading, setAiVpReportLoading] = useState(false);
  const [aiVpReport, setAiVpReport] = useState(null);
  const [aiVpReportError, setAiVpReportError] = useState(null);

  // Determine the effective version to use throughout the component
  const effectiveVersion = versionFromUrl || selectedVersion;


  useEffect(() => {
    if (jiraToken && hasTeamSelected && !versions.length && !isTransitioning) {
      fetchVersions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jiraToken, hasTeamSelected, isTransitioning]);

  // Crystal Ball effects preserved for future use
  /*
  // Check Crystal Ball status on mount
  useEffect(() => {
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
  // Generate Crystal Ball predictions when items are loaded
  useEffect(() => {
    if (items && effectiveVersion && teamId && isEnabled()) {
      const allFeatures = [...(items.commit || []), ...(items.longTermFunded || [])];
      if (allFeatures.length > 0) {
        // Generate predictions
        predictRelease(effectiveVersion, teamId, allFeatures);
        // Generate trend analysis
        getTrendAnalysis(effectiveVersion, teamId, 30);
        // Generate risk forecast
        getRiskForecast(effectiveVersion, teamId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, effectiveVersion, teamId]);
  */

  const { teams: fetchedTeams } = useTeams();

  useEffect(() => {
    if (fetchedTeams.length) setTeams(fetchedTeams);
  }, [fetchedTeams]);

  const fetchKpis = useCallback(async () => {
    if (!teamId || !jiraToken) {
      setKpis([]);
      setKpisLoadError('');
      return;
    }
    setKpisLoadError('');
    try {
      const res = await authenticatedGet(`${API_BASE}/api/config/kpi`, { teamId }, { jiraToken, username });
      setKpis(res.data.kpis || []);
    } catch (err) {
      const apiError = err.response?.data?.error || '';
      const apiMessage = err.response?.data?.message || '';
      const msg = apiMessage || apiError || err.message || '';
      const isNoKpiConfig = apiError === 'Team KPIs not found' || (typeof msg === 'string' && msg.includes('No KPI config'));
      setKpisLoadError(isNoKpiConfig ? 'No KPIs configured for this team. Configure KPIs on the KPIs page.' : msg);
      setKpis([]);
    }
  }, [teamId, jiraToken, username]);

  useEffect(() => {
    fetchKpis();
  }, [fetchKpis]);

  useEffect(() => {
    if (versionFromUrl && versionFromUrl !== selectedVersion) {
      setSelectedVersion(versionFromUrl);
    }
  }, [versionFromUrl, selectedVersion, setSelectedVersion]);

  const fetchReleaseWidgets = useCallback(async () => {
    const version = versionFromUrl || selectedVersion;
    if (!version || !teamId || !kpis.length || !jiraToken) return;
    setReleaseWidgetsLoading(true);
    setReleaseWidgetResults(null);
    try {
      const res = await authenticatedPost(
        `${API_BASE}/api/jira/release-kpi-results-batch`,
        { releaseVersion: version, teamId },
        { jiraToken, username }
      );
      if (res.data && res.data.success && res.data.results) {
        setReleaseWidgetResults(res.data.results);
      } else {
        setReleaseWidgetResults({});
      }
    } catch (e) {
      setReleaseWidgetResults({ _error: e.response?.data?.error || e.message || 'Failed to load widgets' });
    } finally {
      setReleaseWidgetsLoading(false);
    }
  }, [versionFromUrl, selectedVersion, teamId, kpis.length, jiraToken, username]);

  const refreshReleaseWidget = useCallback(async (kpiId) => {
    const version = versionFromUrl || selectedVersion;
    if (!version || !teamId || !kpiId || !jiraToken) return;
    setLoadingReleaseWidgetId(kpiId);
    try {
      const res = await authenticatedPost(
        `${API_BASE}/api/jira/release-kpi-results`,
        { releaseVersion: version, teamId, kpiId },
        { jiraToken, username }
      );
      if (res.data && res.data.success) {
        const payload = { total: res.data.total, issues: res.data.issues, combinedJql: res.data.combinedJql };
        setReleaseWidgetResults((prev) => (prev && !prev._error ? { ...prev, [kpiId]: payload } : { [kpiId]: payload }));
      } else {
        setReleaseWidgetResults((prev) => (prev && !prev._error ? { ...prev, [kpiId]: { error: res.data?.error || 'Failed' } } : { [kpiId]: { error: res.data?.error || 'Failed' } }));
      }
    } catch (e) {
      setReleaseWidgetResults((prev) => (prev && !prev._error ? { ...prev, [kpiId]: { error: e.response?.data?.error || e.message || 'Failed' } } : { [kpiId]: { error: e.response?.data?.error || e.message || 'Failed' } }));
    } finally {
      setLoadingReleaseWidgetId(null);
    }
  }, [versionFromUrl, selectedVersion, teamId, jiraToken, username]);

  const handleVersionChange = (e) => {
    const v = e.target.value || null;
    setSelectedVersion(v);
    if (v) setSearchParams({ version: v });
    else setSearchParams({});
  };

  const handleLoadRelease = useCallback(() => {
    const version = versionFromUrl || selectedVersion;
    if (!version) return;
    setItemsError('');
    fetchItemsForVersion(version);
  }, [versionFromUrl, selectedVersion, fetchItemsForVersion, setItemsError]);

  /*
  const handleRefreshCrystalBall = useCallback(() => {
    if (items && effectiveVersion && teamId && isEnabled()) {
      const allFeatures = [...(items.commit || []), ...(items.longTermFunded || [])];
      if (allFeatures.length > 0) {
        clearData(); // Clear existing data first
        predictRelease(effectiveVersion, teamId, allFeatures);
        getTrendAnalysis(effectiveVersion, teamId, 30);
        getRiskForecast(effectiveVersion, teamId);
      }
    }
  }, [items, effectiveVersion, teamId, isEnabled, clearData, predictRelease, getTrendAnalysis, getRiskForecast]);
  */

  const commitItems = items?.commit || [];
  const longTermItems = items?.longTermFunded || [];
  const hasItems = commitItems.length > 0 || longTermItems.length > 0;
  const commitPieData = buildPieData(commitItems);
  const longTermPieData = buildPieData(longTermItems);

  // Executive Summary functions
  const fetchExecutiveSummary = async () => {
    console.log('[Executive Summary] Attempting to fetch with version:', effectiveVersion, 'hasJiraToken:', !!jiraToken);
    
    if (!effectiveVersion || effectiveVersion.trim() === '' || !jiraToken) {
      const errorMsg = (!effectiveVersion || effectiveVersion.trim() === '') ? 'Please select a release version first' : 'Missing authentication';
      console.error('[Executive Summary] Error:', errorMsg);
      setExecSummaryError(errorMsg);
      return;
    }

    setExecSummaryLoading(true);
    setExecSummaryError(null);

    try {
      const response = await authenticatedGet('/api/jira/executive-summary-unified', {
        params: { version: effectiveVersion }
      });

      if (response.data?.success && response.data?.data) {
        const summaryData = response.data.data;
        
        // Validate data consistency before setting state
        const totalProjects = summaryData.totalProjects || 0;
        const riskTotal = (summaryData.riskCounts?.red || 0) + 
                         (summaryData.riskCounts?.yellow || 0) + 
                         (summaryData.riskCounts?.green || 0) + 
                         (summaryData.riskCounts?.notSet || 0);
        
        if (totalProjects !== riskTotal) {
          console.warn(`Data inconsistency detected: totalProjects=${totalProjects}, riskTotal=${riskTotal}`);
          // Fix the data on the client side as a fallback
          if (totalProjects === 0) {
            summaryData.riskCounts = { red: 0, yellow: 0, green: 0, notSet: 0 };
            summaryData.projectDetails = { red: [], yellow: [], green: [] };
          }
        }
        
        setExecutiveSummary(summaryData);
        console.log('Executive Summary loaded successfully:', summaryData);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      console.error('Error fetching Executive Summary:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      
      let errorMessage = 'Failed to load Executive Summary';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setExecSummaryError(errorMessage);
    } finally {
      setExecSummaryLoading(false);
    }
  };

  const handleRefreshExecutiveSummary = () => {
    fetchExecutiveSummary();
  };

  // AI VP Report functions
  const validateAndSaveApiKey = async () => {
    if (!tempApiKey.trim()) {
      setAiVpReportError('Please enter a valid API key');
      return;
    }

    // Validate key name (optional but recommended)
    const keyName = tempApiKeyName.trim() || 'Unnamed API Key';

    // Basic format validation for API key
    if (tempApiKey.length < 10) {
      setAiVpReportError('API key appears to be too short. Please check your key.');
      return;
    }

    setApiKeyValidating(true);
    setAiVpReportError(null);
    
    try {
      const response = await authenticatedPost('/api/jira/validate-nai-key', {
        apiKey: tempApiKey
      });
      
      if (response.data.success) {
        localStorage.setItem('nai_api_key', tempApiKey);
        localStorage.setItem('nai_api_key_name', keyName);
        setNaiApiKey(tempApiKey);
        setNaiApiKeyName(keyName);
        setShowApiKeyModal(false);
        setTempApiKey('');
        setTempApiKeyName('');
        // Show success message without intrusive alert
        console.log(`NAI API key "${keyName}" validated and saved successfully`);
      } else {
        setAiVpReportError(`Authentication failed: ${response.data.error}`);
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message;
      if (errorMessage.includes('network') || errorMessage.includes('connectivity')) {
        setAiVpReportError('Network connectivity issue. Please check your connection.');
      } else if (errorMessage.includes('authentication') || errorMessage.includes('401')) {
        setAiVpReportError('Invalid API key. Please verify your credentials.');
      } else {
        setAiVpReportError(`Validation failed: ${errorMessage}`);
      }
    } finally {
      setApiKeyValidating(false);
    }
  };

  const handleGenerateAiVpReport = async () => {
    // Pre-flight checks with helpful messaging
    if (!naiApiKey) {
      // Initialize temp fields with current values for editing
      setTempApiKey('');
      setTempApiKeyName(naiApiKeyName);
      setShowApiKeyModal(true);
      return;
    }

    if (!effectiveVersion || effectiveVersion.trim() === '') {
      setAiVpReportError('Please select a release version to generate the VP report');
      return;
    }

    // Check if executive summary data is available
    if (!executiveSummary || executiveSummary.totalProjects === 0) {
      setAiVpReportError('Executive summary data required. Please refresh the summary first.');
      return;
    }

    setAiVpReportLoading(true);
    setAiVpReportError(null);

    try {
      const response = await authenticatedPost('/api/jira/generate-ai-vp-report', {
        version: effectiveVersion,
        naiApiKey: naiApiKey
      }, {
        timeout: 90000 // Increased timeout for AI processing
      });

      if (response.data.success) {
        setAiVpReport(response.data.data);
        console.log('AI VP Report generated successfully');
        
        // Scroll to report for better UX
        setTimeout(() => {
          const reportElement = document.querySelector('[data-ai-report]');
          if (reportElement) {
            reportElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      } else {
        setAiVpReportError(response.data.error || 'Report generation failed');
      }
    } catch (error) {
      console.error('Error generating AI VP report:', error);
      
      // Intelligent error handling
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        setAiVpReportError('Report generation timed out. NAI API may be experiencing high load. Please try again.');
      } else if (error.response?.status === 429) {
        setAiVpReportError('NAI API rate limit exceeded. Please wait a few minutes and try again.');
      } else if (error.response?.status === 400) {
        const errorMsg = error.response.data?.error || 'Invalid request';
        if (errorMsg.includes('Invalid NAI API key')) {
          setAiVpReportError('API key expired or invalid. Please update your credentials.');
          localStorage.removeItem('nai_api_key');
          localStorage.removeItem('nai_api_key_name');
          setNaiApiKey('');
          setNaiApiKeyName('');
          setTimeout(() => {
            setTempApiKey('');
            setTempApiKeyName(naiApiKeyName);
            setShowApiKeyModal(true);
          }, 1000);
        } else {
          setAiVpReportError(`Request error: ${errorMsg}`);
        }
      } else if (error.response?.status >= 500) {
        setAiVpReportError('Server error occurred. Please try again or contact support if the issue persists.');
      } else {
        setAiVpReportError('Report generation failed. Please check your connection and try again.');
      }
    } finally {
      setAiVpReportLoading(false);
    }
  };

  const clearApiKey = () => {
    localStorage.removeItem('nai_api_key');
    localStorage.removeItem('nai_api_key_name');
    setNaiApiKey('');
    setNaiApiKeyName('');
    setTempApiKey('');
    setTempApiKeyName('');
    alert('NAI API key configuration cleared from storage');
  };

  // Auto-fetch Executive Summary when version is selected and data is loaded
  useEffect(() => {
    console.log('[Executive Summary] Auto-fetch useEffect triggered:', {
      effectiveVersion,
      hasItems,
      hasJiraToken: !!jiraToken,
      versionValid: effectiveVersion && effectiveVersion.trim() !== '',
      shouldFetch: effectiveVersion && effectiveVersion.trim() !== '' && hasItems && jiraToken
    });
    
    // Only fetch if we have a valid non-empty version, items are loaded, and we have authentication
    if (effectiveVersion && effectiveVersion.trim() !== '' && hasItems && jiraToken) {
      console.log('[Executive Summary] Conditions met, fetching Executive Summary...');
      fetchExecutiveSummary();
    } else {
      // Clear any previous error when conditions are not met
      if (execSummaryError) {
        setExecSummaryError(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVersion, hasItems, jiraToken]);

  return (
    <div className="release-trends-page" style={{ padding: '1rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.25rem' }}>Release trends</h2>

      <div style={{ marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
          <span>Release version:</span>
          <select
            value={effectiveVersion || ''}
            onChange={handleVersionChange}
            disabled={loadingVersions}
            style={{ padding: '0.4rem 0.75rem', minWidth: '160px', borderRadius: '4px', border: '1px solid #ced4da' }}
          >
            <option value="">Select version</option>
            {versions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleLoadRelease}
          disabled={loadingItems || !effectiveVersion || !jiraToken}
          style={{
            padding: '0.4rem 0.75rem',
            fontSize: '0.875rem',
            background: '#0d6efd',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: loadingItems || !effectiveVersion || !jiraToken ? 'not-allowed' : 'pointer',
            opacity: loadingItems || !effectiveVersion || !jiraToken ? 0.6 : 1
          }}
        >
          {loadingItems ? 'Loading…' : 'Load release'}
        </button>
        {loadingVersions && <span style={{ color: '#6c757d', fontSize: '0.875rem' }}>Loading versions…</span>}
        {loadingItems && effectiveVersion && (
          <span style={{ color: '#6c757d', fontSize: '0.875rem' }}>Loading release data…</span>
        )}
      </div>

      {itemsError && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px', fontSize: '0.875rem' }}>
          <span style={{ display: 'block', marginBottom: '0.5rem' }}>{itemsError}</span>
          <button
            type="button"
            onClick={() => { setItemsError(''); handleLoadRelease(); }}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem', cursor: 'pointer', backgroundColor: '#721c24', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            Try again
          </button>
        </div>
      )}

      {!hasTeamSelected && (
        <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#fff3cd', borderRadius: '8px', marginBottom: '1rem' }}>
          <h3 style={{ color: '#856404', margin: '0 0 0.5rem 0' }}>Select a Team</h3>
          <p style={{ color: '#856404', margin: 0 }}>
            Please select a team from the header to view release trends and load project data.
          </p>
        </div>
      )}

      {hasTeamSelected && !effectiveVersion && (
        <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>
          Select a release version and click <strong>Load release</strong> to view trends. You can also open this page from the Release Version tab with a version in the URL.
        </p>
      )}

      {isTransitioning && (
        <div style={{ padding: '1rem', textAlign: 'center', backgroundColor: '#e7f3ff', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ color: '#0c5460', margin: 0 }}>
            ⏳ Switching teams... Please wait.
          </p>
        </div>
      )}

      {effectiveVersion && !hasItems && !loadingItems && !itemsError && (
        <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>
          Click <strong>Load release</strong> to load project-level widgets for {effectiveVersion}.
        </p>
      )}

      {hasItems && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #dee2e6', borderRadius: '8px', backgroundColor: '#f8f9fa' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem' }}>Project-level trends ({effectiveVersion})</h3>
          <p style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#6c757d' }}>
            Risk distribution: Green (on track), Yellow (at risk), Red (critical), Not Set.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div style={{ padding: '1rem', backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #dee2e6' }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>Commit features ({commitItems.length})</h4>
              {commitPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={commitPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {commitPieData.map((entry, index) => (
                        <Cell key={`commit-cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#6c757d', fontSize: '0.875rem', margin: 0 }}>No risk data for commit items.</p>
              )}
            </div>
            <div style={{ padding: '1rem', backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #dee2e6' }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>Long-term funded features ({longTermItems.length})</h4>
              {longTermPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={longTermPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {longTermPieData.map((entry, index) => (
                        <Cell key={`longterm-cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#6c757d', fontSize: '0.875rem', margin: 0 }}>No risk data for long-term funded items.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Executive Summary Section - replaces Crystal Ball */}
      {effectiveVersion && hasItems && (
        <div style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center' }}>
              <span style={{ marginRight: '0.5rem' }}>📊</span>
              Executive Summary - {effectiveVersion}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {execSummaryError && (
                <span style={{ 
                  fontSize: '0.75rem', 
                  padding: '0.25rem 0.5rem', 
                  borderRadius: '4px',
                  backgroundColor: '#f8d7da',
                  color: '#721c24'
                }}>
                  Error
                </span>
              )}
              <button
                type="button"
                onClick={handleRefreshExecutiveSummary}
                disabled={execSummaryLoading}
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.75rem',
                  background: execSummaryLoading ? '#6c757d' : '#007bff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: execSummaryLoading ? 'not-allowed' : 'pointer',
                  opacity: execSummaryLoading ? 0.6 : 1
                }}
              >
                {execSummaryLoading ? 'Loading...' : 'Refresh Summary'}
              </button>
              <button
                type="button"
                onClick={handleGenerateAiVpReport}
                disabled={aiVpReportLoading || !executiveSummary}
                style={{
                  padding: '0.375rem 1rem',
                  fontSize: '0.8rem',
                  background: aiVpReportLoading ? '#6c757d' : !executiveSummary ? '#dee2e6' : '#28a745',
                  color: aiVpReportLoading || !executiveSummary ? '#6c757d' : '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: aiVpReportLoading || !executiveSummary ? 'not-allowed' : 'pointer',
                  marginLeft: '0.5rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                  boxShadow: !aiVpReportLoading && executiveSummary ? '0 2px 4px rgba(40, 167, 69, 0.2)' : 'none'
                }}
                title={!executiveSummary ? 'Please refresh summary data first' : 'Generate executive-level VP report using AI'}
              >
                {aiVpReportLoading ? (
                  <>
                    <span style={{ marginRight: '0.5rem' }}>⏳</span>
                    Generating AI Report...
                  </>
                ) : (
                  <>
                    <span style={{ marginRight: '0.5rem' }}>🎯</span>
                    Generate Executive Report
                  </>
                )}
              </button>
            </div>

          </div>
          
          {!effectiveVersion || effectiveVersion.trim() === '' ? (
            <div style={{ 
              padding: '2rem', 
              textAlign: 'center', 
              backgroundColor: '#e9ecef', 
              color: '#495057', 
              borderRadius: '8px', 
              marginBottom: '1rem' 
            }}>
              Please select a release version and load release data to view the Executive Summary
            </div>
          ) : execSummaryError && (
            <div style={{ 
              padding: '1rem', 
              backgroundColor: '#f8d7da', 
              color: '#721c24', 
              borderRadius: '8px', 
              marginBottom: '1rem' 
            }}>
              {execSummaryError}
            </div>
          )}

          {execSummaryLoading && (
            <div style={{ 
              padding: '2rem', 
              textAlign: 'center', 
              color: '#6c757d',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              marginBottom: '1rem'
            }}>
              Loading Executive Summary...
            </div>
          )}

          {executiveSummary && !execSummaryLoading && (
            <>
              {/* Quick Metrics Cards */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                gap: '1rem', 
                marginBottom: '2rem' 
              }}>
                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: '#fff', 
                  border: '2px solid #e9ecef', 
                  borderRadius: '8px', 
                  textAlign: 'center' 
                }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#007bff', marginBottom: '0.5rem' }}>
                    {executiveSummary.totalProjects || 0}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6c757d' }}>Projects</div>
                </div>
                
                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: '#fff', 
                  border: '2px solid #e9ecef', 
                  borderRadius: '8px', 
                  textAlign: 'center' 
                }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#28a745', marginBottom: '0.5rem' }}>
                    {executiveSummary.daysFromPG !== null && executiveSummary.daysFromPG !== undefined
                      ? executiveSummary.daysFromPG : 'TBD'}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6c757d' }}>Days from PG</div>
                </div>
                
                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: '#fff', 
                  border: '2px solid #e9ecef', 
                  borderRadius: '8px', 
                  textAlign: 'center' 
                }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#dc3545', marginBottom: '0.5rem' }}>
                    {executiveSummary.p0BugsCount || 0}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6c757d' }}>P0 Bugs</div>
                </div>
                
                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: '#fff', 
                  border: '2px solid #e9ecef', 
                  borderRadius: '8px', 
                  textAlign: 'center' 
                }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#6f42c1', marginBottom: '0.5rem' }}>
                    {executiveSummary.currentPGDate || 'TBD'}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6c757d' }}>Current PG</div>
                </div>
              </div>

              {/* Critical Dates and Risk Breakdown */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', 
                gap: '2rem', 
                marginBottom: '2rem' 
              }}>
                {/* Critical Dates */}
                <div style={{ 
                  padding: '1.5rem', 
                  backgroundColor: '#fff', 
                  border: '1px solid #dee2e6', 
                  borderRadius: '8px' 
                }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', display: 'flex', alignItems: 'center' }}>
                    📅 Critical Dates
                  </h4>
                  
                  {/* Code Complete */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: '500', color: '#495057', marginRight: '0.5rem' }}>Code Complete:</span>
                    <span>
                      {executiveSummary.milestones?.codeComplete?.length > 0 ? (
                        executiveSummary.milestones.codeComplete.map((milestone, index) => (
                          <React.Fragment key={index}>
                            {milestone.isStrikeThrough ? (
                              <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                                {milestone.formattedDate}
                              </span>
                            ) : (
                              <span style={{ fontWeight: 'bold' }}>
                                {milestone.formattedDate}
                              </span>
                            )}
                            {index < executiveSummary.milestones.codeComplete.length - 1 && (
                              <span style={{ margin: '0 8px' }}></span>
                            )}
                          </React.Fragment>
                        ))
                      ) : 'TBD'}
                    </span>
                  </div>

                  {/* Commit Gate */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: '500', color: '#495057', marginRight: '0.5rem' }}>Commit Gate:</span>
                    <span>
                      {executiveSummary.milestones?.commitGate?.length > 0 ? (
                        executiveSummary.milestones.commitGate.map((milestone, index) => (
                          <React.Fragment key={index}>
                            {milestone.isStrikeThrough ? (
                              <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                                {milestone.formattedDate}
                              </span>
                            ) : (
                              <span style={{ fontWeight: 'bold' }}>
                                {milestone.formattedDate}
                              </span>
                            )}
                            {index < executiveSummary.milestones.commitGate.length - 1 && (
                              <span style={{ margin: '0 8px' }}></span>
                            )}
                          </React.Fragment>
                        ))
                      ) : 'TBD'}
                    </span>
                  </div>

                  {/* Promotion Gate */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: '500', color: '#495057', marginRight: '0.5rem' }}>Promotion Gate:</span>
                    <span>
                      {executiveSummary.milestones?.promotionGate?.length > 0 ? (
                        executiveSummary.milestones.promotionGate.map((milestone, index) => (
                          <React.Fragment key={index}>
                            {milestone.isStrikeThrough ? (
                              <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                                {milestone.formattedDate}
                              </span>
                            ) : (
                              <span style={{ fontWeight: 'bold' }}>
                                {milestone.formattedDate}
                              </span>
                            )}
                            {index < executiveSummary.milestones.promotionGate.length - 1 && (
                              <span style={{ margin: '0 8px' }}></span>
                            )}
                          </React.Fragment>
                        ))
                      ) : 'TBD'}
                    </span>
                  </div>

                  {/* Release Date */}
                  <div>
                    <span style={{ fontWeight: '500', color: '#495057', marginRight: '0.5rem' }}>Release Date:</span>
                    <span>
                      {executiveSummary.milestones?.generalAvailability?.length > 0 ? (
                        executiveSummary.milestones.generalAvailability.map((milestone, index) => (
                          <React.Fragment key={index}>
                            {milestone.isStrikeThrough ? (
                              <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                                {milestone.formattedDate}
                              </span>
                            ) : (
                              <span style={{ fontWeight: 'bold' }}>
                                {milestone.formattedDate}
                              </span>
                            )}
                            {index < executiveSummary.milestones.generalAvailability.length - 1 && (
                              <span style={{ margin: '0 8px' }}></span>
                            )}
                          </React.Fragment>
                        ))
                      ) : 'TBD'}
                    </span>
                  </div>
                </div>

                {/* Risk Breakdown */}
                <div style={{ 
                  padding: '1.5rem', 
                  backgroundColor: '#fff', 
                  border: '1px solid #dee2e6', 
                  borderRadius: '8px' 
                }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Project Risk Breakdown</h4>
                  
                  <table style={{ width: '100%', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #dee2e6' }}>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0', fontWeight: '500' }}>Risk Level</th>
                        <th style={{ textAlign: 'center', padding: '0.5rem 0', fontWeight: '500' }}>Count</th>
                        <th style={{ textAlign: 'center', padding: '0.5rem 0', fontWeight: '500' }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: '0.5rem 0' }}>🟢 Green - On Track</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>{executiveSummary.riskCounts?.green || 0}</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                          {executiveSummary.totalProjects > 0 
                            ? Math.round(((executiveSummary.riskCounts?.green || 0) / executiveSummary.totalProjects) * 100) 
                            : 0}%
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '0.5rem 0' }}>🟡 Yellow - Slight Risk</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>{executiveSummary.riskCounts?.yellow || 0}</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                          {executiveSummary.totalProjects > 0 
                            ? Math.round(((executiveSummary.riskCounts?.yellow || 0) / executiveSummary.totalProjects) * 100) 
                            : 0}%
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '0.5rem 0' }}>🔴 Red - Big Risk</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>{executiveSummary.riskCounts?.red || 0}</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                          {executiveSummary.totalProjects > 0 
                            ? Math.round(((executiveSummary.riskCounts?.red || 0) / executiveSummary.totalProjects) * 100) 
                            : 0}%
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '0.5rem 0' }}>⚪ Not Set</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>{executiveSummary.riskCounts?.notSet || 0}</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                          {executiveSummary.totalProjects > 0 
                            ? Math.round(((executiveSummary.riskCounts?.notSet || 0) / executiveSummary.totalProjects) * 100) 
                            : 0}%
                        </td>
                      </tr>
                      <tr style={{ borderTop: '1px solid #dee2e6', fontWeight: '500' }}>
                        <td style={{ padding: '0.5rem 0' }}>TOTAL</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>{executiveSummary.totalProjects || 0}</td>
                        <td style={{ textAlign: 'center', padding: '0.5rem 0' }}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Enhanced Per-Project Details with Automated Analysis */}
              {executiveSummary.projectDetails && (
                <div style={{ 
                  padding: '1.5rem', 
                  backgroundColor: '#fff', 
                  border: '1px solid #dee2e6', 
                  borderRadius: '8px',
                  marginBottom: '1rem'
                }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Per-Project Details with Automated Analysis</h4>
                  
                  {executiveSummary.projectDetails.red?.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h5 style={{ color: '#dc3545', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                        🔴 High Risk Projects ({executiveSummary.projectDetails.red.length} projects)
                      </h5>
                      {executiveSummary.projectDetails.red.map(project => (
                        <div key={project.key} style={{ 
                          fontSize: '0.875rem', 
                          padding: '1rem', 
                          backgroundColor: '#f8d7da', 
                          borderRadius: '6px',
                          marginBottom: '0.75rem',
                          border: '1px solid #f5c6cb'
                        }}>
                          <div style={{ marginBottom: '0.5rem' }}>
                            <strong style={{ fontSize: '0.95rem' }}>{project.key}</strong>: {project.summary}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#721c24', marginBottom: '0.5rem' }}>
                            Status: <strong>{project.status}</strong> | Priority: <strong>{project.priority}</strong>
                          </div>
                          
                          {project.automatedAnalysis && (
                            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                              <div style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: '#495057' }}>💡 AUTOMATED ANALYSIS:</div>
                              
                              {/* PROMINENT RISK REASON DISPLAY - Only show if we have meaningful reasoning */}
                              {(() => {
                                const riskReason = project.automatedAnalysis.riskFactors?.find(rf => rf.startsWith('Risk Reason:'));
                                const reasoning = riskReason?.replace('Risk Reason: ', '');
                                
                                // Only show if we have specific, meaningful reasoning (not generic categories)
                                const genericReasons = ['slight risk to plan', 'on track', 'at risk', 'high risk', 'critical', 'on plan'];
                                const isGeneric = reasoning && genericReasons.some(gr => reasoning.toLowerCase().includes(gr));
                                
                                if (riskReason && reasoning && reasoning.length > 10 && !isGeneric) {
                                  return (
                                    <div style={{ 
                                      marginBottom: '0.5rem', 
                                      padding: '0.5rem', 
                                      backgroundColor: '#f8d7da', 
                                      border: '1px solid #f5c6cb',
                                      borderRadius: '4px'
                                    }}>
                                      <strong style={{ color: '#721c24' }}>🔴 WHY RED:</strong> 
                                      <span style={{ marginLeft: '0.5rem' }}>{reasoning}</span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              
                              {project.automatedAnalysis.resourceStatus?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>👥 Resources:</strong> {project.automatedAnalysis.resourceStatus.join(' | ')}
                                </div>
                              )}
                              
                              {project.automatedAnalysis.timelineStatus?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>📅 Timeline:</strong> {project.automatedAnalysis.timelineStatus.join(' | ')}
                                </div>
                              )}
                              
                              {project.automatedAnalysis.qualityIndicators?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>📊 Quality:</strong> {project.automatedAnalysis.qualityIndicators.join(' | ')}
                                </div>
                              )}
                              
                              {project.automatedAnalysis.riskFactors?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>⚠️ Risk Factors:</strong> {project.automatedAnalysis.riskFactors.join(' | ')}
                                </div>
                              )}
                              
                              {project.automatedAnalysis.documentationStatus?.length > 0 && (
                                <div>
                                  <strong>📋 Documentation:</strong> {project.automatedAnalysis.documentationStatus.join(' | ')}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {executiveSummary.projectDetails.yellow?.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h5 style={{ color: '#ffc107', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                        🟡 Medium Risk Projects ({executiveSummary.projectDetails.yellow.length} projects)
                      </h5>
                      {executiveSummary.projectDetails.yellow.map(project => (
                        <div key={project.key} style={{ 
                          fontSize: '0.875rem', 
                          padding: '1rem', 
                          backgroundColor: '#fff3cd', 
                          borderRadius: '6px',
                          marginBottom: '0.75rem',
                          border: '1px solid #ffeaa7'
                        }}>
                          <div style={{ marginBottom: '0.5rem' }}>
                            <strong style={{ fontSize: '0.95rem' }}>{project.key}</strong>: {project.summary}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#856404', marginBottom: '0.5rem' }}>
                            Status: <strong>{project.status}</strong> | Priority: <strong>{project.priority}</strong>
                          </div>
                          
                          {project.automatedAnalysis && (
                            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                              <div style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: '#495057' }}>💡 AUTOMATED ANALYSIS:</div>
                              
                              {/* PROMINENT RISK REASON DISPLAY - Only show if we have meaningful reasoning */}
                              {(() => {
                                const riskReason = project.automatedAnalysis.riskFactors?.find(rf => rf.startsWith('Risk Reason:'));
                                const reasoning = riskReason?.replace('Risk Reason: ', '');
                                
                                // Only show if we have specific, meaningful reasoning (not generic categories)
                                const genericReasons = ['slight risk to plan', 'on track', 'at risk', 'high risk', 'critical', 'on plan'];
                                const isGeneric = reasoning && genericReasons.some(gr => reasoning.toLowerCase().includes(gr));
                                
                                if (riskReason && reasoning && reasoning.length > 10 && !isGeneric) {
                                  return (
                                    <div style={{ 
                                      marginBottom: '0.5rem', 
                                      padding: '0.5rem', 
                                      backgroundColor: '#fff3cd', 
                                      border: '1px solid #ffeaa7',
                                      borderRadius: '4px'
                                    }}>
                                      <strong style={{ color: '#856404' }}>🟡 WHY YELLOW:</strong> 
                                      <span style={{ marginLeft: '0.5rem' }}>{reasoning}</span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              
                              {project.automatedAnalysis.resourceStatus?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>👥 Resources:</strong> {project.automatedAnalysis.resourceStatus.join(' | ')}
                                </div>
                              )}
                              
                              {project.automatedAnalysis.timelineStatus?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>📅 Timeline:</strong> {project.automatedAnalysis.timelineStatus.join(' | ')}
                                </div>
                              )}
                              
                              {project.automatedAnalysis.qualityIndicators?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>📊 Quality:</strong> {project.automatedAnalysis.qualityIndicators.join(' | ')}
                                </div>
                              )}
                              
                              {project.automatedAnalysis.riskFactors?.length > 0 && (
                                <div style={{ marginBottom: '0.25rem' }}>
                                  <strong>⚠️ Risk Factors:</strong> {project.automatedAnalysis.riskFactors.join(' | ')}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {executiveSummary.projectDetails.green?.length > 0 && (
                    <div>
                      <h5 style={{ color: '#28a745', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                        🟢 On Track Projects ({executiveSummary.projectDetails.green.length} projects on track)
                      </h5>
                      <div style={{ fontSize: '0.8rem', color: '#155724', fontStyle: 'italic' }}>
                        These projects are meeting their targets with adequate resources and documentation.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Crystal Ball availability section removed - Executive Summary is now always available */}

      {effectiveVersion && teamId && kpis.length === 0 && kpisLoadError && (
        <div style={{ marginTop: '1.5rem', padding: '0.75rem 1rem', background: '#fff3cd', color: '#856404', borderRadius: '8px', fontSize: '0.875rem' }}>
          {kpisLoadError}
        </div>
      )}

      {effectiveVersion && teamId && kpis.length > 0 && (
        <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #dee2e6', borderRadius: '8px', backgroundColor: '#f8f9fa' }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1.1rem' }}>Release KPI widgets</h3>
          <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: '#6c757d' }}>
            Load widgets only when you need them. This makes JIRA calls for the selected release.
          </p>
          <div style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              onClick={fetchReleaseWidgets}
              disabled={releaseWidgetsLoading}
              style={{
                padding: '0.4rem 0.75rem',
                fontSize: '0.875rem',
                background: '#0d6efd',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: releaseWidgetsLoading ? 'not-allowed' : 'pointer',
                opacity: releaseWidgetsLoading ? 0.6 : 1
              }}
            >
              {releaseWidgetsLoading ? 'Loading…' : 'Load widgets'}
            </button>
            {releaseWidgetResults && !releaseWidgetResults._error && (
              <button
                type="button"
                onClick={fetchReleaseWidgets}
                disabled={releaseWidgetsLoading}
                style={{ marginLeft: '0.5rem', padding: '0.4rem 0.75rem', fontSize: '0.875rem', background: '#6c757d', color: '#fff', border: 'none', borderRadius: '6px', cursor: releaseWidgetsLoading ? 'not-allowed' : 'pointer' }}
              >
                Refresh
              </button>
            )}
          </div>
          {releaseWidgetResults && releaseWidgetResults._error && (
            <div style={{ marginBottom: '0.75rem', color: '#dc3545', fontSize: '0.875rem' }}>
              <span style={{ display: 'block', marginBottom: '0.5rem' }}>
                {releaseWidgetResults._error === 'Team KPIs not found' || (typeof releaseWidgetResults._error === 'string' && releaseWidgetResults._error.includes('No KPI config'))
                  ? 'No KPIs configured for this team. Configure KPIs on the KPIs page.'
                  : releaseWidgetResults._error}
              </span>
              <button
                type="button"
                onClick={() => { setReleaseWidgetResults(null); fetchReleaseWidgets(); }}
                disabled={releaseWidgetsLoading}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem', cursor: releaseWidgetsLoading ? 'not-allowed' : 'pointer', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '6px', opacity: releaseWidgetsLoading ? 0.6 : 1 }}
              >
                Try again
              </button>
            </div>
          )}
          {releaseWidgetResults && !releaseWidgetResults._error && (() => {
            const countKpis = kpis.filter((k) => k.displayType !== 'list');
            const listKpis = kpis.filter((k) => k.displayType === 'list');
            return (
              <>
                {countKpis.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600, color: '#495057' }}>Counts</h4>
                    <div style={CARD_STYLES.grid}>
                      {countKpis.map((kpi) => (
                        <KPIWidgetCard
                          key={kpi.id}
                          kpi={kpi}
                          data={releaseWidgetResults[kpi.id]}
                          onRefresh={refreshReleaseWidget}
                          isRefreshing={loadingReleaseWidgetId === kpi.id}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {listKpis.length > 0 && (
                  <div>
                    <h4 style={{ marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600, color: '#495057' }}>Lists</h4>
                    <div style={CARD_STYLES.grid}>
                      {listKpis.map((kpi) => (
                        <KPIWidgetCard
                          key={kpi.id}
                          kpi={kpi}
                          data={releaseWidgetResults[kpi.id]}
                          onRefresh={refreshReleaseWidget}
                          isRefreshing={loadingReleaseWidgetId === kpi.id}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* NAI API Key Modal */}
      {showApiKeyModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '2rem',
            borderRadius: '8px',
            width: '420px',
            maxWidth: '90vw'
          }}>
            <h4 style={{ marginTop: 0 }}>NAI API Key Required</h4>
            <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#666' }}>
              Enter your NAI API key details to generate AI-powered VP reports. The configuration will be stored securely in your browser.
            </p>
            
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 500, color: '#495057' }}>
              Key Name (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g., My NAI Key, Production Key, etc."
              value={tempApiKeyName}
              onChange={(e) => setTempApiKeyName(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                marginBottom: '1rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '0.85rem'
              }}
            />
            
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 500, color: '#495057' }}>
              API Key *
            </label>
            <input
              type="password"
              placeholder="Enter your NAI API key"
              value={tempApiKey}
              onChange={(e) => setTempApiKey(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                marginBottom: '1rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '0.85rem'
              }}
              onKeyPress={(e) => e.key === 'Enter' && validateAndSaveApiKey()}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowApiKeyModal(false);
                  setTempApiKey('');
                  setTempApiKeyName('');
                }}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={validateAndSaveApiKey}
                disabled={apiKeyValidating}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: apiKeyValidating ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: apiKeyValidating ? 'not-allowed' : 'pointer'
                }}
              >
                {apiKeyValidating ? 'Validating...' : 'Test & Save'}
              </button>
            </div>
            {naiApiKey && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                <div style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
                  Current: {naiApiKeyName || 'Unnamed API Key'}
                </div>
                <button
                  onClick={clearApiKey}
                  style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                >
                  Clear Configuration
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI VP Report Display Section */}
      {aiVpReport && (
        <div 
          data-ai-report
          style={{ 
            marginTop: '2rem', 
            padding: '2rem', 
            backgroundColor: '#f8f9fa', 
            borderRadius: '12px',
            border: '1px solid #e9ecef',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.07)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
            <h4 style={{ margin: 0, color: '#28a745', fontSize: '1.25rem', fontWeight: '600' }}>
              <span style={{ marginRight: '0.5rem' }}>🎯</span>
              Executive VP Report
            </h4>
            <div style={{ 
              marginLeft: 'auto', 
              fontSize: '0.75rem', 
              color: '#6c757d',
              display: 'flex',
              alignItems: 'center'
            }}>
              <span style={{ marginRight: '0.5rem' }}>🤖</span>
              Generated by AI • {new Date(aiVpReport.generatedAt).toLocaleDateString()}
            </div>
          </div>
          
          <div style={{
            backgroundColor: 'white',
            padding: '2rem',
            borderRadius: '8px',
            border: '1px solid #dee2e6',
            maxHeight: '70vh',
            overflowY: 'auto',
            boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{
              whiteSpace: 'pre-wrap',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              margin: 0,
              fontSize: '0.95rem',
              lineHeight: '1.6',
              color: '#212529'
            }}>
              {aiVpReport.vpReport}
            </div>
          </div>
          
          <div style={{ 
            marginTop: '1.5rem', 
            display: 'flex', 
            gap: '0.75rem',
            alignItems: 'center'
          }}>
            <button
              onClick={() => {
                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                const filename = `Executive-VP-Report-${aiVpReport.version}-${timestamp}.txt`;
                const content = `EXECUTIVE VP REPORT\n==================\n\nRelease: ${aiVpReport.version}\nGenerated: ${new Date(aiVpReport.generatedAt).toLocaleString()}\nSource: AI Analysis with Automated Data Validation\n\n${aiVpReport.vpReport}`;
                
                const element = document.createElement('a');
                const file = new Blob([content], { type: 'text/plain;charset=utf-8' });
                element.href = URL.createObjectURL(file);
                element.download = filename;
                document.body.appendChild(element);
                element.click();
                document.body.removeChild(element);
              }}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '500',
                boxShadow: '0 2px 4px rgba(0, 123, 255, 0.2)',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#0056b3'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#007bff'}
            >
              📄 Download Executive Report
            </button>
            
            <button
              onClick={(e) => {
                navigator.clipboard.writeText(aiVpReport.vpReport).then(() => {
                  // Show temporary success feedback
                  const btn = e.target;
                  const originalText = btn.textContent;
                  btn.textContent = '✅ Copied to Clipboard';
                  btn.style.backgroundColor = '#28a745';
                  setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.backgroundColor = '#6c757d';
                  }, 2000);
                }).catch(() => {
                  alert('Copy to clipboard failed. Please use download instead.');
                });
              }}
              style={{
                padding: '0.75rem 1.25rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '500'
              }}
            >
              📋 Copy to Clipboard
            </button>
            
            <button
              onClick={() => setAiVpReport(null)}
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'transparent',
                color: '#6c757d',
                border: '1px solid #dee2e6',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                marginLeft: 'auto'
              }}
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}

      {aiVpReportError && (
        <div style={{
          marginTop: '1rem',
          padding: '1rem',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          borderRadius: '4px',
          border: '1px solid #f5c6cb'
        }}>
          <strong>AI VP Report Error:</strong> {aiVpReportError}
        </div>
      )}
      
      {/* CrystalBallI Chat Widget */}
      <CrystalBallIChat
        releaseVersion={effectiveVersion}
        features={[...(items?.commit || []), ...(items?.longTermFunded || [])]}
        targetDate={inferTargetDate(effectiveVersion)}
      />
    </div>
  );
}

// Helper function to infer target date from release version
function inferTargetDate(releaseVersion) {
  if (!releaseVersion) return null;
  
  const match = releaseVersion.match(/(\d+)\.(\d+)/);
  if (match) {
    const _major = parseInt(match[1]); // Major version not used in calculation
    const minor = parseInt(match[2]);
    
    // Simple heuristic: releases every ~3 months
    const baseDate = new Date('2026-01-01');
    const quarterMonths = minor * 3;
    baseDate.setMonth(baseDate.getMonth() + quarterMonths);
    
    return baseDate.toISOString().split('T')[0];
  }
  
  return null;
}
