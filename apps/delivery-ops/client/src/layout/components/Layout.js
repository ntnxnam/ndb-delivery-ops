import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { ToastContainer } from '../../shared/components/Toast';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';

export const Layout = ({ children }) => {
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
        className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}
        style={{
          marginLeft: sidebarCollapsed ? '60px' : `${sidebarWidth}px`
        }}
      >
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