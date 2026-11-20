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
import './Sidebar.css';

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
        className={`nav-item nav-item-child ${active ? 'active' : ''} ${item.wip ? 'is-wip' : ''}`}
        title={item.wip ? `${title} (WIP)` : title}
      >
        <span className="nav-label">{item.label}</span>
        {item.wip && <span className="nav-item-wip-badge" title="Work in progress">WIP</span>}
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

    </>
  );
};
