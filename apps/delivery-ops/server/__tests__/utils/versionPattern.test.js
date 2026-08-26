const {
  compileVersionPattern,
  compileVersionPatterns,
  versionMatchesAny,
  versionBelongsToProduct,
} = require('../../utils/versionPattern');

describe('compileVersionPattern', () => {
  test('treats msp* as a glob and never throws', () => {
    expect(() => compileVersionPattern('msp*')).not.toThrow();
    const re = compileVersionPattern('msp*');
    expect(re.test('MSP-1.0')).toBe(true);
    expect(re.test('msp-foo')).toBe(true);
    expect(re.test('amspr')).toBe(false);
    expect(re.test('DataLens-1.0')).toBe(false);
  });

  test('treats *msp* as a contains-glob and never throws Nothing to repeat', () => {
    expect(() => compileVersionPattern('*msp*')).not.toThrow();
    const re = compileVersionPattern('*msp*');
    expect(re).toBeTruthy();
    expect(re.test('MSP-1.0')).toBe(true);
    expect(re.test('foo-msp-bar')).toBe(true);
    expect(re.test('NDB-2.11')).toBe(false);
  });

  test('accepts ^msp* (caret + glob star) as a glob', () => {
    const re = compileVersionPattern('^msp*');
    expect(re.test('MSP-2.1')).toBe(true);
    expect(re.test('ms')).toBe(false);
  });

  test('keeps existing regex patterns working', () => {
    const re = compileVersionPattern('^DataLens.*');
    expect(re.test('DataLens-1.0')).toBe(true);
    expect(re.test('datalens-x')).toBe(true);
    expect(re.test('Analytics-1.0')).toBe(false);
  });

  test('returns null for empty input', () => {
    expect(compileVersionPattern('')).toBeNull();
    expect(compileVersionPattern('   ')).toBeNull();
    expect(compileVersionPattern(null)).toBeNull();
  });

  test('invalid regex does not throw', () => {
    expect(() => compileVersionPattern('^[')).not.toThrow();
    expect(compileVersionPattern('^[')).toBeTruthy();
  });

  test('compileVersionPatterns skips empties', () => {
    const list = compileVersionPatterns(['msp*', '', '^DL.*']);
    expect(list).toHaveLength(2);
  });
});

describe('versionBelongsToProduct', () => {
  const parent = { projectType: 'parent', versionPatterns: ['msp*'] };
  const containsGlob = { projectType: 'parent', versionPatterns: ['*msp*'] };

  test('parent project matches glob versions', () => {
    expect(versionBelongsToProduct(parent, 'MSP-1.0')).toBe(true);
    expect(versionBelongsToProduct(parent, 'NDB-2.11')).toBe(false);
  });

  test('contains-glob *msp* matches MSP names and not NDB', () => {
    expect(versionBelongsToProduct(containsGlob, 'MSP-1.0')).toBe(true);
    expect(versionBelongsToProduct(containsGlob, 'NDB-2.11')).toBe(false);
  });

  test('dedicated product uses release prefix', () => {
    expect(versionBelongsToProduct(
      { projectType: 'dedicated' },
      'NDB-2.11',
      { productPrefix: 'NDB-' }
    )).toBe(true);
    expect(versionBelongsToProduct(
      { projectType: 'dedicated' },
      'MSP-1.0',
      { productPrefix: 'NDB-' }
    )).toBe(false);
  });

  test('pinned names always match', () => {
    expect(versionBelongsToProduct(
      parent,
      'master',
      { activeVersionNames: ['master'] }
    )).toBe(true);
  });

  test('versionMatchesAny is false when nothing compiles', () => {
    expect(versionMatchesAny('MSP-1.0', [])).toBe(false);
  });
});
