import React from 'react';
import { useLoading } from '../hooks/useLoading';

export const SmartLoader = ({ 
  loadingKey,
  stages = [],
  showTimeEstimate = true,
  showCancelButton = false,
  onCancel,
  className = ""
}) => {
  const { getLoadingState } = useLoading();
  const state = getLoadingState(loadingKey);

  if (!state?.isLoading && !state?.error) {
    return null;
  }

  const elapsed = state ? Date.now() - state.startTime : 0;
  const estimatedRemaining = state?.estimatedTime ? 
    Math.max(0, state.estimatedTime - elapsed) : null;

  const formatTime = (ms) => {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className={`smart-loader ${className}`}>
      {/* Error State */}
      {state?.error && (
        <div className="smart-loader-error">
          <div className="error-icon">⚠️</div>
          <div className="error-message">{state.error}</div>
          {onCancel && (
            <button onClick={onCancel} className="retry-button">
              Retry
            </button>
          )}
        </div>
      )}

      {/* Loading State */}
      {state?.isLoading && (
        <>
          {/* Progress Bar */}
          {state.showProgress && (
            <div className="progress-container">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${state.progress}%` }}
                />
              </div>
              <div className="progress-percentage">
                {Math.round(state.progress)}%
              </div>
            </div>
          )}

          {/* Loading Info */}
          <div className="loading-info">
            <div className="loading-message">
              <span className="loading-icon">⏳</span>
              {state.message}
            </div>
            
            {showTimeEstimate && estimatedRemaining && (
              <div className="time-estimate">
                ~{formatTime(estimatedRemaining)} remaining
              </div>
            )}
          </div>

          {/* Stage Indicators */}
          {stages.length > 0 && (
            <div className="stage-indicators">
              {stages.map((stage, _index) => (
                <div 
                  key={stage}
                  className={`stage ${state.stage === stage.toLowerCase() ? 'active' : ''}`}
                >
                  <div className="stage-dot"></div>
                  <div className="stage-label">{stage}</div>
                </div>
              ))}
            </div>
          )}

          {/* Cancel Button */}
          {showCancelButton && onCancel && (
            <button onClick={onCancel} className="cancel-button">
              Cancel
            </button>
          )}
        </>
      )}

      <style>{`
        .smart-loader {
          padding: 16px;
          border-radius: 8px;
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          margin: 12px 0;
        }

        .smart-loader-error {
          display: flex;
          align-items: center;
          gap: 12px;
          color: #dc3545;
        }

        .error-icon {
          font-size: 24px;
        }

        .error-message {
          flex: 1;
          font-weight: 500;
        }

        .retry-button {
          background: #dc3545;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }

        .retry-button:hover {
          background: #c82333;
        }

        .progress-container {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .progress-bar {
          flex: 1;
          height: 8px;
          background: #e9ecef;
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #007bff, #0056b3);
          transition: width 0.3s ease;
        }

        .progress-percentage {
          font-size: 12px;
          font-weight: 600;
          color: #6c757d;
          min-width: 40px;
        }

        .loading-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .loading-message {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
          color: #495057;
        }

        .loading-icon {
          animation: spin 2s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .time-estimate {
          font-size: 12px;
          color: #6c757d;
        }

        .stage-indicators {
          display: flex;
          gap: 16px;
          align-items: center;
          margin-bottom: 12px;
        }

        .stage {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #6c757d;
        }

        .stage.active {
          color: #007bff;
          font-weight: 600;
        }

        .stage-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #dee2e6;
        }

        .stage.active .stage-dot {
          background: #007bff;
        }

        .cancel-button {
          background: #6c757d;
          color: white;
          border: none;
          padding: 6px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }

        .cancel-button:hover {
          background: #5a6268;
        }
      `}</style>
    </div>
  );
};