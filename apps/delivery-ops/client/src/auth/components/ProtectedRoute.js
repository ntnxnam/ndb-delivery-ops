import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';

export const ProtectedRoute = ({ 
  children, 
  permissions = [], 
  roles = [], 
  requireAll = false,
  redirectTo = "/",
  fallback = null 
}) => {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { hasAnyPermission, hasAllPermissions, userRoles, loading: permissionsLoading } = usePermissions();
  
  // Show loading while checking authentication and permissions
  if (authLoading || permissionsLoading) {
    return fallback || <div>Loading...</div>;
  }
  
  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }
  
  // Check role-based access
  const hasRequiredRole = roles.length === 0 || roles.some(role => userRoles?.includes(role));
  
  // Check permission-based access
  let hasRequiredPermissions = true;
  if (permissions.length > 0) {
    hasRequiredPermissions = requireAll 
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions);
  }
  
  // Allow access if both role and permission checks pass
  const canAccess = hasRequiredRole && hasRequiredPermissions;
  
  if (!canAccess) {
    return <Navigate to={redirectTo} replace />;
  }
  
  return children;
};

// Higher-order component version for easier usage
export const withProtectedRoute = (
  Component, 
  { permissions = [], roles = [], requireAll = false, redirectTo = "/" } = {}
) => {
  return function ProtectedComponent(props) {
    return (
      <ProtectedRoute 
        permissions={permissions}
        roles={roles}
        requireAll={requireAll}
        redirectTo={redirectTo}
      >
        <Component {...props} />
      </ProtectedRoute>
    );
  };
};