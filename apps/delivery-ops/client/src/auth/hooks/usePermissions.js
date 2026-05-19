import { useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { permissionService } from '../services/permissionService';
import { TAB_PERMISSIONS } from '../constants/permissions';

export const usePermissions = () => {
  const { userPermissions, userRoles, loading } = useAuthContext();
  
  const hasPermission = useMemo(() => {
    return (permission) => {
      if (!userPermissions || loading) return false;
      return permissionService.hasPermission(userPermissions, userRoles, permission);
    };
  }, [userPermissions, userRoles, loading]);
  
  const hasAnyPermission = useMemo(() => {
    return (permissions) => {
      if (!userPermissions || loading) return false;
      return permissionService.hasAnyPermission(userPermissions, userRoles, permissions);
    };
  }, [userPermissions, userRoles, loading]);
  
  const hasAllPermissions = useMemo(() => {
    return (permissions) => {
      if (!userPermissions || loading) return false;
      return permissionService.hasAllPermissions(userPermissions, userRoles, permissions);
    };
  }, [userPermissions, userRoles, loading]);
  
  const canAccessTab = useMemo(() => {
    return (tabPath) => {
      const requiredPermissions = TAB_PERMISSIONS[tabPath];
      if (!requiredPermissions) return false;
      
      // If no permissions required, allow access for authenticated users
      if (requiredPermissions.length === 0) return true;
      
      const hasAccess = hasAnyPermission(requiredPermissions);
      
      return hasAccess;
    };
  }, [hasAnyPermission]);
  
  const getVisibleTabs = useMemo(() => {
    if (loading) return [];
    
    return Object.entries(TAB_PERMISSIONS).filter(([_path, requiredPermissions]) => {
      // If no permissions required, show to all authenticated users
      if (requiredPermissions.length === 0) return true;
      
      // Check if user has any of the required permissions
      return hasAnyPermission(requiredPermissions);
    }).map(([path]) => path);
  }, [hasAnyPermission, loading]);

  return {
    // Permission checking functions
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    canAccessTab,
    
    // Computed data
    getVisibleTabs,
    userPermissions,
    userRoles,
    
    // State
    loading,
    
    // Role checking helpers
    isSuperAdmin: userRoles?.includes('super_admin') || false,
    isAdmin: userRoles?.includes('admin') || false,
    isReleaseManager: userRoles?.includes('release_manager') || false,
    isEmailSender: userRoles?.includes('email_sender') || false,
    isSprintManager: userRoles?.includes('sprint_manager') || false,
    isKpiManager: userRoles?.includes('kpi_manager') || false
  };
};