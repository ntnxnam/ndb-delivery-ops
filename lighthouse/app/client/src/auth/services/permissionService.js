import { PERMISSIONS, LEGACY_PERMISSION_MAPPING } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/roles';

class PermissionService {
  // Utility class for permission checking logic - no longer makes API calls

  // DEPRECATED: This method is no longer used since permissions are fetched during login
  // Keeping for backward compatibility during migration - will be removed in future version
  async getUserPermissions(_username) {
    console.warn('getUserPermissions is deprecated. Permissions are now fetched during login.');
    
    // Return empty permissions and suggest using cached data
    return {
      permissions: [],
      roles: [],
      isSuperAdmin: false,
      isAdmin: false,
      deprecated: true
    };
  }

  // Transform legacy permission arrays to new system
  transformLegacyPermissions(serverData, _username) {
    const normalizedUsername = this.normalizeUsername(_username);
    const permissions = new Set();
    const roles = new Set();

    // Check each legacy permission array
    Object.entries(LEGACY_PERMISSION_MAPPING).forEach(([legacyKey, permissionList]) => {
      if (serverData[legacyKey] && Array.isArray(serverData[legacyKey])) {
        const normalizedUsers = serverData[legacyKey].map(user => this.normalizeUsername(user));
        if (normalizedUsers.includes(normalizedUsername)) {
          permissionList.forEach(permission => permissions.add(permission));
        }
      }
    });

    // Handle special admin roles
    if (serverData.isSuperAdmin) {
      roles.add('super_admin');
      // Super admin gets all permissions
      Object.values(PERMISSIONS).forEach(permission => permissions.add(permission));
    }

    if (serverData.isAdmin) {
      roles.add('admin');
      // Admin gets admin permissions
      ROLE_PERMISSIONS.admin?.forEach(permission => permissions.add(permission));
    }

    // Determine additional roles based on permissions
    if (permissions.has(PERMISSIONS.RELEASE_SETUP_MANAGE)) {
      roles.add('release_manager');
    }
    if (permissions.has(PERMISSIONS.EMAIL_SEND_GENERIC)) {
      roles.add('email_sender');
    }
    if (permissions.has(PERMISSIONS.SPRINT_REPORTS_VIEW)) {
      roles.add('sprint_manager');
    }
    if (permissions.has(PERMISSIONS.KPI_MANAGE)) {
      roles.add('kpi_manager');
    }

    return {
      permissions: Array.from(permissions),
      roles: Array.from(roles),
      isSuperAdmin: !!serverData.isSuperAdmin,
      isAdmin: !!serverData.isAdmin,
      // Include legacy data for backwards compatibility during migration
      legacy: {
        allowedUsers: serverData.allowedUsers || [],
        releaseVersionsEmailSenders: serverData.releaseVersionsEmailSenders || [],
        emailHistoryAllowedUsers: serverData.emailHistoryAllowedUsers || [],
        kpiTabAllowedUsers: serverData.kpiTabAllowedUsers || [],
        genericEmailerAllowedUsers: serverData.genericEmailerAllowedUsers || [],
        releaseSetupAllowedUsers: serverData.releaseSetupAllowedUsers || [],
        sprintReportAllowedUsers: serverData.sprintReportAllowedUsers || []
      }
    };
  }

  // Check if user has specific permission
  hasPermission(userPermissions, userRoles, permission) {
    if (!userPermissions || !permission) return false;
    
    // Check direct permission
    if (userPermissions.includes(permission)) return true;
    
    // Check role-based permissions
    return userRoles?.some(role => 
      ROLE_PERMISSIONS[role]?.includes(permission)
    ) || false;
  }

  // Check if user has any of the specified permissions
  hasAnyPermission(userPermissions, userRoles, permissions) {
    if (!permissions || permissions.length === 0) return true;
    return permissions.some(permission => 
      this.hasPermission(userPermissions, userRoles, permission)
    );
  }

  // Check if user has all specified permissions
  hasAllPermissions(userPermissions, userRoles, permissions) {
    if (!permissions || permissions.length === 0) return true;
    return permissions.every(permission => 
      this.hasPermission(userPermissions, userRoles, permission)
    );
  }

  // Normalize username
  normalizeUsername(input) {
    if (!input) return '';
    const trimmed = String(input).trim().toLowerCase();
    if (trimmed.includes('@')) {
      return trimmed.split('@')[0];
    }
    return trimmed;
  }
}

export const permissionService = new PermissionService();