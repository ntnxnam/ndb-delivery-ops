import React, { useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePermissions } from '../../auth/hooks/usePermissions';
import { TAB_PERMISSIONS } from '../../auth/constants/permissions';
import { useTeamDataset } from '../../hooks/useTeamDataset';

/** Format a lastSyncIso timestamp as a short relative label. */
function formatSyncAge(isoString) {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const NavigationBar = () => {
  const location = useLocation();
  const { canAccessTab } = usePermissions();
  const { isSyncing, bundleMeta, refreshFromDisk } = useTeamDataset();

  const handleRefresh = useCallback(
    (e) => {
      e.preventDefault();
      refreshFromDisk();
    },
    [refreshFromDisk]
  );

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
      description: 'Live KPI snapshot (in progress)'
    },
    {
      path: '/release/retrospective',
      label: 'Retrospective',
      icon: '🔍',
      description: 'Gate compliance and behavioral analysis'
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
      path: '/sync-hub',
      label: 'Sync Hub',
      icon: '⟳',
      description: 'Manage the centralised JIRA data cache'
    },
    {
      path: '/admin',
      label: 'Admin',
      icon: '🔧',
      description: 'Administrative functions'
    }
  ];

  // Filter navigation items based on permissions
  const visibleItems = navigationItems.filter(item => {
    const requiredPermissions = TAB_PERMISSIONS[item.path];
    
    // If no permissions required (like Email Sender), show to all
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }
    
    const canAccess = canAccessTab(item.path);
    
    return canAccess;
  });

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <nav className="navigation-bar">
      <div className="nav-content">
        <div className="nav-items">
          {visibleItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
              title={item.description}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </div>

        {/* Active indicator */}
        <div className="nav-indicator">
          {(() => {
            const activeItem = visibleItems.find(item => isActive(item.path));
            return activeItem ? (
              <span className="indicator-text">
                {activeItem.icon} {activeItem.label}
              </span>
            ) : null;
          })()}
        </div>

        {/* Dataset sync chip */}
        <div className="sync-chip" title={bundleMeta?.lastSyncIso ? `Last synced: ${bundleMeta.lastSyncIso}` : 'No data synced yet'}>
          {isSyncing ? (
            <span className="sync-chip--syncing">
              <span className="sync-spinner" aria-hidden="true" />
              Syncing…
            </span>
          ) : bundleMeta ? (
            <span className="sync-chip--fresh">
              <span className="sync-dot sync-dot--green" aria-hidden="true" />
              {formatSyncAge(bundleMeta.lastSyncIso)}
              <button
                className="sync-refresh-btn"
                onClick={handleRefresh}
                title="Refresh from disk"
                aria-label="Refresh dataset from disk"
              >
                ↻
              </button>
            </span>
          ) : (
            <span className="sync-chip--empty">
              <span className="sync-dot sync-dot--grey" aria-hidden="true" />
              No data
            </span>
          )}
        </div>
      </div>

      <style>{`
        .navigation-bar {
          background: #495057;
          border-bottom: 1px solid #6c757d;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }

        .nav-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nav-items {
          display: flex;
          align-items: center;
          gap: 2px;
          flex: 1;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .nav-items::-webkit-scrollbar {
          display: none;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px 16px;
          color: #adb5bd;
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          white-space: nowrap;
          border-radius: 6px 6px 0 0;
          transition: all 0.2s ease;
          position: relative;
          min-width: fit-content;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #f8f9fa;
        }

        .nav-item.active {
          background: white;
          color: #333;
          font-weight: 600;
        }

        .nav-item.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: #007bff;
        }

        .nav-icon {
          font-size: 16px;
          flex-shrink: 0;
        }

        .nav-label {
          flex-shrink: 0;
        }

        /* Sync chip */
        .sync-chip {
          flex-shrink: 0;
          margin-left: 12px;
          font-size: 12px;
          white-space: nowrap;
        }

        .sync-chip--syncing,
        .sync-chip--fresh,
        .sync-chip--empty {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.1);
          color: #adb5bd;
        }

        .sync-chip--syncing {
          color: #ffd43b;
        }

        .sync-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .sync-dot--green { background: #51cf66; }
        .sync-dot--grey  { background: #868e96; }

        .sync-spinner {
          display: inline-block;
          width: 10px;
          height: 10px;
          border: 2px solid rgba(255, 212, 59, 0.3);
          border-top-color: #ffd43b;
          border-radius: 50%;
          animation: sync-spin 0.8s linear infinite;
          flex-shrink: 0;
        }

        @keyframes sync-spin {
          to { transform: rotate(360deg); }
        }

        .sync-refresh-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #adb5bd;
          font-size: 14px;
          padding: 0 2px;
          line-height: 1;
          border-radius: 3px;
          transition: color 0.15s;
        }

        .sync-refresh-btn:hover {
          color: #f8f9fa;
        }

        .nav-indicator {
          display: none;
          margin-left: 16px;
        }

        .indicator-text {
          color: #f8f9fa;
          font-size: 14px;
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .nav-content {
            padding: 0 16px;
            flex-direction: column;
            align-items: stretch;
          }

          .nav-items {
            justify-content: flex-start;
            padding: 8px 0;
            gap: 4px;
          }

          .nav-item {
            padding: 8px 12px;
            font-size: 13px;
          }

          .nav-icon {
            font-size: 14px;
          }

          .nav-indicator {
            display: block;
            text-align: center;
            padding: 8px 0;
            border-top: 1px solid #6c757d;
          }

          .indicator-text {
            font-size: 12px;
          }
        }

        @media (max-width: 576px) {
          .nav-content {
            padding: 0 12px;
          }

          .nav-items {
            flex-wrap: wrap;
            justify-content: center;
          }

          .nav-item {
            flex-direction: column;
            gap: 2px;
            padding: 8px;
            text-align: center;
            border-radius: 4px;
          }

          .nav-label {
            font-size: 11px;
          }

          .nav-icon {
            font-size: 16px;
          }
        }

        @media (max-width: 480px) {
          .nav-item .nav-label {
            display: none;
          }

          .nav-item {
            padding: 10px;
          }

          .nav-icon {
            font-size: 18px;
          }
        }
      `}</style>
    </nav>
  );
};