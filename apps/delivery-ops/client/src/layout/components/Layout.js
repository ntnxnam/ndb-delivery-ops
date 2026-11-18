import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { ToastContainer } from '../../shared/components/Toast';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import './Layout.css';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';
import { useReleaseData } from '../../contexts/ReleaseDataContext';
import { useTeam } from '../../contexts/TeamContext';

function JiraConnectivityBanner() {
  const { jiraUnreachable: unreachableFromSelected } = useSelectedRelease();
  const { jiraUnreachable: unreachableFromData } = useReleaseData();
  const unreachable = unreachableFromSelected || unreachableFromData;

  if (!unreachable) return null;

  return (
    <div className="jira-banner">
      <span className="jira-banner__icon">⚠️</span>
      <span>
        Cannot reach JIRA servers — your data may be stale.
        Please check your <strong>VPN connection</strong> and refresh.
      </span>
      <button onClick={() => window.location.reload()} className="jira-banner__retry">
        Retry
      </button>
    </div>
  );
}

export const Layout = ({ children, wide = false, fluid = false }) => {
  const { selectedTeamId, teamEpoch } = useTeam();
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

  const widthClass = fluid
    ? ' main-content-fluid'
    : wide
      ? ' main-content-wide'
      : '';

  return (
    <div className="app-layout">
      <Sidebar />
      
      <main 
        className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}${widthClass}`}
        style={{
          marginLeft: sidebarCollapsed ? '60px' : `${sidebarWidth}px`
        }}
      >
        <JiraConnectivityBanner />
        <ErrorBoundary>
          <div key={`${selectedTeamId || 'none'}:${teamEpoch}`}>
            {children}
          </div>
        </ErrorBoundary>
      </main>
      
      {/* Global toast notifications */}
      <ToastContainer position="top-right" />

    </div>
  );
};