import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { usePermissions } from '../../auth/hooks/usePermissions';
import { getRouteByPath, getNavigationRoutes, getRouteTitle } from '../utils/routeConfig';

export const useNavigation = () => {
  const location = useLocation();
  const { canAccessTab, loading: permissionsLoading } = usePermissions();
  const [pageTitle, setPageTitle] = useState('NDB Status Sender');

  // Get all navigation routes
  const allNavigationRoutes = getNavigationRoutes();

  // Filter routes based on user permissions
  const visibleRoutes = allNavigationRoutes.filter(route => {
    // If no permissions required, show to all authenticated users
    if (!route.permissions || route.permissions.length === 0) {
      return true;
    }
    
    return canAccessTab(route.path);
  });

  // Get current route information
  const currentRoute = getRouteByPath(location.pathname);
  
  // Check if current path is active
  const isActive = useCallback((path) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  }, [location.pathname]);

  // Update page title when route changes
  useEffect(() => {
    const title = getRouteTitle(location.pathname);
    setPageTitle(title);
    
    // Update document title
    document.title = title === 'NDB Status Sender' ? title : `${title} - NDB Status Sender`;
  }, [location.pathname]);

  // Check if user can access current route
  const canAccessCurrentRoute = currentRoute 
    ? canAccessTab(currentRoute.path)
    : true; // Allow access if route not found (will show 404)

  return {
    // Current route info
    currentRoute,
    currentPath: location.pathname,
    pageTitle,
    canAccessCurrentRoute,
    
    // Navigation items
    visibleRoutes,
    allRoutes: allNavigationRoutes,
    
    // Utilities
    isActive,
    loading: permissionsLoading,
    
    // Route statistics
    totalRoutes: allNavigationRoutes.length,
    visibleRouteCount: visibleRoutes.length,
    hiddenRouteCount: allNavigationRoutes.length - visibleRoutes.length
  };
};