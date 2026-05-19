/**
 * Centralized Authorization Service (RBAC)
 *
 * Role model: Super Admin, Admin, Users, Special Users.
 * - Super Admin (superAdminUsers): full access including generic emailer and release setup.
 * - Admin (adminUsers): full operational access except generic emailer and release setup.
 * - Users: view access (reports, KPI view, release versions view).
 * - Special Users: feature-specific access via specialAccess config.
 *
 * Config-driven: superAdminUsers and adminUsers in allowedUsers.json; teams can update as they evolve.
 * Supports legacy allowlists when new role keys are not present.
 */

const path = require('path');

/** Normalize username/email to username format (avoids circular dependency on userService) */
function normalizeToUsername(input) {
  if (!input) return null;
  const trimmed = String(input).trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed.split('@')[0];
  return trimmed;
}

/** Load config with optional cache bust for dev */
function getConfig() {
  const configPath = path.join(__dirname, '../config/allowedUsers.json');
  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } catch (e) {
    return {};
  }
}

/** Check if user is in list (normalized comparison) */
function isInList(username, list) {
  if (!username || !Array.isArray(list)) return false;
  const normalized = normalizeToUsername(username);
  return list.some((u) => normalizeToUsername(u) === normalized);
}

/**
 * Get super admin list (Super Admin only). Empty if not using new role model.
 */
function getSuperAdminUsers(config) {
  if (!config.superAdminUsers || !Array.isArray(config.superAdminUsers)) return [];
  return config.superAdminUsers.map((u) => normalizeToUsername(u)).filter(Boolean);
}

/**
 * Get effective admin list: Super Admin + Admin (both tiers get "admin" permissions).
 * Legacy fallback: if new role keys not present, use legacy most-restrictive list.
 */
function getAdminUsers(config) {
  const superList = getSuperAdminUsers(config);
  const adminList = config.adminUsers && Array.isArray(config.adminUsers)
    ? config.adminUsers.map((u) => normalizeToUsername(u)).filter(Boolean)
    : [];
  if (superList.length > 0 || adminList.length > 0) {
    return [...new Set([...superList, ...adminList])];
  }
  const legacy = config.genericEmailerAllowedUsers || config.releaseSetupAllowedUsers || [];
  return (Array.isArray(legacy) ? legacy : []).map((u) => normalizeToUsername(u)).filter(Boolean);
}

/**
 * Get effective allowlist for a feature from specialAccess or legacy key
 */
function getAllowlist(config, legacyKey, specialKey) {
  const special = config.specialAccess && config.specialAccess[specialKey];
  if (Array.isArray(special) && special.length > 0) {
    return special.map((u) => normalizeToUsername(u)).filter(Boolean);
  }
  const legacy = config[legacyKey];
  if (Array.isArray(legacy)) {
    return legacy.map((u) => normalizeToUsername(u)).filter(Boolean);
  }
  return [];
}

/**
 * Check user role and special access.
 * Super Admin = superAdminUsers only. Admin = superAdminUsers OR adminUsers (both get admin permissions).
 * @param {string} username - Username or email
 * @returns {{ isSuperAdmin: boolean, isAdmin: boolean, isUser: boolean, normalizedUsername: string|null, specialAccess: object }}
 */
function checkUserRole(username) {
  const config = getConfig();
  const normalizedUsername = normalizeToUsername(username);
  const isUser = !!normalizedUsername;

  const superAdminList = getSuperAdminUsers(config);
  const adminList = getAdminUsers(config);
  const isSuperAdmin = isUser && superAdminList.includes(normalizedUsername);
  const isAdmin = isUser && adminList.includes(normalizedUsername);

  const specialAccess = {
    sprintReport: isInList(username, getAllowlist(config, 'sprintReportAllowedUsers', 'sprintReportOnly')),
    kpiEdit: isInList(username, getAllowlist(config, 'kpiTabAllowedUsers', 'kpiEditOnly')),
    emailSend: isInList(username, getAllowlist(config, 'releaseVersionsEmailSenders', 'emailSendOnly')),
    releaseSetup: isInList(username, getAllowlist(config, 'releaseSetupAllowedUsers', 'releaseSetupOnly')),
    releaseConfig: isInList(username, getAllowlist(config, 'releaseConfigAllowedUsers', 'releaseConfigOnly')),
    emailHistory: isInList(username, getAllowlist(config, 'emailHistoryAllowedUsers', 'emailHistoryOnly')),
    genericEmailer: isInList(username, getAllowlist(config, 'genericEmailerAllowedUsers', 'genericEmailerOnly'))
  };

  return {
    isSuperAdmin,
    isAdmin,
    isUser,
    normalizedUsername,
    specialAccess
  };
}

