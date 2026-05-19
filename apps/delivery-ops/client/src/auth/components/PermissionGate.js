import React from 'react';
import { usePermissions } from '../hooks/usePermissions';

export const PermissionGate = ({ 
  children, 
  permissions = [], 
  roles = [], 
  requireAll = false, 
  fallback = null,
  showLoading = false
}) => {
  const { 
    hasAnyPermission, 
    hasAllPermissions, 
    userRoles, 
    loading 
  } = usePermissions();
  
  // Show loading state if requested
  if (loading && showLoading) {
    return fallback || <div>Loading permissions...</div>;
  }
  
  // Check role-based access
  const hasRole = roles.length === 0 || roles.some(role => userRoles?.includes(role));
  
  // Check permission-based access
  let hasRequiredPermissions = true;
  if (permissions.length > 0) {
    hasRequiredPermissions = requireAll 
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions);
  }
  
  const canAccess = hasRole && hasRequiredPermissions;
  
  return canAccess ? children : fallback;
};

// Convenience components for common permission patterns
export const AdminOnly = ({ children, fallback = null }) => (
  <PermissionGate roles={['super_admin', 'admin']} fallback={fallback}>
    {children}
  </PermissionGate>
);

export const SuperAdminOnly = ({ children, fallback = null }) => (
  <PermissionGate roles={['super_admin']} fallback={fallback}>
    {children}
  </PermissionGate>
);

export const ReleaseManagerOnly = ({ children, fallback = null }) => (
  <PermissionGate roles={['release_manager']} fallback={fallback}>
    {children}
  </PermissionGate>
);