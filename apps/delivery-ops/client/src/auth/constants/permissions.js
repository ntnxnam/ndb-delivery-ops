// Permission constants for the NDB Status Sender application
export const PERMISSIONS = {
  // Release Management
  RELEASE_VERSIONS_VIEW: 'release_versions_view',
  RELEASE_VERSIONS_EDIT: 'release_versions_edit',
  RELEASE_VERSIONS_EMAIL: 'release_versions_email',
  RELEASE_SETUP_MANAGE: 'release_setup_manage',
  RELEASE_TRENDS_VIEW: 'release_trends_view',
  RELEASE_CONFIG_MANAGE: 'release_config_manage',
  
  // Email Management
  EMAIL_HISTORY_VIEW: 'email_history_view',
  EMAIL_SEND_GENERIC: 'email_send_generic',
  EMAIL_SEND_RELEASE: 'email_send_release',
  
  // Sprint & Reporting
  SPRINT_REPORTS_VIEW: 'sprint_reports_view',
  KPI_VIEW: 'kpi_view',
  KPI_MANAGE: 'kpi_manage',
  
  // Admin Functions
  ADMIN_PANEL_ACCESS: 'admin_panel_access',
  USER_MANAGEMENT: 'user_management',
  TEAM_MANAGEMENT: 'team_management',
  
  // AI & Predictions
  AI_INSIGHTS_VIEW: 'ai_insights_view',
  CRYSTAL_BALL_ACCESS: 'crystal_ball_access',
  
  // System
  SYSTEM_CONFIG: 'system_config'
};

// Tab-specific permissions mapping
export const TAB_PERMISSIONS = {
  '/': [], // Email Sender - available to all authenticated users
  '/project-status': [PERMISSIONS.RELEASE_VERSIONS_VIEW],
  '/release/brief': [PERMISSIONS.RELEASE_VERSIONS_VIEW],
  '/release/retrospective': [PERMISSIONS.RELEASE_VERSIONS_VIEW],
  '/feature-dashboard': [PERMISSIONS.RELEASE_VERSIONS_VIEW],
  '/component-report': [PERMISSIONS.RELEASE_VERSIONS_VIEW],
  '/chatbot': [PERMISSIONS.AI_INSIGHTS_VIEW],
  '/release-setup': [PERMISSIONS.RELEASE_SETUP_MANAGE],
  '/release-config': [PERMISSIONS.RELEASE_CONFIG_MANAGE],
  '/generic-emailer': [PERMISSIONS.EMAIL_SEND_GENERIC],
  '/email-history': [PERMISSIONS.EMAIL_HISTORY_VIEW],
  '/sprint-report': [PERMISSIONS.SPRINT_REPORTS_VIEW],
  '/sync-hub': [PERMISSIONS.RELEASE_VERSIONS_VIEW],
  '/kpis': [PERMISSIONS.KPI_VIEW],
  '/admin': [PERMISSIONS.ADMIN_PANEL_ACCESS]
};

// Legacy permission array mapping for migration compatibility.
// Keep in sync with server/routes/auth.js LEGACY_PERMISSION_MAPPING.
export const LEGACY_PERMISSION_MAPPING = {
  allowedUsers: [PERMISSIONS.RELEASE_VERSIONS_VIEW, PERMISSIONS.RELEASE_TRENDS_VIEW],
  releaseVersionsEmailSenders: [PERMISSIONS.RELEASE_VERSIONS_EMAIL],
  emailHistoryAllowedUsers: [PERMISSIONS.EMAIL_HISTORY_VIEW],
  kpiTabAllowedUsers: [PERMISSIONS.KPI_VIEW],
  genericEmailerAllowedUsers: [PERMISSIONS.EMAIL_SEND_GENERIC],
  releaseSetupAllowedUsers: [PERMISSIONS.RELEASE_SETUP_MANAGE],
  releaseConfigAllowedUsers: [PERMISSIONS.RELEASE_CONFIG_MANAGE],
  sprintReportAllowedUsers: [PERMISSIONS.SPRINT_REPORTS_VIEW]
};