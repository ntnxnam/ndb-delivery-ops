/**
 * Unit tests for email formatting utilities
 * Test Plan: UT-MARKUP-001, UT-MARKUP-002
 */

const {
  formatJiraWikiMarkupForEmail,
  formatContentForEmail,
  convertQuillHtmlToEmail
} = require('../../utils/emailFormatter');

describe('Email Formatter Utilities', () => {
  describe('formatJiraWikiMarkupForEmail', () => {
    test('UT-MARKUP-001: should convert JIRA wiki markup to HTML', () => {
      const input = 'h1. Heading\n* Bold text\n# List item';
      const result = formatJiraWikiMarkupForEmail(input);
      
      expect(result).toMatch(/<h1[\s>]/);
      expect(result).toContain('Heading');
      expect(result).toContain('Bold text');
      expect(result).toContain('List item');
      expect(result).toMatch(/<ul|ol|<li|<strong/);
    });

    test('UT-MARKUP-002: should detect and link JIRA keys', () => {
      const input = 'See FEAT-16821 for details';
      const result = formatJiraWikiMarkupForEmail(input);
      
      expect(result).toContain('<a href');
      expect(result).toContain('FEAT-16821');
      expect(result).toContain('jira.nutanix.com');
    });

    test('should handle multiple JIRA keys', () => {
      const input = 'Related to FEAT-16821 and ERA-12345';
      const result = formatJiraWikiMarkupForEmail(input);
      
      expect(result).toContain('FEAT-16821');
      expect(result).toContain('ERA-12345');
    });

    test('should handle empty/null input', () => {
      expect(formatJiraWikiMarkupForEmail('')).toBe('');
      expect(formatJiraWikiMarkupForEmail(null)).toBe('');
      expect(formatJiraWikiMarkupForEmail(undefined)).toBe('');
    });
  });

  describe('convertQuillHtmlToEmail', () => {
    test('should convert Quill HTML to email-safe HTML', () => {
      const quillHtml = '<p>Test content</p>';
      const result = convertQuillHtmlToEmail(quillHtml);
      
      expect(result).toContain('Test content');
    });

    test('should handle complex Quill HTML', () => {
      const quillHtml = '<h1>Heading</h1><p>Paragraph with <strong>bold</strong> text</p>';
      const result = convertQuillHtmlToEmail(quillHtml);
      
      expect(result).toContain('Heading');
      expect(result).toContain('bold');
    });
  });

  describe('formatContentForEmail', () => {
    test('should detect and format JIRA wiki markup', () => {
      const input = 'h1. Heading';
      const result = formatContentForEmail(input);
      
      expect(result).toMatch(/<h1[\s>]/);
    });

    test('should detect and format Quill HTML', () => {
      const input = '<p>Quill content</p>';
      const result = formatContentForEmail(input);
      
      expect(result).toContain('Quill content');
    });
  });
});

