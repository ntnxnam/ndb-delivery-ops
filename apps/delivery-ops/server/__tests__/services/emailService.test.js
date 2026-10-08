/**
 * Unit tests for Email Service
 * Test Plan: UT-EMAIL-001 through UT-EMAIL-007, NEG (relay/timeout)
 * Uses mocked nodemailer so no real SMTP is required.
 */

const mockFns = {
  sendMail: jest.fn(),
  verify: jest.fn()
};

jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: (opts) => mockFns.sendMail(opts),
    verify: () => mockFns.verify()
  })
}));

const {
  getDefaultFromAddress,
  sendEmailDirect,
  parseEmailRecipients,
  formatDateForEmail
} = require('../../services/emailService');

describe('Email Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SMTP_FROM;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getDefaultFromAddress', () => {
    test('UT-EMAIL-001: returns config smtp.from or default when SMTP_FROM not set', () => {
      delete process.env.SMTP_FROM;
      const from = getDefaultFromAddress();
      expect(from).toBe('smtp.ndb.team@nutanix.com');
    });

    test('UT-EMAIL-001: returns SMTP_FROM when set', () => {
      process.env.SMTP_FROM = 'custom@nutanix.com';
      const from = getDefaultFromAddress();
      expect(from).toBe('custom@nutanix.com');
    });
  });

  describe('sendEmailDirect', () => {
    test('UT-EMAIL-002: sets mailOptions.from to default when not provided', async () => {
      let capturedOpts;
      mockFns.sendMail.mockImplementation((opts) => {
        capturedOpts = { ...opts };
        return Promise.resolve({ messageId: '<id>', accepted: [opts.to], rejected: [] });
      });
      await sendEmailDirect({ to: 'a@nutanix.com', subject: 'S', html: 'H' });
      expect(capturedOpts.from).toBe('smtp.ndb.team@nutanix.com');
    });

    test('UT-EMAIL-003: success returns messageId, accepted, rejected', async () => {
      mockFns.sendMail.mockResolvedValue({
        messageId: '<msg-123>',
        accepted: ['to@nutanix.com'],
        rejected: []
      });
      const result = await sendEmailDirect({ to: 'to@nutanix.com', subject: 'S', html: 'H' });
      expect(result).toEqual({
        messageId: '<msg-123>',
        accepted: ['to@nutanix.com'],
        rejected: []
      });
      expect(mockFns.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'smtp.ndb.team@nutanix.com', to: 'to@nutanix.com' })
      );
    });

    test('UT-EMAIL-004: relay error is propagated', async () => {
      const relayError = new Error('Can\'t send mail - all recipients were rejected: 554 5.7.1: Relay access denied');
      mockFns.sendMail.mockRejectedValue(relayError);
      await expect(sendEmailDirect({ to: 'x@nutanix.com', subject: 'S', html: 'H' })).rejects.toThrow(/Relay access denied/);
    });

    test('UT-EMAIL-005: timeout error is propagated', async () => {
      const timeoutError = new Error('Connection timeout');
      timeoutError.code = 'ETIMEDOUT';
      mockFns.sendMail.mockRejectedValue(timeoutError);
      await expect(sendEmailDirect({ to: 'x@nutanix.com', subject: 'S', html: 'H' })).rejects.toThrow('Connection timeout');
    });
  });

  describe('parseEmailRecipients', () => {
    test('UT-EMAIL-006: empty or null returns empty array', () => {
      expect(parseEmailRecipients('')).toEqual([]);
      expect(parseEmailRecipients(null)).toEqual([]);
      expect(parseEmailRecipients(undefined)).toEqual([]);
    });

    test('UT-EMAIL-006: comma-separated list normalized to @nutanix.com', () => {
      expect(parseEmailRecipients('a, b, c')).toEqual(['a@nutanix.com', 'b@nutanix.com', 'c@nutanix.com']);
    });

    test('UT-EMAIL-006: full emails preserved (lowercase)', () => {
      expect(parseEmailRecipients('User@nutanix.com')).toEqual(['user@nutanix.com']);
    });

    test('UT-EMAIL-006: different domain becomes username@nutanix.com', () => {
      expect(parseEmailRecipients('bob@gmail.com')).toEqual(['bob@nutanix.com']);
    });

    test('UT-EMAIL-006: blanks filtered', () => {
      expect(parseEmailRecipients('a,  , b')).toEqual(['a@nutanix.com', 'b@nutanix.com']);
    });

    test('UT-EMAIL-007: malformed "@" normalizes to @nutanix.com (implementation behavior)', () => {
      const result = parseEmailRecipients('@');
      expect(result).toEqual(['@nutanix.com']);
    });

    test('UT-EMAIL-007: malformed "a@b@c" normalizes to a@nutanix.com', () => {
      const result = parseEmailRecipients('a@b@c');
      expect(result).toEqual(['a@nutanix.com']);
    });
  });

  describe('formatDateForEmail', () => {
    test('returns dd/MMM/yyyy format', () => {
      const out = formatDateForEmail();
      expect(out).toMatch(/^\d{2}\/[A-Z][a-z]{2}\/\d{4}$/);
    });
  });
});
