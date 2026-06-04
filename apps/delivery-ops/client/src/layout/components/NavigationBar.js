import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePermissions } from '../../auth/hooks/usePermissions';
import { TAB_PERMISSIONS } from '../../auth/constants/permissions';

export const NavigationBar = () => {
  const location = useLocation();
  const { canAccessTab } = usePermissions();

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