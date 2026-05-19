// Authentication module exports
export { AuthProvider, useAuthContext } from './context/AuthContext';
export { useAuth } from './hooks/useAuth';
export { usePermissions } from './hooks/usePermissions';
export { ProtectedRoute, withProtectedRoute } from './components/ProtectedRoute';
export { PermissionGate, AdminOnly, SuperAdminOnly, ReleaseManagerOnly } from './components/PermissionGate';
export { LoginForm } from './components/LoginForm';
export { LogoutButton } from './components/LogoutButton';
export { authService } from './services/authService';
export { permissionService } from './services/permissionService';
export { PERMISSIONS, TAB_PERMISSIONS, LEGACY_PERMISSION_MAPPING } from './constants/permissions';
export { ROLES, ROLE_PERMISSIONS } from './constants/roles';