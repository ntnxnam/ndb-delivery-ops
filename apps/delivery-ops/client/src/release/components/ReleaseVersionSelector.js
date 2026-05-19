import React from 'react';
import { SmartLoader } from '../../shared/components/SmartLoader';
import { formatters } from '../../shared/utils/formatters';

export const ReleaseVersionSelector = ({
  versions = [],
  selectedVersion,
  onVersionChange,
  loading = false,
  error = null,
  onRefresh,
  className = ""
}) => {
  const handleVersionChange = (e) => {
    const newVersion = e.target.value;
    if (newVersion !== selectedVersion && onVersionChange) {
      onVersionChange(newVersion);
    }
  };

  const getVersionInfo = (version) => {
    if (!version.releaseDate && !version.description) return null;
    
    const parts = [];
    if (version.releaseDate) {
      parts.push(`Release: ${formatters.date(version.releaseDate)}`);
    }
    if (version.description) {
      parts.push(version.description);
    }
    return parts.join(' - ');
  };

  const getVersionStatus = (version) => {
    if (!version.releaseDate) return 'planning';
    
    const releaseDate = new Date(version.releaseDate);
    const now = new Date();
    
    if (releaseDate < now) return 'released';
    if (releaseDate - now <= 30 * 24 * 60 * 60 * 1000) return 'upcoming'; // 30 days
    return 'future';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'released': return '#28a745';
      case 'upcoming': return '#ffc107';
      case 'future': return '#007bff';
      case 'planning': return '#6c757d';
      default: return '#6c757d';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'released': return '✅';
      case 'upcoming': return '⏰';
      case 'future': return '📅';
      case 'planning': return '📋';
      default: return '📦';
    }
  };

  if (loading) {
    return (
      <div className={`version-selector loading ${className}`}>
        <SmartLoader 
          loadingKey="fetch_versions"
          showTimeEstimate={false}
          className="selector-loader"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`version-selector error ${className}`}>
        <div className="error-message">
          <span className="error-icon">❌</span>
          Failed to load versions: {error}
        </div>
        {onRefresh && (
          <button onClick={onRefresh} className="retry-button">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className={`version-selector empty ${className}`}>
        <div className="empty-message">
          <span className="empty-icon">📦</span>
          No release versions available
        </div>
        {onRefresh && (
          <button onClick={onRefresh} className="refresh-button">
            Refresh
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`version-selector ${className}`}>
      <div className="selector-header">
        <label htmlFor="version-select" className="selector-label">
          Release Version:
        </label>
        {onRefresh && (
          <button 
            onClick={onRefresh} 
            className="refresh-button"
            title="Refresh versions"
          >
            🔄
          </button>
        )}
      </div>

      <div className="selector-container">
        <select
          id="version-select"
          value={selectedVersion || ''}
          onChange={handleVersionChange}
          className="version-select"
        >
          {!selectedVersion && (
            <option value="">Select a version...</option>
          )}
          {versions.map((version) => {
            const versionKey = version.name || version.id;
            const status = getVersionStatus(version);
            
            return (
              <option key={versionKey} value={versionKey}>
                {version.name} {getStatusIcon(status)}
                {version.issueCount ? ` (${version.issueCount} issues)` : ''}
              </option>
            );
          })}
        </select>

        {selectedVersion && (
          <div className="selected-version-info">
            {(() => {
              const version = versions.find(v => v.name === selectedVersion);
              if (!version) return null;
              
              const status = getVersionStatus(version);
              const info = getVersionInfo(version);
              
              return (
                <div className="version-details">
                  <div className="version-status">
                    <span 
                      className="status-indicator"
                      style={{ color: getStatusColor(status) }}
                    >
                      {getStatusIcon(status)} {formatters.capitalize(status)}
                    </span>
                  </div>
                  
                  {info && (
                    <div className="version-info">{info}</div>
                  )}
                  
                  {version.issueCount && (
                    <div className="version-stats">
                      <span className="issue-count">
                        📋 {version.issueCount} issues
                      </span>
                      
                      {version.completedCount && (
                        <span className="completion-rate">
                          ✅ {Math.round((version.completedCount / version.issueCount) * 100)}% complete
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <style>{`
        .version-selector {
          background: white;
          border-radius: 8px;
          padding: 16px;
          border: 1px solid #dee2e6;
          margin-bottom: 20px;
        }

        .version-selector.loading, 
        .version-selector.error, 
        .version-selector.empty {
          text-align: center;
          padding: 24px;
        }

        .selector-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .selector-label {
          font-weight: 600;
          color: #333;
          font-size: 16px;
        }

        .refresh-button {
          background: none;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          padding: 4px 8px;
          cursor: pointer;
          font-size: 14px;
          transition: background-color 0.2s;
        }

        .refresh-button:hover {
          background: #f8f9fa;
        }

        .selector-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .version-select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          font-size: 14px;
          background: white;
          cursor: pointer;
        }

        .version-select:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .selected-version-info {
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 4px;
          padding: 12px;
        }

        .version-details {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .version-status {
          display: flex;
          align-items: center;
        }

        .status-indicator {
          font-weight: 600;
          font-size: 14px;
        }

        .version-info {
          color: #6c757d;
          font-size: 13px;
        }

        .version-stats {
          display: flex;
          gap: 16px;
          font-size: 13px;
        }

        .issue-count, .completion-rate {
          color: #495057;
        }

        .error-message, .empty-message {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #6c757d;
          font-weight: 500;
        }

        .error-icon, .empty-icon {
          font-size: 20px;
        }

        .retry-button {
          background: #dc3545;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 12px;
          transition: background-color 0.2s;
        }

        .retry-button:hover {
          background: #c82333;
        }

        .selector-loader {
          margin: 12px 0;
        }
      `}</style>
    </div>
  );
};