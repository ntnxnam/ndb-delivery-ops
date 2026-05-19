import React, { useEffect, useState, useCallback } from 'react';
import { useReleaseAnalysis } from '../hooks/useReleaseAnalysis';
import { exportReleaseAnalysisToExcel } from '../utils/excelExporter';
import { useNotifications } from '../shared/services/notificationService';
import MilestoneTimelineChart from './ReleaseAnalysis/MilestoneTimelineChart';
import VelocityByReleaseChart from './ReleaseAnalysis/VelocityByReleaseChart';
import VelocityByIssueTypeChart from './ReleaseAnalysis/VelocityByIssueTypeChart';
import './ReleaseAnalysisPage.css';

const ReleaseAnalysisPage = () => {
  const { success: showSuccess, error: showError } = useNotifications();
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [selectedReleases, setSelectedReleases] = useState(['NDB-2.8', 'NDB-2.9', 'NDB-2.10', 'NDB-2.11']);

  const {
    data: analysisData,
    loading,
    error,
    loadingProgress,
    progressiveData,
    fetchAnalysisData,
    processedData,
    milestoneData,
    velocityByRelease,
    velocityByIssueType,
    // Progressive data that updates as each release completes
    progressiveProcessedData,
    progressiveVelocityByRelease,
    progressiveVelocityByIssueType
  } = useReleaseAnalysis();
  
  // Use progressive data when loading, final data when complete
  const currentProcessedData = loading ? progressiveProcessedData : processedData;
  const currentVelocityByRelease = loading ? progressiveVelocityByRelease : velocityByRelease;
  const currentVelocityByIssueType = loading ? progressiveVelocityByIssueType : velocityByIssueType;

  // Fetch data on component mount (only once).
  // Intentionally omits fetchAnalysisData/selectedReleases — including them
  // re-triggers the infinite loop noted in handleReleaseToggle below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAnalysisData(selectedReleases); }, []);

  // Handle Excel download
  const handleExcelDownload = useCallback(async () => {
    if (!processedData || processedData.length === 0) {
      showError('No data available for export');
      return;
    }

    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `Release-Velocity-Analysis-${timestamp}.xlsx`;
      
      await exportReleaseAnalysisToExcel(processedData, filename);
      
      showSuccess(`Excel file downloaded: ${filename}`);
    } catch (err) {
      console.error('Excel export error:', err);
      showError('Failed to export data to Excel');
    }
  }, [processedData, showSuccess, showError]);

  // Handle period filter change
  const handlePeriodChange = (period) => {
    setSelectedPeriod(period);
  };

  // Handle release selection change
  const handleReleaseToggle = (release) => {
    const newSelection = selectedReleases.includes(release) 
      ? selectedReleases.filter(r => r !== release)
      : [...selectedReleases, release];
    
    setSelectedReleases(newSelection);
    
    // TODO: Re-enable after fixing infinite loop issue
    // Re-fetch data with new selection
    // if (newSelection.length > 0) {
    //   fetchAnalysisData(newSelection);
    // }
  };

  if (loading) {
    return (
      <div className="release-analysis-page">
        <div className="enhanced-loading-container">
          {/* Header with spinner */}
          <div className="loading-header">
            <div className="loading-spinner-enhanced">
              <div className="spinner-ring"></div>
              <div className="spinner-center">📊</div>
            </div>
            <h2>Analyzing Past Releases</h2>
            <p className="loading-subtitle">{loadingProgress.message || 'Preparing analysis...'}</p>
          </div>

          {/* Progress bar */}
          <div className="progress-section">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${loadingProgress.progress || 0}%` }}
              ></div>
            </div>
            <div className="progress-text">
              {loadingProgress.progress || 0}% Complete
            </div>
          </div>

          {/* Current stage indicator */}
          <div className="stage-indicator">
            <div className="stage-steps">
              <div className={`stage-step ${loadingProgress.stage === 'initializing' || loadingProgress.progress > 0 ? 'active' : ''} ${loadingProgress.progress > 10 ? 'completed' : ''}`}>
                <div className="step-icon">🔍</div>
                <span>Initializing</span>
              </div>
              <div className={`stage-step ${loadingProgress.stage === 'fetching' || loadingProgress.progress > 10 ? 'active' : ''} ${loadingProgress.progress > 70 ? 'completed' : ''}`}>
                <div className="step-icon">📡</div>
                <span>Fetching Data</span>
              </div>
              <div className={`stage-step ${loadingProgress.stage === 'processing' || loadingProgress.progress > 70 ? 'active' : ''} ${loadingProgress.progress >= 100 ? 'completed' : ''}`}>
                <div className="step-icon">⚙️</div>
                <span>Processing</span>
              </div>
              <div className={`stage-step ${loadingProgress.stage === 'complete' || loadingProgress.progress >= 100 ? 'active completed' : ''}`}>
                <div className="step-icon">✅</div>
                <span>Complete</span>
              </div>
            </div>
          </div>

          {/* Detailed progress log */}
          <div className="progress-details">
            <h4>Progress Details:</h4>
            <div className="details-log">
              {loadingProgress.details.map((detail, index) => (
                <div key={index} className="detail-item">
                  <span className="detail-bullet">•</span>
                  <span>{detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Expected time info */}
          <div className="time-estimate">
            <small>
              ⏱️ Expected completion time: 30-90 seconds depending on data volume
            </small>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isTimeoutError = error.includes('timeout') || error.includes('timed out');
    
    return (
      <div className="release-analysis-page">
        <div className="error-container">
          <div className="error-icon">⚠️</div>
          <h3>Error Loading Analysis Data</h3>
          <p>{error}</p>
          
          {isTimeoutError && (
            <div className="error-suggestions">
              <h4>💡 Suggestions to resolve timeout issues:</h4>
              <ul>
                <li>Try selecting fewer releases (1-2 at a time)</li>
                <li>Start with recent releases (NDB-2.10, 2.11) which have less data</li>
                <li>Check your network connection</li>
                <li>Wait a few minutes and try again</li>
              </ul>
            </div>
          )}
          
          <div className="error-actions">
            <button 
              onClick={() => fetchAnalysisData(selectedReleases)} 
              className="retry-button primary"
            >
              Retry Same Selection
            </button>
            
            {isTimeoutError && selectedReleases.length > 1 && (
              <button 
                onClick={() => fetchAnalysisData(['NDB-2.11'])} 
                className="retry-button secondary"
              >
                Try Latest Release Only
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="release-analysis-page">
      {/* Header Section */}
      <div className="page-header">
        <div className="header-content">
          <h1>Analysis of Past Releases</h1>
          <p>
            Historical ticket closure velocity analysis for NDB releases to forecast completion timelines.
            Data is binned into 3-week intervals with one boundary aligned to April 22, 2026.
          </p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={handleExcelDownload}
            className="excel-download-btn"
            disabled={!processedData || processedData.length === 0 || loading}
          >
            <span className="btn-icon">📊</span>
            {loading ? 'Processing...' : 'Download Data as Excel'}
          </button>
          
          {loading && (
            <div className="loading-indicator">
              <span className="loading-dot">•</span>
              <span>Fetching data...</span>
            </div>
          )}
        </div>
      </div>

      {/* Controls Section */}
      <div className={`controls-section ${loading ? 'controls-disabled' : ''}`}>
        <div className="control-group">
          <label>Time Period:</label>
          <select 
            value={selectedPeriod} 
            onChange={(e) => handlePeriodChange(e.target.value)}
            className="period-select"
            disabled={loading}
          >
            <option value="all">All Available Data</option>
            <option value="post-code-complete">Post Code Complete Only</option>
            <option value="last-6-months">Last 6 Months</option>
            <option value="last-year">Last Year</option>
          </select>
        </div>

        <div className="control-group">
          <label>Releases:</label>
          <div className="release-checkboxes">
            {['NDB-2.8', 'NDB-2.9', 'NDB-2.10', 'NDB-2.11'].map(release => (
              <label key={release} className={`checkbox-label ${loading ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedReleases.includes(release)}
                  onChange={() => handleReleaseToggle(release)}
                  disabled={loading}
                />
                <span>{release}</span>
              </label>
            ))}
          </div>
        </div>
        
        {loading && (
          <div className="controls-loading">
            <span className="loading-dot">•</span>
            <span>Updating analysis...</span>
          </div>
        )}
      </div>

      {/* Data Summary - show progressive stats */}
      <div className="data-summary">
        <div className="summary-stats">
          <div className="stat-item">
            <span className="stat-value">
              {currentProcessedData ? currentProcessedData.length : 0}
              {loading && <span className="loading-indicator-small">⏳</span>}
            </span>
            <span className="stat-label">Total Tickets Analyzed</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">
              {loading ? `${progressiveData?.completedReleases?.length || 0}/${selectedReleases.length}` : selectedReleases.length}
            </span>
            <span className="stat-label">
              {loading ? 'Releases Completed' : 'Releases Included'}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-value">
              {currentVelocityByIssueType ? Object.keys(currentVelocityByIssueType.categories || {}).length : 4}
            </span>
            <span className="stat-label">Issue Type Categories</span>
          </div>
        </div>
        
        {loading && progressiveData?.completedReleases && (
          <div className="release-progress">
            <div className="completed-releases">
              <strong>Completed:</strong> {progressiveData.completedReleases.join(', ') || 'None yet'}
            </div>
            <div className="pending-releases">
              <strong>Pending:</strong> {selectedReleases.filter(r => !progressiveData.completedReleases.includes(r)).join(', ') || 'None'}
            </div>
          </div>
        )}
      </div>

      {/* Charts Section - Progressive Loading */}
      <div className={`charts-section ${loading ? 'charts-progressive' : ''}`}>
        {/* Milestone Timeline Chart */}
        <div className="chart-container">
          <div className="chart-header">
            <h2>
              Release Milestone Timeline
              {loading && (
                <span className="chart-status">
                  {progressiveData?.completedReleases?.length > 0 
                    ? `(${progressiveData.completedReleases.length}/${selectedReleases.length} releases loaded)`
                    : '(Loading...)'
                  }
                </span>
              )}
            </h2>
            <p>Gantt-style view of all release milestones with consistent color coding</p>
          </div>
          <MilestoneTimelineChart 
            data={milestoneData} 
            selectedReleases={selectedReleases}
            isLoading={loading}
            completedReleases={progressiveData?.completedReleases || []}
          />
        </div>

        {/* Velocity by Release Chart */}
        <div className="chart-container">
          <div className="chart-header">
            <h2>
              3-Week Velocity by Release
              {loading && currentVelocityByRelease && (
                <span className="chart-status">
                  ({currentVelocityByRelease.bins?.length || 0} periods, {currentProcessedData?.length || 0} tickets)
                </span>
              )}
            </h2>
            <p>Total tickets closed per 3-week period, grouped by release with milestone overlays</p>
          </div>
          <VelocityByReleaseChart 
            data={currentVelocityByRelease}
            milestones={milestoneData}
            selectedReleases={selectedReleases}
            isLoading={loading}
            completedReleases={progressiveData?.completedReleases || []}
          />
        </div>

        {/* Velocity by Issue Type Chart */}
        <div className="chart-container">
          <div className="chart-header">
            <h2>
              3-Week Velocity by Issue Type
              {loading && currentVelocityByIssueType && (
                <span className="chart-status">
                  (Updating as releases complete...)
                </span>
              )}
            </h2>
            <p>Ticket closure trends by issue type category with milestone markers</p>
          </div>
          <VelocityByIssueTypeChart 
            data={currentVelocityByIssueType}
            milestones={milestoneData}
            selectedPeriod={selectedPeriod}
            isLoading={loading}
            completedReleases={progressiveData?.completedReleases || []}
          />
        </div>
      </div>

      {/* Footer Information */}
      <div className="analysis-footer">
        <div className="footer-info">
          <h3>Analysis Parameters</h3>
          <ul>
            <li>Data filtered for tickets with StatusCategory = 'Done'</li>
            <li>Only tickets resolved after their respective Code Complete dates are included</li>
            <li>Issue types categorized into: Bug, Improvement, Test, and Other</li>
            <li>3-week bins aligned with April 22, 2026 boundary</li>
            <li>Milestone overlays show EC, Code Complete, CG, Branch Cut, PG, and GA dates</li>
          </ul>
        </div>
        
        <div className="footer-dates">
          <h3>Release Milestones</h3>
          <div className="milestone-grid">
            <div className="milestone-row">
              <strong>NDB-2.8:</strong> EC (07 Nov 2024), CC (26 Nov 2024), CG (15 Jan 2025), PG (18 Feb 2025), GA (24 Mar 2025)
            </div>
            <div className="milestone-row">
              <strong>NDB-2.9:</strong> EC (17 Apr 2025), CC (05 Jun 2025), CG (03 Jun 2025), PG (08 Aug 2025), GA (01 Oct 2025)
            </div>
            <div className="milestone-row">
              <strong>NDB-2.10:</strong> EC (08 May 2025), CC (05 Sep 2025), CG (03 Dec 2025), PG (02 Mar 2026), GA (03 Mar 2026)
            </div>
            <div className="milestone-row">
              <strong>NDB-2.11:</strong> EC (09 Dec 2025), CC (27 Feb 2026), CG (14 Apr 2026), PG (12 May 2026), GA (15 Jun 2026)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReleaseAnalysisPage;