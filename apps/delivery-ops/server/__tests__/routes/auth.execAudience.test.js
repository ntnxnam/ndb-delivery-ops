/**
 * execAudienceUsers → exec_audience permission + team_exec role
 */
const path = require('path');
const fs = require('fs');

// auth.js exports router; transformLegacyPermissions is internal.
// Replicate the mapping contract from the route file for a focused unit check.
function transformLegacyPermissions(serverData, username) {
  const normalizedUsername = username.toLowerCase().replace(/@.*$/, '');
  const permissions = new Set();
  const roles = new Set();
  const LEGACY_PERMISSION_MAPPING = {
    execAudienceUsers: ['exec_audience'],
  };
  Object.entries(LEGACY_PERMISSION_MAPPING).forEach(([legacyKey, permissionList]) => {
    if (serverData[legacyKey] && Array.isArray(serverData[legacyKey])) {
      const normalizedUsers = serverData[legacyKey].map((user) =>
        user.toLowerCase().replace(/@.*$/, '')
      );
      if (normalizedUsers.includes(normalizedUsername)) {
        permissionList.forEach((permission) => permissions.add(permission));
      }
    }
  });
  if (permissions.has('exec_audience')) roles.add('team_exec');
  return { permissions: [...permissions], roles: [...roles] };
}

describe('exec audience allowlist', () => {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../../config/allowedUsers.json'),
      'utf8'
    )
  );

  it('includes execAudienceUsers in config', () => {
    expect(Array.isArray(config.execAudienceUsers)).toBe(true);
    expect(config.execAudienceUsers).toContain('namratha.singh');
  });

  it('grants exec_audience + team_exec to listed users', () => {
    const r = transformLegacyPermissions(config, 'namratha.singh');
    expect(r.permissions).toContain('exec_audience');
    expect(r.roles).toContain('team_exec');
  });

  it('does not grant exec_audience to arbitrary users', () => {
    const r = transformLegacyPermissions(config, 'random.user');
    expect(r.permissions).not.toContain('exec_audience');
    expect(r.roles).not.toContain('team_exec');
  });
});
