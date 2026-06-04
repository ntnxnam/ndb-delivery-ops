import { PERMISSIONS } from '../../auth/constants/permissions';

// Route configuration with permissions and metadata
export const routeConfig = {
  // Public routes (no authentication required)
  public: [
    {
      path: '/login',
      exact: true,
      component: 'LoginPage'
    }
  ],

  // Protected routes (authentication required)
  protected: [
    {
      path: '/',
      exact: true,
      component: 'EmailSender',
      title: 'Email Sender',
      description: 'Send status update emails',
      permissions: [], // No specific permissions - available to all authenticated users
      showInNav: true,
      icon: '📧'
    },
    {
      path: '/project-status',
      exact: true,
      component: 'ReleaseVersionTab',
      title: 'Project Status',
      description: 'Release picker, payload table, Gantt',
      permissions: [PERMISSIONS.RELEASE_VERSIONS_VIEW],
      showInNav: true,
      icon: '🚀'
    },
    {
      path: '/feature-dashboard',
      exact: true,
      component: 'FeatureDashboardPage',
      title: 'Feature Dashboard',
      description: 'Feature payload, gates, and reconciliation',
      permissions: [PERMISSIONS.RELEASE_VERSIONS_VIEW],
      showInNav: true,
      icon: '🧭'
    },
    {
      path: '/release-setup',
      exact: true,
      component: 'ReleaseSetup',
      title: 'Release Setup',
      description: 'Create / rename releases, cleanup filters',
      permissions: [PERMISSIONS.RELEASE_SETUP_MANAGE],
      showInNav: true,
      icon: '⚙️'
    },
    {
      path: '/generic-emailer',
      exact: true,
      component: 'GenericEmailer',
      title: 'JIRA Emailer',
      description: 'Send emails from JIRA queries',
      permissions: [PERMISSIONS.EMAIL_SEND_GENERIC],
      showInNav: true,
      icon: '📋'
    },
    {
      path: '/email-history',
      exact: true,
      component: 'EmailHistoryTab',
      title: 'Email History',
      description: 'View sent email history',
      permissions: [PERMISSIONS.EMAIL_HISTORY_VIEW],
      showInNav: true,
      icon: '📜'
    },
    {
      path: '/sprint-report',
      exact: true,
      component: 'SprintReportPage',
      title: 'Sprint Report',
      description: 'Sprint reporting and metrics',
      permissions: [PERMISSIONS.SPRINT_REPORTS_VIEW],
      showInNav: true,
      icon: '🏃'
    },
    {
      path: '/component-report',
      exact: true,
      component: 'ComponentReport',
      title: 'Component Report',
      description: 'Component health, actionable metrics, deferral trends',
      permissions: [PERMISSIONS.RELEASE_VERSIONS_VIEW],
      showInNav: true,
      icon: '📊'
    },
    {
      path: '/admin',
      exact: true,
      component: 'AdminPanel',
      title: 'Admin',
      description: 'Administrative functions',
      permissions: [PERMISSIONS.ADMIN_PANEL_ACCESS],
      showInNav: true,
      icon: '🔧'
    }
  ]
};

// Helper functions
export const getRouteByPath = (path) => {
  const allRoutes = [...routeConfig.public, ...routeConfig.protected];
  return allRoutes.find(route => route.path === path);
};

export const getNavigationRoutes = () => {
  return routeConfig.protected.filter(route => route.showInNav);
};

export const getRouteTitle = (path) => {
  const route = getRouteByPath(path);
  return route?.title || 'NDB Status Sender';
};

export const getRoutePermissions = (path) => {
  const route = getRouteByPath(path);
  return route?.permissions || [];
};

export const isPublicRoute = (path) => {
  return routeConfig.public.some(route => route.path === path);
};

export const isProtectedRoute = (path) => {
  return routeConfig.protected.some(route => route.path === path);
};