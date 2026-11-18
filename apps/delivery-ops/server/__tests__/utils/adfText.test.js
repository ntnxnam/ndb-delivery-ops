const { extractTextFieldValue, extractPlainTextFieldValue, adfToPlainText } = require('../../utils/adfText');

describe('adfText', () => {
  describe('extractTextFieldValue — HTML path (email, 38460)', () => {
    test('null/undefined → null', () => {
      expect(extractTextFieldValue(null)).toBeNull();
      expect(extractTextFieldValue(undefined)).toBeNull();
    });
    test('string passthrough', () => {
      expect(extractTextFieldValue('hello')).toBe('hello');
    });
    test('ADF doc → HTML', () => {
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] };
      const html = extractTextFieldValue(doc);
      expect(html).toMatch(/<p/);
      expect(html).toContain('hello');
    });
  });

  describe('extractPlainTextFieldValue — plain text path (47780, 55664)', () => {
    test('null/undefined → null', () => {
      expect(extractPlainTextFieldValue(null)).toBeNull();
      expect(extractPlainTextFieldValue(undefined)).toBeNull();
    });
    test('empty string → empty string (caller maps to null)', () => {
      expect(extractPlainTextFieldValue('')).toBe('');
    });
    test('plain string passthrough', () => {
      expect(extractPlainTextFieldValue('Waiting on QE')).toBe('Waiting on QE');
    });
    test('{value} object → value', () => {
      expect(extractPlainTextFieldValue({ value: 'Needs review' })).toBe('Needs review');
    });
    test('ADF paragraph → plain text', () => {
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Risk is high' }] }] };
      expect(extractPlainTextFieldValue(doc).trim()).toBe('Risk is high');
    });
    test('ADF heading + paragraph → multiline', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'body text' }] },
        ],
      };
      const out = extractPlainTextFieldValue(doc);
      expect(out).toContain('Title');
      expect(out).toContain('body text');
    });
    test('ADF bulletList → bullet lines', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item two' }] }] },
        ] }],
      };
      const out = extractPlainTextFieldValue(doc);
      expect(out).toContain('item one');
      expect(out).toContain('item two');
    });
    test('empty ADF doc → empty-ish', () => {
      const doc = { type: 'doc', content: [] };
      expect(extractPlainTextFieldValue(doc).trim()).toBe('');
    });
    test('nested marks (strong/em/link) unwrapped to text', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'hello ', marks: [] },
          { type: 'text', text: 'world', marks: [{ type: 'strong' }] },
        ] }],
      };
      expect(extractPlainTextFieldValue(doc)).toContain('hello world');
    });
    test('cross-check: plain path never contains <p> for same ADF that HTML path wraps', () => {
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
      expect(extractPlainTextFieldValue(doc)).not.toMatch(/<p/i);
      expect(extractTextFieldValue(doc)).toMatch(/<p/i);
    });
  });

  describe('adfToPlainText', () => {
    test('hardBreak → newline', () => {
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' },
      ] }] };
      expect(adfToPlainText(doc)).toContain('\n');
    });
  });
});
