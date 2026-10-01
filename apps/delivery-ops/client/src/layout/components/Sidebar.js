import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/hooks/useAuth';
import { usePermissions } from '../../auth/hooks/usePermissions';
import { LogoutButton } from '../../auth/components/LogoutButton';
import { useNotifications } from '../../shared/services/notificationService';
import { TAB_PERMISSIONS } from '../../auth/constants/permissions';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';
import { TeamSelector } from './TeamSelector';

/**
 * URL for the bin-packing app. The app is static-served by the backend
 * (Express on 6001 in dev, same-origin in prod) under `/bin-packing/`.
 * In dev the React dev server runs on 8888, so we must point absolutely
 * at the backend's port; otherwise the link would land on the React app
 * and 404. In prod everything is one origin, so a relative path works.
 *
 * No hardcoded `localhost` — host is read from `window.location`.
 */
function getBinPackingUrl() {
  if (typeof window === 'undefined') return '/bin-packing/';
  const isDevReactServer = window.location.port === '8888';
  if (!isDevReactServer) return '/bin-packing/';
  const backendPort =
    process.env.REACT_APP_BACKEND_PORT || '6001';
  return `${window.location.protocol}//${window.location.hostname}:${backendPort}/bin-packing/`;
}

export const Sidebar = () => {
  const location = useLocation();
  const { user, testConnectionAndRefreshPermissions } = useAuth();
  const { canAccessTab } = usePermissions();
  const { refreshVersionsAndResetDefault } = useSelectedRelease();
  const { success: showSuccess, error: showError } = useNotifications();

  // Sidebar state
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved !== null ? JSON.parse(saved) : false;
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved) : 280;
  });

  const [isMobile, setIsMobile] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Connection testing state
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);

  // Navigation items configuration
  const navigationItems = [
    {
      path: '/',
      label: 'Email Sender',
      icon: '📧',
      description: 'Send status update emails'
    },
    {
      path: '/project-status',
      label: 'Project Status',
      icon: '🚀',
      description: 'Release picker, payload table, Gantt'
    },
    {
      path: '/release-config',
      label: 'Release Config',
      icon: '📅',
      description: 'Move gate dates, view date history'
    },
    {
      path: '/release-setup',
      label: 'Release Setup',
      icon: '⚙️',
      description: 'Create / rename releases, cleanup filters'
    },
    {
      path: '/release/brief',
      label: 'Release Brief (new)',
      icon: '✨',
      description: 'Live KPI / payload / velocity snapshot (in progress)'
    },
    {
      path: '/feature-dashboard',
      label: 'Feature Dashboard',
      icon: '🧭',
      description: 'Feature payload, gates, reconciliation, and burn'
    },
    {
      path: '/release/retrospective',
      label: 'Retrospective',
      icon: '🔍',
      description: 'Gate compliance and behavior per release'
    },
    {
      path: '/generic-emailer',
      label: 'JIRA Emailer',
      icon: '📋',
      description: 'Send emails from JIRA queries'
    },
    {
      path: '/email-history',
      label: 'Email History',
      icon: '📜',
      description: 'View sent email history'
    },
    {
      path: '/sprint-report',
      label: 'Sprint Report',
      icon: '🏃',
      description: 'Sprint reporting and metrics'
    },
    {
      path: '/sos-summary',
      label: 'SoS Summary',
      icon: '📡',
      description: 'Scrum of Scrums — live Feature/Initiative status across all active releases'
    },
    {
      path: '/component-report',
      label: 'Component Report',
      icon: '📊',
      description: 'Component health, actionable metrics, deferral trends'
    },
    {
      path: '/kpis',
      label: 'KPIs',
      icon: '📈',
      description: 'KPI dashboard'
    },
    {
      path: '/chatbot',
      label: 'AI Chatbot',
      icon: '💬',
      description: 'Conversational release and ticket Q&A'
    },
    {
      path: getBinPackingUrl(),
      label: 'Bin Packing',
      icon: '📦',
      description: 'NDB project bin-packing Gantt (opens in new tab)',
      external: true,
      newTab: true
    },
    {
      path: '/team-management',
      label: 'Team Management',
      icon: '🔧',
      description: 'Add and edit teams'
    }
  ];

  // Filter navigation items based on permissions
  const visibleItems = navigationItems.filter(item => {
    const requiredPermissions = TAB_PERMISSIONS[item.path];
    
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }
    
    return canAccessTab(item.path);
  });

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('sidebar-width', sidebarWidth.toString());
  }, [sidebarWidth]);

  // Auto-collapse on mobile and track mobile state
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsCollapsed(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Resize functionality
  const MIN_WIDTH = 200;
  const MAX_WIDTH = 400;
  const COLLAPSED_WIDTH = 60;

  const handleMouseDown = (_e) => {
    if (isCollapsed || isMobile) return;
    
    setIsResizing(true);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e) => {
      const newWidth = Math.min(Math.max(e.clientX, MIN_WIDTH), MAX_WIDTH);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Touch support for mobile resize
  const handleTouchStart = (e) => {
    if (isCollapsed || isMobile) return;
    
    setIsResizing(true);
    const startX = e.touches[0].clientX;
    const startWidth = sidebarWidth;

    const handleTouchMove = (e) => {
      const deltaX = e.touches[0].clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, MIN_WIDTH), MAX_WIDTH);
      setSidebarWidth(newWidth);
    };

    const handleTouchEnd = () => {
      setIsResizing(false);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  };

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  // Test JIRA connection — on success, also re-fetches versions and re-picks
  // the default release using the GA-date logic (clears stale localStorage).
  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus(null);

    try {
      const result = await testConnectionAndRefreshPermissions();
      
      if (result.success) {
        setConnectionStatus({
          success: true,
          message: result.message + (result.permissionsRefreshed ? ' • Permissions refreshed' : '')
        });
        showSuccess(result.permissionsRefreshed ? 'JIRA connection successful • Permissions updated' : 'JIRA connection successful');
        // Re-fetch versions and reset the default release to the nearest GA date.
        refreshVersionsAndResetDefault().catch(() => {});
      } else {
        throw new Error(result.message || 'Connection test failed');
      }
    } catch (error) {
      const errorMessage = error.message || 'Connection test failed';
      setConnectionStatus({
        success: false,
        message: errorMessage
      });
      showError(errorMessage);
    } finally {
      setTestingConnection(false);
      
      // Clear status after 5 seconds
      setTimeout(() => setConnectionStatus(null), 5000);
    }
  };

  return (
    <>
      <aside 
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{ 
          width: isCollapsed ? `${COLLAPSED_WIDTH}px` : `${sidebarWidth}px` 
        }}
      >
        {/* Sidebar Header */}
        <div className="sidebar-header">
          <button 
            className="sidebar-toggle"
            onClick={toggleSidebar}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="toggle-icon">{isCollapsed ? '»' : '«'}</span>
          </button>
          
          {!isCollapsed && (
            <div className="app-title-section">
              <h1 className="app-title">NDB Status Update Sender</h1>
              {!isMobile && (
                <div className="resize-hint">
                  <span className="resize-hint-text">Drag edge to resize</span>
                </div>
              )}
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="team-selector-section">
            <TeamSelector variant="sidebar" id="sidebar-team-select" />
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {visibleItems.map((item) => (
            item.external ? (
              <a
                key={item.path}
                href={item.path}
                target={item.newTab ? '_blank' : undefined}
                rel={item.newTab ? 'noopener noreferrer' : undefined}
                className="nav-item nav-item-external"
                title={isCollapsed ? `${item.description}` : item.description}
              >
                <span className="nav-icon">{item.icon}</span>
                {!isCollapsed && (
                  <>
                    <span className="nav-label">{item.label}</span>
                    {item.newTab && <span className="nav-newtab-indicator">↗</span>}
                  </>
                )}
              </a>
            ) : (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                title={isCollapsed ? `${item.description}` : item.description}
              >
                <span className="nav-icon">{item.icon}</span>
                {!isCollapsed && <span className="nav-label">{item.label}</span>}
              </Link>
            )
          ))}
        </nav>

        {/* User Info and Actions */}
        <div className="sidebar-footer">
          {!isCollapsed && user && (
            <div className="user-info">
              <span className="user-label">Logged in as:</span>
              <strong className="username">{user.username}</strong>
            </div>
          )}

          <div className="sidebar-actions">
            <button
              type="button"
              onClick={testConnection}
              disabled={testingConnection}
              className="test-connection-button"
              title="Test JIRA connection and token validity"
            >
              <span className="action-icon">🔗</span>
              {!isCollapsed && <span className="action-label">
                {testingConnection ? 'Testing...' : 'Test Connection'}
              </span>}
            </button>

            <LogoutButton 
              className="logout-button"
              showIcon={true}
              showText={!isCollapsed}
            />
          </div>

          {!isCollapsed && connectionStatus && (
            <div className={`connection-status ${connectionStatus.success ? 'success' : 'error'}`}>
              {connectionStatus.message}
            </div>
          )}
        </div>

        {/* Resize Handle */}
        {!isCollapsed && !isMobile && (
          <div 
            className="resize-handle"
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            title="Drag to resize sidebar"
          />
        )}
      </aside>

      {/* Mobile Overlay */}
      {!isCollapsed && isMobile && (
        <div className="sidebar-overlay" onClick={() => setIsCollapsed(true)} />
      )}

      <style>{`
        .sidebar {
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          background: #343a40;
          color: white;
          display: flex;
          flex-direction: column;
          box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
          transition: transform 0.3s ease;
          z-index: 1000;
          overflow: hidden;
          min-width: 200px;
          max-width: 400px;
        }

        /* When collapsed, the resize range no longer applies; the inline
           width is 60px and min/max-width must not fight it, otherwise the
           sidebar renders wider than the 60px margin reserved by Layout. */
        .sidebar.collapsed {
          min-width: 60px;
          max-width: 60px;
        }

        .sidebar:not(.resizing) {
          transition: width 0.3s ease, transform 0.3s ease;
        }

        .sidebar.resizing {
          transition: none;
        }

        .sidebar-header {
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid #495057;
          flex-shrink: 0;
        }

        .sidebar-toggle {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 6px;
          border-radius: 4px;
          font-size: 16px;
          font-weight: bold;
          transition: background-color 0.2s;
          flex-shrink: 0;
        }

        .sidebar-toggle:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .toggle-icon {
          display: block;
          width: 16px;
          text-align: center;
        }

        .app-title-section {
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .app-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: white;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .resize-hint {
          opacity: 0;
          transition: opacity 0.2s ease;
        }

        .sidebar:hover .resize-hint {
          opacity: 1;
        }

        .resize-hint-text {
          font-size: 11px;
          color: #adb5bd;
          font-style: italic;
        }

        .team-selector-section {
          padding: 16px;
          border-bottom: 1px solid #495057;
          flex-shrink: 0;
        }

        .team-selector {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .team-selector label {
          color: #ccc;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .team-select {
          padding: 8px;
          border-radius: 4px;
          border: 1px solid #6c757d;
          background: white;
          color: #333;
          font-size: 14px;
          width: 100%;
        }

        .team-select:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .team-select:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .team-select.transitioning {
          background-color: #f8f9fa;
        }

        .team-choose-btn {
          width: 100%;
          min-height: 2rem;
          padding: 8px;
          margin-top: 0;
          background: #0d6efd;
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .team-choose-btn:hover:not(:disabled) {
          background: #0b5ed7;
        }

        .team-choose-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .transition-indicator {
          margin-top: 4px;
          font-size: 12px;
          animation: pulse 1.5s ease-in-out infinite;
        }

        .teams-loading-section {
          padding: 16px;
          border-bottom: 1px solid #495057;
        }

        .teams-loading {
          color: #ccc;
          font-size: 14px;
          font-style: italic;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .sidebar-nav {
          flex: 1;
          padding: 16px 0;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #6c757d #495057;
        }

        .sidebar-nav::-webkit-scrollbar {
          width: 6px;
        }

        .sidebar-nav::-webkit-scrollbar-track {
          background: #495057;
        }

        .sidebar-nav::-webkit-scrollbar-thumb {
          background: #6c757d;
          border-radius: 3px;
        }

        .sidebar-nav::-webkit-scrollbar-thumb:hover {
          background: #adb5bd;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          color: #adb5bd;
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s ease;
          border-left: 3px solid transparent;
          min-height: 48px;
          box-sizing: border-box;
        }

        .collapsed .nav-item {
          justify-content: center;
          padding: 12px;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #f8f9fa;
          border-left-color: rgba(255, 255, 255, 0.3);
        }

        .nav-item.active {
          background: rgba(0, 123, 255, 0.15);
          color: #87ceeb;
          border-left-color: #007bff;
          font-weight: 600;
        }

        .nav-icon {
          font-size: 18px;
          flex-shrink: 0;
          width: 24px;
          text-align: center;
        }

        .nav-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-newtab-indicator {
          margin-left: auto;
          font-size: 12px;
          color: #6c757d;
          opacity: 0.7;
        }

        .nav-item-external:hover .nav-newtab-indicator {
          color: #f8f9fa;
          opacity: 1;
        }

        .sidebar-footer {
          padding: 16px;
          border-top: 1px solid #495057;
          flex-shrink: 0;
        }

        .user-info {
          margin-bottom: 16px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
        }

        .user-label {
          display: block;
          color: #ccc;
          font-size: 12px;
          margin-bottom: 4px;
        }

        .username {
          color: white;
          font-size: 14px;
        }

        .sidebar-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .collapsed .sidebar-actions {
          align-items: center;
        }

        .test-connection-button,
        .logout-button {
          background: #007bff;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: background-color 0.2s;
          display: flex;
          align-items: center;
          gap: 6px;
          justify-content: center;
          min-height: 36px;
        }

        .collapsed .test-connection-button,
        .collapsed .logout-button {
          width: 36px;
          padding: 8px;
        }

        .logout-button {
          background: #dc3545;
        }

        .test-connection-button:hover:not(:disabled) {
          background: #0056b3;
        }

        .logout-button:hover {
          background: #c82333;
        }

        .test-connection-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .action-icon {
          font-size: 14px;
          flex-shrink: 0;
        }

        .action-label {
          white-space: nowrap;
        }

        .connection-status {
          margin-top: 8px;
          padding: 6px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
          text-align: center;
        }

        .connection-status.success {
          background: #d4edda;
          color: #155724;
        }

        .connection-status.error {
          background: #f8d7da;
          color: #721c24;
        }

        .resize-handle {
          position: absolute;
          top: 0;
          right: -3px;
          width: 6px;
          height: 100%;
          background: transparent;
          cursor: ew-resize;
          z-index: 1001;
        }

        .resize-handle:hover {
          background: rgba(0, 123, 255, 0.3);
        }

        .resize-handle:active {
          background: rgba(0, 123, 255, 0.5);
        }

        .sidebar-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 999;
        }

        /* Mobile responsive behavior */
        @media (max-width: 768px) {
          .sidebar {
            transform: translateX(-100%);
          }

          .sidebar:not(.collapsed) {
            transform: translateX(0);
          }
        }

        /* Ensure sidebar doesn't interfere with very small screens */
        @media (max-width: 480px) {
          .sidebar:not(.collapsed) {
            width: 100%;
            max-width: 320px;
          }
        }
      `}</style>
    </>
  );
};