/**
 * Get environment-based access mode for a feature.
 * @param {string} feature - One of: releaseVersions, sprintReport, releaseVersionsEmail
 * @returns {'all'|'allowlist'|'none'}
 */
function getEnvironmentAccess(feature) {
  const envKey =
    feature === 'releaseVersions'
      ? 'RELEASE_VERSIONS_PAGE_ACCESS'
      : feature === 'sprintReport'
        ? 'SPRINT_REPORT_PAGE_ACCESS'
        : feature === 'releaseVersionsEmail'
          ? 'RELEASE_VERSIONS_EMAIL_ACCESS'
          : null;
  if (!envKey) return 'allowlist';
  const raw = (process.env[envKey] || 'all').toLowerCase().trim();
  if (raw === 'none' || raw === 'allowlist' || raw === 'all') return raw;
  return 'allowlist';
}

/**
 * Check if user can perform KPI admin for a team (edit/delete/reorder).
 */
function checkKpiAdminForTeam(username, teamId) {
  const config = getConfig();
  const role = checkUserRole(username);
  if (role.isAdmin) return true;
  const adminMap = config.kpiAdminUsers || {};
  const teamAdmins = adminMap[teamId];
  if (!Array.isArray(teamAdmins)) return true;
  return isInList(username, teamAdmins);
}

/**
 * Check feature access. Single source of truth for all authorization.
 *
 * @param {string} username - Username or email
 * @param {string} feature - releaseVersions | releaseVersionsEmail | sprintReport | kpiView | kpiEdit | kpiAdmin | emailHistory | genericEmailer | releaseSetup | releaseConfig | config
 * @param {{ teamId?: string }} options - Optional; teamId for kpiAdmin
 * @returns {{ authorized: boolean, normalizedUsername: string|null, error?: string, userEmail?: string }}
 */
function checkFeatureAccess(username, feature, options = {}) {
  const role = checkUserRole(username);
  const normalizedUsername = role.normalizedUsername;

  if (!normalizedUsername) {
    const error =
      feature === 'releaseVersions'
        ? 'Username is required for authorization check. Please provide your Nutanix username (e.g., namratha.singh).'
        : 'Username is required.';
    return { authorized: false, normalizedUsername: null, error };
  }

  const userEmail = `${normalizedUsername}@nutanix.com`;

  switch (feature) {
    case 'releaseVersions': {
      const mode = getEnvironmentAccess('releaseVersions');
      if (mode === 'none') {
        return { authorized: false, normalizedUsername, error: 'Access to Release Versions is currently disabled.' };
      }
      if (mode === 'all') {
        return { authorized: true, normalizedUsername, userEmail };
      }
      const config = getConfig();
      const allowlist = config.allowedUsers || [];
      const allowed = Array.isArray(allowlist) ? allowlist.map((u) => normalizeToUsername(u)) : [];
      const authorized = role.isAdmin || allowed.includes(normalizedUsername);
      return {
        authorized,
        normalizedUsername,
        userEmail,
        error: authorized ? undefined : 'Access denied. You are not authorized to access this endpoint.'
      };
    }

    case 'releaseVersionsEmail': {
      const mode = getEnvironmentAccess('releaseVersionsEmail');
      if (mode === 'none') {
        return { authorized: false, normalizedUsername, error: 'Sending release version emails is disabled.' };
      }
      const canSend = role.isAdmin || role.specialAccess.emailSend;
      return {
        authorized: canSend,
        normalizedUsername,
        error: canSend ? undefined : 'You are not authorized to send release version emails.'
      };
    }

    case 'sprintReport': {
      const mode = getEnvironmentAccess('sprintReport');
      if (mode === 'none') {
        return { authorized: false, normalizedUsername, error: 'Access to Sprint Report is currently disabled.' };
      }
      if (mode === 'all') {
        return { authorized: true, normalizedUsername };
      }
      const canAccess = role.isAdmin || role.specialAccess.sprintReport;
      return {
        authorized: canAccess,
        normalizedUsername,
        error: canAccess ? undefined : 'Not authorized for Sprint Report'
      };
    }

    case 'kpiView':
      return { authorized: role.isUser, normalizedUsername };

    case 'kpiEdit':
      return {
        authorized: role.isAdmin || role.specialAccess.kpiEdit,
        normalizedUsername,
        error: (role.isAdmin || role.specialAccess.kpiEdit) ? undefined : 'Not authorized to edit KPIs.'
      };

    case 'kpiAdmin': {
      const canAdmin = options.teamId
        ? checkKpiAdminForTeam(username, options.teamId)
        : role.isAdmin || role.specialAccess.kpiEdit;
      return {
        authorized: canAdmin,
        normalizedUsername,
        error: canAdmin ? undefined : 'You do not have admin permissions for this team.'
      };
    }

    case 'emailHistory':
      return {
        authorized: role.isAdmin || role.specialAccess.emailHistory || role.isUser,
        normalizedUsername,
        error: (role.isAdmin || role.specialAccess.emailHistory || role.isUser) ? undefined : 'You are not allowed to access email history.'
      };
    case 'emailHistoryStrict': {
      const config = getConfig();
      const allowed = getAllowlist(config, 'emailHistoryAllowedUsers', 'emailHistoryOnly');
      const authorized = role.isAdmin || (allowed.length > 0 && isInList(username, allowed));
      return {
        authorized,
        normalizedUsername,
        error: authorized ? undefined : 'You are not allowed to access email history.'
      };
    }

    case 'genericEmailer':
      return {
        authorized: role.isSuperAdmin || role.specialAccess.genericEmailer,
        normalizedUsername,
        error: (role.isSuperAdmin || role.specialAccess.genericEmailer) ? undefined : 'Not authorized to use Generic Emailer.'
      };

    case 'releaseSetup':
      return {
        authorized: role.isSuperAdmin || role.specialAccess.releaseSetup,
        normalizedUsername,
        error: (role.isSuperAdmin || role.specialAccess.releaseSetup) ? undefined : 'Not authorized for Release Setup.'
      };

    case 'releaseConfig':
      return {
        authorized: role.isSuperAdmin || role.specialAccess.releaseConfig,
        normalizedUsername,
        error: (role.isSuperAdmin || role.specialAccess.releaseConfig) ? undefined : 'Not authorized for Release Config.'
      };

    case 'config':
      return { 
        authorized: role.isSuperAdmin, 
        normalizedUsername,
        error: role.isSuperAdmin ? undefined : 'Only super administrators can access team management features.'
      };

    default:
      return { authorized: false, normalizedUsername, error: 'Unknown feature.' };
  }
}

