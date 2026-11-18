import { useAuthContext } from '../context/AuthContext';

export const useAuth = () => {
  const {
    isAuthenticated,
    user,
    loading,
    error,
    login,
    logout,
    refreshPermissions,
    testConnectionAndRefreshPermissions,
    normalizeUsername
  } = useAuthContext();

  return {
    // State
    isAuthenticated,
    user,
    loading,
    error,
    
    // Actions
    login,
    logout,
    refreshPermissions,
    testConnectionAndRefreshPermissions,
    
    // Utilities
    normalizeUsername,
    
    // Computed properties
    username: user?.username,
    email: user?.email,
    isLoading: loading
  };
};