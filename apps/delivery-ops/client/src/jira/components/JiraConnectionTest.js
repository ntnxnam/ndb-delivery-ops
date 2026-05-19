import React from 'react';
import { useJiraData } from '../hooks/useJiraData';
import { SmartLoader } from '../../shared/components/SmartLoader';

export const JiraConnectionTest = ({ className = "" }) => {
  const {
    isConnected,
    connectionStatus,
    loading,
    error,
    testConnection,
    clearCache,
    getCacheStats
  } = useJiraData();

  const cacheStats = getCacheStats();

  const getStatusColor = () => {
    if (loading) return '#ffc107';
    if (isConnected) return '#28a745';
    if (error) return '#dc3545';
    return '#6c757d';
  };

  const getStatusIcon = () => {
    if (loading) return '⏳';
    if (isConnected) return '✅';
    if (error) return '❌';
    return '🔌';
  };

  const getStatusText = () => {
    if (loading) return 'Testing connection & refreshing permissions...';
    if (isConnected) return 'Connected to JIRA';
    if (error) return 'Connection failed';
    return 'Not connected';
  };

  return (
    <div className={`jira-connection-test ${className}`}>
      {/* Connection Status */}
      <div className="connection-status">
        <div className="status-indicator">
          <span 
            className="status-icon"
            style={{ color: getStatusColor() }}
          >
            {getStatusIcon()}
          </span>
          <span className="status-text">
            {getStatusText()}
          </span>
        </div>

        <div className="connection-actions">
          <button
            onClick={testConnection}
            disabled={loading}
            className="test-button"
          >
            {loading ? 'Testing & Refreshing...' : 'Test Connection & Refresh Permissions'}
          </button>
        </div>
      </div>

      {/* Loading Indicator */}
      <SmartLoader
        loadingKey="jira_connection_test"
        showTimeEstimate={false}
        className="connection-loader"
      />

      {/* Connection Details with Permission Refresh Indicator */}
      {connectionStatus && (
        <div className={`connection-message ${connectionStatus.success ? 'success' : 'error'}`}>
          <div className="message-content">
            {connectionStatus.message}
          </div>
          {connectionStatus.permissionsRefreshed && (
            <div className="permissions-indicator">
              🔄 User permissions have been refreshed from server
            </div>
          )}
        </div>
      )}

      {/* Error Details */}
      {error && !loading && (
        <div className="error-details">
          <strong>Connection Error:</strong>
          <p>{error}</p>
          <div className="error-help">
            <strong>Common solutions:</strong>
            <ul>
              <li>Check your JIRA token is valid</li>
              <li>Ensure you have proper permissions</li>
              <li>Verify network connectivity</li>
              <li>Try the test button again (refreshes permissions)</li>
              <li>Try logging out and back in</li>
            </ul>
          </div>
        </div>
      )}

      {/* Cache Information */}
      {isConnected && (
        <div className="cache-info">
          <h4>Cache Statistics</h4>
          <div className="cache-stats">
            <div className="stat-item">
              <label>Total Entries:</label>
              <span>{cacheStats.totalEntries}</span>
            </div>
            <div className="stat-item">
              <label>Valid Entries:</label>
              <span>{cacheStats.validEntries}</span>
            </div>
            <div className="stat-item">
              <label>Expired Entries:</label>
              <span>{cacheStats.expiredEntries}</span>
            </div>
          </div>
          
          <button
            onClick={() => clearCache()}
            className="clear-cache-button"
          >
            Clear Cache
          </button>
        </div>
      )}

      <style>{`
        .jira-connection-test {
          padding: 16px;
          background: white;
          border-radius: 8px;
          border: 1px solid #dee2e6;
        }

        .connection-status {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-icon {
          font-size: 20px;
        }

        .status-text {
          font-weight: 600;
          color: #333;
        }

        .test-button {
          background: #007bff;
          color: white;
          border: none;
          padding: 6px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
        }

        .test-button:hover:not(:disabled) {
          background: #0056b3;
        }

        .test-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .connection-loader {
          margin: 12px 0;
        }

        .connection-message {
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 14px;
          margin: 12px 0;
        }

        .connection-message.success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }

        .connection-message.error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .message-content {
          margin-bottom: 4px;
        }

        .permissions-indicator {
          font-size: 13px;
          color: #0d6efd;
          font-weight: 500;
          opacity: 0.9;
          margin-top: 6px;
        }

        .error-details {
          background: #f8f9fa;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          padding: 16px;
          margin: 12px 0;
        }

        .error-details strong {
          color: #dc3545;
        }

        .error-details p {
          margin: 8px 0;
          color: #495057;
        }

        .error-help {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #dee2e6;
        }

        .error-help ul {
          margin: 8px 0 0 20px;
          color: #6c757d;
        }

        .error-help li {
          margin: 4px 0;
        }

        .cache-info {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid #dee2e6;
        }

        .cache-info h4 {
          margin: 0 0 12px 0;
          color: #333;
          font-size: 16px;
        }

        .cache-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
          margin-bottom: 12px;
        }

        .stat-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f8f9fa;
          padding: 8px 12px;
          border-radius: 4px;
        }

        .stat-item label {
          font-weight: 500;
          color: #495057;
        }

        .stat-item span {
          font-weight: 600;
          color: #007bff;
        }

        .clear-cache-button {
          background: #6c757d;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          transition: background-color 0.2s;
        }

        .clear-cache-button:hover {
          background: #5a6268;
        }
      `}</style>
    </div>
  );
};