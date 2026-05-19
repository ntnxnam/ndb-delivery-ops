import React, { useState, useEffect, useCallback } from 'react';
import { formatters } from '../utils/formatters';

export const PerformanceMonitor = ({ 
  showMetrics = false,
  enableLogging = true,
  className = "" 
}) => {
  const [metrics, setMetrics] = useState({
    pageLoad: null,
    apiCalls: [],
    memoryUsage: null,
    renderCount: 0,
    lastRender: null
  });
  
  const [isVisible, setIsVisible] = useState(showMetrics);

  // Track page load performance
  useEffect(() => {
    if (typeof performance !== 'undefined' && performance.timing) {
      const loadTime = performance.timing.loadEventEnd - performance.timing.navigationStart;
      
      setMetrics(prev => ({
        ...prev,
        pageLoad: {
          total: loadTime,
          domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
          firstPaint: performance.getEntriesByType?.('paint')?.find(entry => entry.name === 'first-paint')?.startTime,
          firstContentfulPaint: performance.getEntriesByType?.('paint')?.find(entry => entry.name === 'first-contentful-paint')?.startTime
        }
      }));
    }
  }, []);

  // Track memory usage
  useEffect(() => {
    const updateMemoryUsage = () => {
      if (performance.memory) {
        setMetrics(prev => ({
          ...prev,
          memoryUsage: {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize,
            limit: performance.memory.jsHeapSizeLimit,
            timestamp: Date.now()
          }
        }));
      }
    };

    updateMemoryUsage();
    const interval = setInterval(updateMemoryUsage, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Track render count - only on mount and unmount
  useEffect(() => {
    setMetrics(prev => ({
      ...prev,
      renderCount: prev.renderCount + 1,
      lastRender: Date.now()
    }));
  }, []); // Empty dependencies to run only once


  // Calculate statistics
  const stats = {
    avgApiTime: metrics.apiCalls.length > 0 
      ? metrics.apiCalls.reduce((sum, call) => sum + call.duration, 0) / metrics.apiCalls.length 
      : 0,
    slowApiCalls: metrics.apiCalls.filter(call => call.duration > 5000).length,
    failedApiCalls: metrics.apiCalls.filter(call => !call.success).length,
    memoryUsagePercent: metrics.memoryUsage 
      ? (metrics.memoryUsage.used / metrics.memoryUsage.total) * 100 
      : 0
  };

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="perf-monitor-toggle"
        title="Show performance metrics"
      >
        📊
      </button>
    );
  }

  return (
    <div className={`performance-monitor ${className}`}>
      <div className="monitor-header">
        <h4>Performance Monitor</h4>
        <button
          onClick={() => setIsVisible(false)}
          className="close-button"
          title="Hide performance metrics"
        >
          ×
        </button>
      </div>

      <div className="metrics-grid">
        {/* Page Load Metrics */}
        {metrics.pageLoad && (
          <div className="metric-section">
            <h5>Page Load</h5>
            <div className="metric-item">
              <span>Total Load Time:</span>
              <span>{formatters.duration(metrics.pageLoad.total)}</span>
            </div>
            <div className="metric-item">
              <span>DOM Ready:</span>
              <span>{formatters.duration(metrics.pageLoad.domReady)}</span>
            </div>
            {metrics.pageLoad.firstPaint && (
              <div className="metric-item">
                <span>First Paint:</span>
                <span>{formatters.duration(metrics.pageLoad.firstPaint)}</span>
              </div>
            )}
          </div>
        )}

        {/* API Performance */}
        {metrics.apiCalls.length > 0 && (
          <div className="metric-section">
            <h5>API Performance</h5>
            <div className="metric-item">
              <span>Average Response:</span>
              <span>{formatters.duration(stats.avgApiTime)}</span>
            </div>
            <div className="metric-item">
              <span>Total Calls:</span>
              <span>{metrics.apiCalls.length}</span>
            </div>
            <div className="metric-item">
              <span>Failed Calls:</span>
              <span className={stats.failedApiCalls > 0 ? 'error' : ''}>{stats.failedApiCalls}</span>
            </div>
            <div className="metric-item">
              <span>Slow Calls (>5s):</span>
              <span className={stats.slowApiCalls > 0 ? 'warning' : ''}>{stats.slowApiCalls}</span>
            </div>
          </div>
        )}

        {/* Memory Usage */}
        {metrics.memoryUsage && (
          <div className="metric-section">
            <h5>Memory Usage</h5>
            <div className="metric-item">
              <span>Used:</span>
              <span>{formatters.fileSize(metrics.memoryUsage.used)}</span>
            </div>
            <div className="metric-item">
              <span>Total:</span>
              <span>{formatters.fileSize(metrics.memoryUsage.total)}</span>
            </div>
            <div className="metric-item">
              <span>Usage:</span>
              <span className={stats.memoryUsagePercent > 80 ? 'warning' : ''}>
                {formatters.percentage(stats.memoryUsagePercent)}
              </span>
            </div>
          </div>
        )}

        {/* Render Performance */}
        <div className="metric-section">
          <h5>Render Info</h5>
          <div className="metric-item">
            <span>Render Count:</span>
            <span>{metrics.renderCount}</span>
          </div>
          <div className="metric-item">
            <span>Last Render:</span>
            <span>{formatters.relativeTime(metrics.lastRender)}</span>
          </div>
        </div>
      </div>

      {/* Recent API Calls */}
      {metrics.apiCalls.length > 0 && (
        <div className="api-calls-section">
          <h5>Recent API Calls</h5>
          <div className="api-calls-list">
            {metrics.apiCalls.slice(-5).reverse().map(call => (
              <div key={call.id} className="api-call-item">
                <div className="api-call-url">
                  <span className={`status-icon ${call.success ? 'success' : 'error'}`}>
                    {call.success ? '✅' : '❌'}
                  </span>
                  {call.url.length > 30 ? `...${call.url.slice(-30)}` : call.url}
                </div>
                <div className="api-call-time">
                  {formatters.duration(call.duration)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .perf-monitor-toggle {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: #007bff;
          color: white;
          font-size: 16px;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          z-index: 1000;
          transition: background-color 0.2s;
        }

        .perf-monitor-toggle:hover {
          background: #0056b3;
        }

        .performance-monitor {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 350px;
          max-height: 500px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          overflow: hidden;
        }

        .monitor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #f8f9fa;
          border-bottom: 1px solid #dee2e6;
        }

        .monitor-header h4 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #333;
        }

        .close-button {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          color: #6c757d;
          padding: 0;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .close-button:hover {
          color: #333;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          padding: 16px;
          max-height: 300px;
          overflow-y: auto;
        }

        .metric-section {
          background: #f8f9fa;
          border-radius: 4px;
          padding: 12px;
        }

        .metric-section h5 {
          margin: 0 0 8px 0;
          font-size: 12px;
          font-weight: 600;
          color: #495057;
          text-transform: uppercase;
        }

        .metric-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          margin-bottom: 4px;
        }

        .metric-item:last-child {
          margin-bottom: 0;
        }

        .metric-item span:first-child {
          color: #6c757d;
        }

        .metric-item span:last-child {
          color: #333;
          font-weight: 500;
        }

        .metric-item .error {
          color: #dc3545 !important;
        }

        .metric-item .warning {
          color: #fd7e14 !important;
        }

        .api-calls-section {
          border-top: 1px solid #dee2e6;
          padding: 12px 16px;
        }

        .api-calls-section h5 {
          margin: 0 0 8px 0;
          font-size: 12px;
          font-weight: 600;
          color: #495057;
          text-transform: uppercase;
        }

        .api-calls-list {
          max-height: 120px;
          overflow-y: auto;
        }

        .api-call-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
          margin-bottom: 4px;
          padding: 4px 0;
        }

        .api-call-url {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
          min-width: 0;
        }

        .status-icon {
          font-size: 8px;
          flex-shrink: 0;
        }

        .api-call-time {
          color: #6c757d;
          font-weight: 500;
          flex-shrink: 0;
          margin-left: 8px;
        }

        @media (max-width: 768px) {
          .performance-monitor {
            width: calc(100vw - 40px);
            max-width: 350px;
          }

          .metrics-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

// Hook to integrate with the performance monitor
export const usePerformanceTracking = () => {
  const [performanceData, setPerformanceData] = useState([]);

  const trackOperation = useCallback((name, startTime, endTime, success = true, metadata = {}) => {
    const entry = {
      name,
      duration: endTime - startTime,
      success,
      timestamp: endTime,
      metadata,
      id: `${name}_${endTime}`
    };

    setPerformanceData(prev => [
      ...prev.slice(-49), // Keep last 50 entries
      entry
    ]);

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`${success ? '✅' : '❌'} ${name}: ${entry.duration}ms`, metadata);
    }

    return entry;
  }, []);

  const getStatistics = useCallback(() => {
    if (performanceData.length === 0) return null;

    const successful = performanceData.filter(entry => entry.success);
    const failed = performanceData.filter(entry => !entry.success);
    
    return {
      totalOperations: performanceData.length,
      successfulOperations: successful.length,
      failedOperations: failed.length,
      averageDuration: successful.length > 0 
        ? successful.reduce((sum, entry) => sum + entry.duration, 0) / successful.length 
        : 0,
      slowOperations: successful.filter(entry => entry.duration > 5000).length,
      recentOperations: performanceData.slice(-10)
    };
  }, [performanceData]);

  return {
    trackOperation,
    getStatistics,
    performanceData
  };
};