/**
 * Integration tests for Email API endpoints
 * Test Plan: IT-EMAIL-001, IT-EMAIL-002; NEG-EMAIL-001, NEG-EMAIL-002, NEG-EMAIL-005
 * Uses mocked nodemailer and mocked JIRA auth so no real SMTP or JIRA is required.
 */

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: (opts) => mockSendMail(opts),
    verify: () => Promise.resolve()
  })
}));

jest.mock('../../middleware/auth/jira', () => {
  const actual = jest.requireActual('../../middleware/auth/jira');
  return {
    ...actual,
    validateJiraTokenMiddleware: (req, res, next) => {
      if (!req.headers.authorization) {
        return next();
      }
      req.jiraUser = { emailAddress: 'test@nutanix.com' };
      req.username = 'test.user';
      next();
    }
  };
});

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../../index');

const columnsConfigPath = path.join(__dirname, '../../config/releaseVersionsColumnsConfig.json');
const columnsConfig = JSON.parse(fs.readFileSync(columnsConfigPath, 'utf8'));
const defaultVersion = columnsConfig.defaultReleaseVersion;

const REQUIRED_SECTIONS = 'Highlights Lowlights Support needed from leaders';

describe('Email API Integration Tests', () => {
  const baseHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-token'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RELEASE_VERSIONS_EMAIL_ACCESS = process.env.RELEASE_VERSIONS_EMAIL_ACCESS || 'all';
    mockSendMail.mockResolvedValue({
      messageId: '<integration-test-id>',
      accepted: ['test@nutanix.com'],
      rejected: []
    });
  });

  describe('POST /api/email/send-release-versions', () => {
    test('IT-EMAIL-001: Should send release versions email when mock succeeds', async () => {
      const testData = {
        selectedVersion: defaultVersion,
        tableHTML: '<table><tr><td>Test</td></tr></table>',
        highlights: '<p>Highlights content</p>',
        lowlights: '<p>Lowlights content</p>',
        callToAction: '<p>Call to action</p>',
        emailRecipients: 'test@nutanix.com',
        jiraToken: 'test-token',
        username: 'test.user'
      };

      const response = await request(app)
        .post('/api/email/send-release-versions')
        .set(baseHeaders)
        .send(testData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('messageId', '<integration-test-id>');
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'svc.ndb.team@nutanix.com',
        replyTo: 'test@nutanix.com',
        subject: expect.stringContaining('NDB Consolidated Status Summary')
      }));
    });

    test('NEG-EMAIL-005: Should return 400 when no version selected', async () => {
      const testData = {
        tableHTML: '<table><tr><td>Test</td></tr></table>',
        highlights: '<p>H</p>',
        lowlights: '<p>L</p>',
        callToAction: '<p>C</p>',
        emailRecipients: 'test@nutanix.com',
        jiraToken: 'test-token',
        username: 'test.user'
      };

      const response = await request(app)
        .post('/api/email/send-release-versions')
        .set(baseHeaders)
        .send(testData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/No version selected/i);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    test('NEG-EMAIL-005: Should return 400 when no table HTML provided', async () => {
      const testData = {
        selectedVersion: defaultVersion,
        tableHTML: '',
        highlights: '<p>H</p>',
        lowlights: '<p>L</p>',
        callToAction: '<p>C</p>',
        emailRecipients: 'test@nutanix.com',
        jiraToken: 'test-token',
        username: 'test.user'
      };

      const response = await request(app)
        .post('/api/email/send-release-versions')
        .set(baseHeaders)
        .send(testData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/No table HTML/i);
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/email/send', () => {
    test('IT-EMAIL-002: Should send general email when mock succeeds', async () => {
      const testData = {
        executiveSummary: 'Test summary',
        additionalDetails: `<p>${REQUIRED_SECTIONS}</p><p>Highlights</p><p>Lowlights</p><p>Support needed from leaders</p>`,
        emailRecipients: 'test@nutanix.com',
        jiraToken: 'test-token',
        username: 'test.user'
      };

      const response = await request(app)
        .post('/api/email/send')
        .set(baseHeaders)
        .send(testData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'svc.ndb.team@nutanix.com',
        replyTo: 'test@nutanix.com'
      }));
    });

    test('NEG-EMAIL-002: Should return 400 when additionalDetails missing', async () => {
      const testData = {
        executiveSummary: 'Test summary',
        emailRecipients: 'test@nutanix.com',
        jiraToken: 'test-token',
        username: 'test.user'
      };

      const response = await request(app)
        .post('/api/email/send')
        .set(baseHeaders)
        .send(testData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/Highlights and Lowlights is required/i);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    test('NEG-EMAIL-003: Should return 400 when required sections missing', async () => {
      const testData = {
        executiveSummary: 'Test summary',
        additionalDetails: '<p>Only highlights here</p>',
        emailRecipients: 'test@nutanix.com',
        jiraToken: 'test-token',
        username: 'test.user'
      };

      const response = await request(app)
        .post('/api/email/send')
        .set(baseHeaders)
        .send(testData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/must include all sections/i);
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  describe('NEG-EMAIL-001: No JIRA user / token', () => {
    test('POST /api/email/send without Authorization returns 400 (no JIRA user)', async () => {
      const testData = {
        executiveSummary: 'Test summary',
        additionalDetails: `<p>${REQUIRED_SECTIONS}</p><p>Highlights</p><p>Lowlights</p>`,
        emailRecipients: 'test@nutanix.com'
      };

      const response = await request(app)
        .post('/api/email/send')
        .set('Content-Type', 'application/json')
        .send(testData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/JIRA user email is required/i);
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  describe('NEG-EMAIL-008: Relay / send failure', () => {
    test('When sendMail rejects, returns 500 with safe message', async () => {
      // All SMTP attempts (primary + all fallbacks) must fail to get a 500 response.
      mockSendMail.mockRejectedValue(new Error('554 5.7.1: Relay access denied'));

      const testData = {
        selectedVersion: defaultVersion,
        tableHTML: '<table><tr><td>Test</td></tr></table>',
        highlights: '<p>H</p>',
        lowlights: '<p>L</p>',
        callToAction: '<p>C</p>',
        emailRecipients: 'test@nutanix.com',
        jiraToken: 'test-token',
        username: 'test.user'
      };

      const response = await request(app)
        .post('/api/email/send-release-versions')
        .set(baseHeaders)
        .send(testData);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).not.toMatch(/\n\s*at\s+/);

      // Restore default resolved value so subsequent tests are not affected
      mockSendMail.mockResolvedValue({ messageId: '<integration-test-id>', accepted: ['test@nutanix.com'], rejected: [] });
    });
  });
});
