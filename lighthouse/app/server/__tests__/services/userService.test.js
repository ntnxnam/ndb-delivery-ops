/**
 * Unit tests for user service
 * Test Plan: UT-USER-001
 */

jest.mock('../../config/allowedUsers.json', () => ({ allowedUsers: ['user1', 'user2'] }));

const {
  normalizeToUsername,
  usernameToEmail,
  extractUserName,
  extractAssigneeName,
  checkReleaseVersionsAuthorization
} = require('../../services/userService');

describe('User Service', () => {
  describe('normalizeToUsername', () => {
    test('should normalize email to username', () => {
      expect(normalizeToUsername('user@nutanix.com')).toBe('user');
      expect(normalizeToUsername('user.name@nutanix.com')).toBe('user.name');
    });

    test('should return username as-is if not email', () => {
      expect(normalizeToUsername('user.name')).toBe('user.name');
    });
  });

  describe('usernameToEmail', () => {
    test('should convert username to email', () => {
      expect(usernameToEmail('user.name')).toBe('user.name@nutanix.com');
    });

    test('should return email as-is if already email', () => {
      expect(usernameToEmail('user@nutanix.com')).toBe('user@nutanix.com');
    });
  });

  describe('extractUserName', () => {
    test('UT-USER-001: should extract user name from string', () => {
      expect(extractUserName('user.name')).toBe('user.name');
    });

    test('UT-USER-001: should extract displayName from object', () => {
      const userObj = {
        displayName: 'User Name',
        emailAddress: 'user@nutanix.com'
      };
      expect(extractUserName(userObj)).toBe('User Name');
    });

    test('UT-USER-001: should fallback to name if no displayName', () => {
      const userObj = {
        name: 'user.name',
        emailAddress: 'user@nutanix.com'
      };
      expect(extractUserName(userObj)).toBe('user.name');
    });

    test('UT-USER-001: should fallback to emailAddress if no name', () => {
      const userObj = {
        emailAddress: 'user@nutanix.com'
      };
      expect(extractUserName(userObj)).toBe('user@nutanix.com');
    });

    test('UT-USER-001: should return N/A for null/undefined', () => {
      expect(extractUserName(null)).toBe('N/A');
      expect(extractUserName(undefined)).toBe('N/A');
    });
  });

  describe('extractAssigneeName', () => {
    test('should extract assignee name similar to extractUserName', () => {
      const userObj = {
        displayName: 'Assignee Name',
        emailAddress: 'assignee@nutanix.com'
      };
      expect(extractAssigneeName(userObj)).toBe('Assignee Name');
    });
  });

  describe('checkReleaseVersionsAuthorization', () => {
    const orig = process.env.RELEASE_VERSIONS_PAGE_ACCESS;
    afterEach(() => {
      process.env.RELEASE_VERSIONS_PAGE_ACCESS = orig;
    });
    test('should allow authorized users when access is allowlist', () => {
      process.env.RELEASE_VERSIONS_PAGE_ACCESS = 'allowlist';
      expect(checkReleaseVersionsAuthorization('user1').authorized).toBe(true);
      expect(checkReleaseVersionsAuthorization('user2').authorized).toBe(true);
    });
    test('should deny unauthorized users when access is allowlist', () => {
      process.env.RELEASE_VERSIONS_PAGE_ACCESS = 'allowlist';
      expect(checkReleaseVersionsAuthorization('user3').authorized).toBe(false);
    });
    test('should handle email format usernames with allowlist', () => {
      process.env.RELEASE_VERSIONS_PAGE_ACCESS = 'allowlist';
      expect(checkReleaseVersionsAuthorization('user1@nutanix.com').authorized).toBe(true);
    });
    test('should allow any user when access is all (default)', () => {
      process.env.RELEASE_VERSIONS_PAGE_ACCESS = 'all';
      expect(checkReleaseVersionsAuthorization('user3').authorized).toBe(true);
    });
    test('should deny everyone when access is none', () => {
      process.env.RELEASE_VERSIONS_PAGE_ACCESS = 'none';
      expect(checkReleaseVersionsAuthorization('user1').authorized).toBe(false);
      expect(checkReleaseVersionsAuthorization('user3').authorized).toBe(false);
    });
    test('should default to all when env var is not set', () => {
      delete process.env.RELEASE_VERSIONS_PAGE_ACCESS;
      expect(checkReleaseVersionsAuthorization('user3').authorized).toBe(true);
    });
  });
});

