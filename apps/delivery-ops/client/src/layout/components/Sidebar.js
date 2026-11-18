import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  SlidersHorizontal,
  Layers,
  BrainCircuit,
  Kanban,
  Timer,
  BarChart2,
  Wrench,
  Users,
  ChevronRight,
  Link2,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '../../auth/hooks/useAuth';
import { usePermissions } from '../../auth/hooks/usePermissions';
import { LogoutButton } from '../../auth/components/LogoutButton';
import { useNotifications } from '../../shared/services/notificationService';
import { TAB_PERMISSIONS } from '../../auth/constants/permissions';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';
import { TeamSelector } from './TeamSelector';
import {
  SIDEBAR_NAV_GROUPS,
  isNavItemActive,
  findActiveGroupId,
} from '../utils/sidebarNavConfig';

const GROUP_ICONS = {
  SlidersHorizontal,
  Layers,
  BrainCircuit,
  Kanban,
  Timer,
  BarChart2,
  Wrench,
  Users,
};

const ICON_SIZE = 16;
const OPEN_GROUPS_KEY = 'sidebar-open-groups';

function readOpenGroups() {
  try {
    const saved = localStorage.getItem(OPEN_GROUPS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

export const Sidebar = () => {
  const location = useLocation();
  const { user, testConnectionAndRefreshPermissions } = useAuth();
  const { canAccessTab } = usePermissions();
  const { refreshVersionsAndResetDefault } = useSelectedRelease();
  const { success: showSuccess, error: showError } = useNotifications();

  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved !== null ? JSON.parse(saved) : false;
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved, 10) : 280;
  });

  const [isMobile, setIsMobile] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [openGroups, setOpenGroups] = useState(readOpenGroups);

  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);

  const itemVisible = useCallback(
    (item) => {
      if (item.external) return true;
      const requiredPermissions = TAB_PERMISSIONS[item.path];
      if (!requiredPermissions || requiredPermissions.length === 0) {
        return true;
      }
      return canAccessTab(item.path);
    },
    [canAccessTab]
  );

  const visibleGroups = useMemo(
    () =>
      SIDEBAR_NAV_GROUPS.map((group) => ({
        ...group,
        children: group.children.filter(itemVisible),
      })).filter((group) => group.children.length > 0),
    [itemVisible]
  );

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    localStorage.setItem('sidebar-width', sidebarWidth.toString());
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  // Auto-expand the group that owns the active route
  useEffect(() => {
    const activeId = findActiveGroupId(location.pathname, SIDEBAR_NAV_GROUPS);
    if (!activeId) return;
    setOpenGroups((prev) =>
      prev[activeId] ? prev : { ...prev, [activeId]: true }
    );
  }, [location.pathname]);

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

  const toggleGroup = (groupId) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

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

  const handleTouchStart = (e) => {
    if (isCollapsed || isMobile) return;

    setIsResizing(true);
    const startX = e.touches[0].clientX;
    const startWidth = sidebarWidth;

    const handleTouchMove = (touchEvent) => {
      const deltaX = touchEvent.touches[0].clientX - startX;
      const newWidth = Math.min(
        Math.max(startWidth + deltaX, MIN_WIDTH),
        MAX_WIDTH
      );
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

  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus(null);

    try {
      const result = await testConnectionAndRefreshPermissions();

      if (result.success) {
        setConnectionStatus({
          success: true,
          message:
            result.message +
            (result.permissionsRefreshed ? ' • Permissions refreshed' : ''),
        });
        showSuccess(
          result.permissionsRefreshed
            ? 'JIRA connection successful • Permissions updated'
            : 'JIRA connection successful'
        );
        refreshVersionsAndResetDefault().catch(() => {});
      } else {
        throw new Error(result.message || 'Connection test failed');
      }
    } catch (error) {
      const errorMessage = error.message || 'Connection test failed';
      setConnectionStatus({
        success: false,
        message: errorMessage,
      });
      showError(errorMessage);
    } finally {
      setTestingConnection(false);
      setTimeout(() => setConnectionStatus(null), 5000);
    }
  };

  const renderNavItem = (item) => {
    const active = !item.external && isNavItemActive(location.pathname, item.path);
    const title = item.description || item.label;

    if (item.external) {
      return (
        <a
          key={item.path}
          href={item.path}
          target={item.newTab ? '_blank' : undefined}
          rel={item.newTab ? 'noopener noreferrer' : undefined}
          className="nav-item nav-item-child nav-item-external"
          title={title}
        >
          <span className="nav-label">{item.label}</span>
          {item.newTab && (
            <span className="nav-newtab-indicator" aria-hidden="true">
              ↗
            </span>
          )}
        </a>
      );
    }

    return (
      <Link
        key={item.path}
        to={item.path}
        className={`nav-item nav-item-child ${active ? 'active' : ''}`}
        title={title}
      >
        <span className="nav-label">{item.label}</span>
      </Link>
    );
  };

  const handleCollapsedGroupClick = (groupId) => {
    setIsCollapsed(false);
    setOpenGroups((prev) => ({ ...prev, [groupId]: true }));
  };

  return (
    <>
      <aside
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{
          width: isCollapsed ? `${COLLAPSED_WIDTH}px` : `${sidebarWidth}px`,
        }}
      >
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="toggle-icon">{isCollapsed ? '»' : '«'}</span>
          </button>

          {!isCollapsed && (
            <div className="app-title-section">
              <h1 className="app-title">Nutanix Lighthouse</h1>
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

        <nav className="sidebar-nav" aria-label="Primary">
          {visibleGroups.map((group) => {
            const Icon = GROUP_ICONS[group.icon] || Layers;
            const isOpen = Boolean(openGroups[group.id]);
            const groupHasActive = group.children.some(
              (child) =>
                !child.external &&
                isNavItemActive(location.pathname, child.path)
            );

            const groupTitle = group.wip ? `${group.label} (WIP)` : group.label;

            if (isCollapsed) {
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`nav-group-collapsed ${groupHasActive ? 'has-active' : ''} ${group.wip ? 'is-wip' : ''}`}
                  title={groupTitle}
                  onClick={() => handleCollapsedGroupClick(group.id)}
                  aria-label={`Expand ${groupTitle}`}
                >
                  <Icon size={ICON_SIZE} strokeWidth={1.75} aria-hidden="true" />
                </button>
              );
            }

            return (
              <div
                key={group.id}
                className={`nav-group ${isOpen ? 'open' : ''} ${groupHasActive ? 'has-active' : ''} ${group.wip ? 'is-wip' : ''}`}
              >
                <button
                  type="button"
                  className="nav-group-header"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${group.id}`}
                >
                  <Icon
                    size={ICON_SIZE}
                    strokeWidth={1.75}
                    className="nav-group-icon"
                    aria-hidden="true"
                  />
                  <span className="nav-group-label">{group.label}</span>
                  {group.wip && (
                    <span className="nav-group-wip-badge" title="Work in progress">
                      WIP
                    </span>
                  )}
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className={`nav-group-caret ${isOpen ? 'open' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <div
                    id={`nav-group-${group.id}`}
                    className="nav-group-children"
                    role="group"
                    aria-label={groupTitle}
                  >
                    {group.children.map(renderNavItem)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {!isCollapsed && (
            <a href="/docs/" target="_blank" rel="noopener noreferrer" className="sidebar-docs-link" title="Open Lighthouse documentation"><BookOpen size={14} strokeWidth={1.75} aria-hidden="true" /> Lighthouse Documentation</a>
          )}
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
              <Link2 size={ICON_SIZE} strokeWidth={1.75} className="action-icon-svg" aria-hidden="true" />
              {!isCollapsed && (
                <span className="action-label">
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </span>
              )}
            </button>

            <LogoutButton
              className="logout-button"
              showIcon={true}
              showText={!isCollapsed}
            />
          </div>

          {!isCollapsed && connectionStatus && (
            <div
              className={`connection-status ${connectionStatus.success ? 'success' : 'error'}`}
            >
              {connectionStatus.message}
            </div>
          )}
        </div>

        {!isCollapsed && !isMobile && (
          <div
            className="resize-handle"
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            title="Drag to resize sidebar"
          />
        )}
      </aside>

      {!isCollapsed && isMobile && (
        <div className="sidebar-overlay" onClick={() => setIsCollapsed(true)} />
      )}

      <style>{`
        .sidebar {
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          background: var(--ds-surface, #1a2332);
          color: var(--ds-text, #e6edf3);
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--ds-border, #2d3a4d);
          box-shadow: var(--ds-shadow-card, 2px 0 8px rgba(0, 0, 0, 0.4));
          transition: transform 0.3s ease;
          z-index: 1000;
          overflow: hidden;
          min-width: 200px;
          max-width: 400px;
        }

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
          border-bottom: 1px solid var(--ds-border, #2d3a4d);
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
          border-bottom: 1px solid var(--ds-border, #2d3a4d);
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
          padding: 0.5rem 0;
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

        .nav-group {
          margin-bottom: 0.125rem;
        }

        .nav-group-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.5rem 0.75rem;
          min-height: 2rem;
          background: none;
          border: none;
          border-left: 3px solid transparent;
          color: var(--ds-muted, #8b949e);
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          cursor: pointer;
          text-align: left;
          box-sizing: border-box;
        }

        .nav-group-header:hover {
          background: var(--ds-accent-soft, rgba(88, 166, 255, 0.12));
          color: var(--ds-text-strong, #f0f6fc);
        }

        .nav-group.has-active > .nav-group-header {
          color: var(--ds-accent, #58a6ff);
          border-left-color: var(--ds-accent, #58a6ff);
        }

        .nav-group-icon {
          flex-shrink: 0;
          opacity: 0.9;
        }

        .nav-group-label {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-group-wip-badge {
          flex-shrink: 0;
          padding: 0.1rem 0.35rem;
          border-radius: 0.2rem;
          font-size: 0.625rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          line-height: 1.2;
          text-transform: uppercase;
          color: #212529;
          background: #ffc107;
        }

        .nav-group-collapsed.is-wip {
          color: #ffc107;
        }

        .nav-group-caret {
          flex-shrink: 0;
          opacity: 0.7;
          transition: transform 0.15s ease;
        }

        .nav-group-caret.open {
          transform: rotate(90deg);
        }

        .nav-group-children {
          display: flex;
          flex-direction: column;
          padding-bottom: 0.25rem;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.75rem 0.375rem 2.25rem;
          color: var(--ds-muted, #8b949e);
          text-decoration: none;
          font-size: 0.8125rem;
          font-weight: 500;
          transition: background-color 0.15s ease, color 0.15s ease;
          border-left: 3px solid transparent;
          min-height: 2rem;
          box-sizing: border-box;
          border-radius: 0 var(--ds-radius-sm, 4px) var(--ds-radius-sm, 4px) 0;
        }

        .nav-item:hover {
          background: var(--ds-accent-soft, rgba(88, 166, 255, 0.12));
          color: var(--ds-text, #e6edf3);
          border-left-color: var(--ds-accent-border, rgba(88, 166, 255, 0.4));
        }

        .nav-item.active {
          background: var(--ds-accent-soft, rgba(88, 166, 255, 0.12));
          color: var(--ds-accent, #58a6ff);
          border-left-color: var(--ds-accent, #58a6ff);
          font-weight: 600;
        }

        .nav-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-newtab-indicator {
          margin-left: auto;
          font-size: 0.75rem;
          color: #6c757d;
          opacity: 0.7;
        }

        .nav-item-external:hover .nav-newtab-indicator {
          color: #f8f9fa;
          opacity: 1;
        }

        .nav-group-collapsed {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 2.5rem;
          padding: 0.5rem;
          background: none;
          border: none;
          border-left: 3px solid transparent;
          color: #adb5bd;
          cursor: pointer;
        }

        .nav-group-collapsed:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #f8f9fa;
        }

        .nav-group-collapsed.has-active {
          color: #87ceeb;
          border-left-color: #007bff;
        }

        .sidebar-footer {
          padding: 16px;
          border-top: 1px solid var(--ds-border, #2d3a4d);
          flex-shrink: 0;
        }
        .sidebar-docs-link {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-bottom: 12px;
          color: #adb5bd;
          font-size: 12px;
          text-decoration: none;
          padding: 6px 8px;
          border: 1px solid #495057;
          border-radius: 4px;
          text-align: center;
        }
        .sidebar-docs-link:hover { color: #fff; border-color: #6c757d; background: rgba(255,255,255,0.05); }

        .user-info {
          margin-bottom: 16px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          border: 1px solid #495057;
        }

        .user-label {
          display: block;
          font-size: 12px;
          color: #adb5bd;
          margin-bottom: 4px;
        }

        .username {
          color: #f8f9fa;
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
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 0.375rem 0.875rem;
          min-height: 2rem;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid #6c757d;
          border-radius: 4px;
          color: #f8f9fa;
          font-size: 13px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .collapsed .test-connection-button,
        .collapsed .logout-button {
          justify-content: center;
          width: auto;
          padding: 8px;
        }

        .test-connection-button:hover:not(:disabled),
        .logout-button:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .test-connection-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .action-icon-svg {
          flex-shrink: 0;
        }

        .action-label {
          white-space: nowrap;
        }

        .connection-status {
          margin-top: 12px;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          line-height: 1.4;
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

        @media (max-width: 768px) {
          .sidebar {
            transform: translateX(-100%);
          }

          .sidebar:not(.collapsed) {
            transform: translateX(0);
          }
        }

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