/**
 * Get permissions for the current user (for /api/config/allowed-users when protected).
 * Returns only what the client needs to show/hide UI; does not expose full config.
 */
function getUserPermissions(username) {
  const role = checkUserRole(username);
  const config = getConfig();

  const releaseVersionsAccess = getEnvironmentAccess('releaseVersions');
  const sprintReportAccess = getEnvironmentAccess('sprintReport');

  const allowedUsers = (config.allowedUsers || []).map((u) => normalizeToUsername(u)).filter(Boolean);
  const sprintReportAllowedUsers = getAllowlist(config, 'sprintReportAllowedUsers', 'sprintReportOnly');
  const kpiTabAllowedUsers = getAllowlist(config, 'kpiTabAllowedUsers', 'kpiEditOnly');
  const emailHistoryAllowedUsers = getAllowlist(config, 'emailHistoryAllowedUsers', 'emailHistoryOnly');
  const genericEmailerAllowedUsers = getAllowlist(config, 'genericEmailerAllowedUsers', 'genericEmailerOnly');
  const releaseSetupAllowedUsers = getAllowlist(config, 'releaseSetupAllowedUsers', 'releaseSetupOnly');
  const releaseConfigAllowedUsers = getAllowlist(config, 'releaseConfigAllowedUsers', 'releaseConfigOnly');
  const releaseVersionsEmailSenders = getAllowlist(config, 'releaseVersionsEmailSenders', 'emailSendOnly');
  const kpiAdminUsers = config.kpiAdminUsers || {};

  return {
    username: role.normalizedUsername,
    isSuperAdmin: role.isSuperAdmin,
    isAdmin: role.isAdmin,
    allowedUsers,
    releaseVersionsEmailSenders,
    emailHistoryAllowedUsers,
    kpiTabAllowedUsers,
    genericEmailerAllowedUsers,
    releaseSetupAllowedUsers,
    releaseConfigAllowedUsers,
    sprintReportAllowedUsers,
    kpiAdminUsers,
    releaseVersionsPageAccess: releaseVersionsAccess,
    sprintReportPageAccess: sprintReportAccess
  };
}

module.exports = {
  normalizeToUsername,
  getConfig,
  checkUserRole,
  getEnvironmentAccess,
  checkFeatureAccess,
  checkKpiAdminForTeam,
  getUserPermissions,
  isInList,
  getAdminUsers,
  getSuperAdminUsers,
  getAllowlist
};
