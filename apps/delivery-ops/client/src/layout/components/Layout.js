import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { ToastContainer } from '../../shared/components/Toast';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';
import { useReleaseData } from '../../contexts/ReleaseDataContext';

function JiraConnectivityBanner() {
  const { jiraUnreachable: unreachableFromSelected } = useSelectedRelease();
  const { jiraUnreachable: unreachableFromData } = useReleaseData();
  const unreachable = unreachableFromSelected || unreachableFromData;

  if (!unreachable) return null;

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 1100,
      background: '#fff3cd',
      borderBottom: '1px solid #ffc107',
      padding: '8px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      fontSize: '13px',
      color: '#856404',
      fontWeight: 500,
    }}>
      <span style={{ fontSize: '16px' }}>⚠️</span>
      <span>
        Cannot reach JIRA servers — your data may be stale.
        Please check your <strong>VPN connection</strong> and refresh.
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginLeft: 'auto',
          background: '#ffc107',
          border: 'none',
          borderRadius: '4px',
          padding: '3px 12px',
          fontSize: '12px',
          fontWeight: 600,
          color: '#333',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );
}

export const Layout = ({ children, wide = false }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved !== null ? JSON.parse(saved) : false;
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved) : 280;
  });

  // Listen for sidebar state changes
  useEffect(() => {
    const handleStorageChange = () => {
      const savedCollapsed = localStorage.getItem('sidebar-collapsed');
      const savedWidth = localStorage.getItem('sidebar-width');
      
      setSidebarCollapsed(savedCollapsed !== null ? JSON.parse(savedCollapsed) : false);
      setSidebarWidth(savedWidth ? parseInt(savedWidth) : 280);
    };

    // Listen for changes in localStorage (from other components)
    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically for changes from same window
    const interval = setInterval(handleStorageChange, 100);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      
      <main 
        className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}${wide ? ' main-content-wide' : ''}`}
        style={{
          marginLeft: sidebarCollapsed ? '60px' : `${sidebarWidth}px`
        }}
      >
        <JiraConnectivityBanner />
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
      
      {/* Global toast notifications */}
      <ToastContainer position="top-right" />

      <style>{`
        .app-layout {
          min-height: 100vh;
          display: flex;
          background: #f8f9fa;
        }

        .main-content {
          flex: 1;
          padding: 24px;
          transition: margin-left 0.3s ease;
          min-height: 100vh;
          box-sizing: border-box;
        }

        /* Container for content with max-width */
        .main-content > * {
          max-width: 1200px;
          margin-left: auto;
          margin-right: auto;
          margin-bottom: 24px;
          width: 100%;
          box-sizing: border-box;
        }

        .main-content.main-content-wide > * {
          max-width: 1400px;
        }

        .main-content > *:last-child {
          margin-bottom: 0;
        }

        /* Mobile responsive behavior */
        @media (max-width: 768px) {
          .main-content {
            margin-left: 0;
            padding: 16px;
          }

          .main-content.sidebar-collapsed {
            margin-left: 0;
          }

          .main-content > * {
            margin-bottom: 16px;
          }
        }

        @media (max-width: 576px) {
          .main-content {
            padding: 12px;
          }
        }

        /* Ensure content is accessible when sidebar is open on mobile */
        @media (max-width: 768px) {
          .main-content.sidebar-expanded {
            pointer-events: none;
          }
        }
      `}</style>
    </div>
  );
};