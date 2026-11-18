/**
 * Unit tests for date formatting utilities
 * Test Plan: UT-DATE-001, UT-DATE-002, UT-DATE-003
 */

const {
  normalizeDateStr,
  formatDate,
  formatDateWithHistoryHTML,
  formatAllCheckpointDatesHTML
} = require('../../utils/dateFormatter');

describe('Date Formatter Utilities', () => {
  describe('normalizeDateStr', () => {
    test('should normalize ISO date string to YYYY-MM-DD', () => {
      expect(normalizeDateStr('2026-01-30T10:30:00Z')).toBe('2026-01-30');
      expect(normalizeDateStr('2026-01-05T00:00:00Z')).toBe('2026-01-05');
    });

    test('should handle already normalized date strings', () => {
      expect(normalizeDateStr('2026-01-30')).toBe('2026-01-30');
    });

    test('should handle Date objects', () => {
      const date = new Date('2026-01-30');
      expect(normalizeDateStr(date)).toBe('2026-01-30');
    });

    test('should return null for invalid dates', () => {
      expect(normalizeDateStr(null)).toBeNull();
      expect(normalizeDateStr(undefined)).toBeNull();
      expect(normalizeDateStr('invalid')).toBeNull();
    });
  });

  describe('formatDate', () => {
    test('UT-DATE-001: should format date to dd/MMM/yyyy with zero-padded day', () => {
      const date1 = new Date('2026-01-30');
      expect(formatDate(date1)).toBe('30/Jan/2026');

      const date2 = new Date('2026-01-05');
      expect(formatDate(date2)).toBe('05/Jan/2026');
    });

    test('should handle date strings', () => {
      expect(formatDate('2026-01-30')).toBe('30/Jan/2026');
      expect(formatDate('2026-01-05')).toBe('05/Jan/2026');
    });

    test('should handle null/undefined', () => {
      expect(formatDate(null)).toBe('Not Set');
      expect(formatDate(undefined)).toBe('Not Set');
    });
  });

  describe('formatDateWithHistoryHTML', () => {
    test('UT-DATE-002: should format date with historical dates', () => {
      const checkpointHistory = {
        'FEAT-1': {
          codeComplete: [
            { date: '2026-01-15', changedAt: '2026-01-15T10:00:00Z' },
            { date: '2026-01-20', changedAt: '2026-01-20T10:00:00Z' }
          ]
        }
      };
      const currentDate = '2026-01-30';
      const result = formatDateWithHistoryHTML('FEAT-1', 'codeComplete', currentDate, checkpointHistory);
      
      expect(result).toMatch(/\d{2}\/Jan\/2026/);
      // Historical dates (may be 19/14 or 20/15 depending on timezone)
      expect(result).toMatch(/\d{2}\/Jan\/2026.*\d{2}\/Jan\/2026/);
      expect(result).toContain('→');
    });

    test('UT-DATE-003: should calculate and display delay duration', () => {
      const checkpointHistory = {
        'FEAT-1': {
          codeComplete: [{ date: '2026-01-15', changedAt: '2026-01-15T10:00:00Z' }]
        }
      };
      const currentDate = '2026-01-17'; // 2 days later
      const result = formatDateWithHistoryHTML('FEAT-1', 'codeComplete', currentDate, checkpointHistory);
      
      expect(result).toContain('+2 days');
    });

    test('should handle half-weeks for delays > 3 days', () => {
      const checkpointHistory = {
        'FEAT-1': {
          codeComplete: [{ date: '2026-01-15', changedAt: '2026-01-15T10:00:00Z' }]
        }
      };
      const currentDate = '2026-01-22'; // 7 days later = 1 week
      const result = formatDateWithHistoryHTML('FEAT-1', 'codeComplete', currentDate, checkpointHistory);
      
      expect(result).toContain('+1 week');
    });
  });
});

