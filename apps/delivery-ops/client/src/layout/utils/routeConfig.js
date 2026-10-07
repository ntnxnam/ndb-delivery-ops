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
      path: '/release/retrospective',
      exact: true,
      component: 'RetrospectivePage',
      title: 'Retrospective',
      description: 'Gate compliance and behavioral analysis',
      permissions: [PERMISSIONS.RELEASE_VERSIONS_VIEW],
      showInNav: true,
      icon: '🔍'
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
      path: '/sprint-performance',
      exact: true,
      component: 'SprintPerformancePage',
      title: 'Sprint Performance',
      description: 'Leadership view of sprint say/do by team, leader and manager',
      permissions: [PERMISSIONS.SPRINT_REPORTS_VIEW],
      showInNav: true,
      icon: '📈'
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
      path: '/chatbot',
      exact: true,
      component: 'ChatbotPage',
      title: 'AI Chatbot',
      description: 'Conversational release and ticket Q&A',
      permissions: [PERMISSIONS.AI_INSIGHTS_VIEW],
      showInNav: true,
      icon: '💬'
    },
    {
      path: '/kpis',
      exact: true,
      component: 'KPIPage',
      title: 'KPIs',
      description: 'KPI dashboard',
      permissions: [PERMISSIONS.KPI_VIEW],
      showInNav: true,
      icon: '📈'
    },
    {
      path: '/sos-summary',
      exact: true,
      component: 'SosSummaryPage',
      title: 'SoS Summary',
      description: 'Scrum of Scrums — live Feature/Initiative status across all active releases',
      permissions: [PERMISSIONS.RELEASE_VERSIONS_VIEW],
      showInNav: true,
      icon: '📡'
    },
    {
      path: '/release/brief',
      exact: true,
      component: 'ReleaseBriefPage',
      title: 'Release Brief',
      description: 'AI health briefing per release',
      permissions: [PERMISSIONS.RELEASE_VERSIONS_VIEW],
      showInNav: true,
      icon: '🤖'
    },
    {
      path: '/release/:name/brief',
      exact: false,
      component: 'ReleaseBriefPage',
      title: 'Release Brief',
      description: 'AI health briefing — deep link to a specific release',
      permissions: [PERMISSIONS.RELEASE_VERSIONS_VIEW],
      showInNav: false
    },
    {
      path: '/release-config',
      exact: true,
      component: 'ReleaseConfigPage',
      title: 'Release Config',
      description: 'Edit release gate dates configuration',
      permissions: [PERMISSIONS.RELEASE_CONFIG_MANAGE],
      showInNav: true,
      icon: '🗓️'
    },
    {
      path: '/team-management',
      exact: true,
      component: 'AdminPanel',
      title: 'Team Management',
      description: 'Add and edit teams',
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