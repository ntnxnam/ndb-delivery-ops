import { detectContext, filterPrefix } from '../jqlAutocompleteLogic';

describe('jqlAutocompleteLogic', () => {
  test('field completion for prefix "pro"', () => {
    const ctx = detectContext('pro', 3);
    expect(ctx.kind).toBe('field');
    expect(ctx.typed).toBe('pro');
    expect(filterPrefix(['project', 'priority', 'status'], ctx.typed)).toContain('project');
  });

  test('value completion after field operator', () => {
    const ctx = detectContext('status = In', 11);
    expect(ctx.kind).toBe('value');
    expect(ctx.field).toBe('status');
    expect(ctx.typedVal).toBe('In');
  });

  test('no suggestions inside double quotes', () => {
    const ctx = detectContext('status = "In Progress', 20);
    expect(ctx.kind).toBe('none');
  });

  test('escaped quote does not close string', () => {
    const ctx = detectContext('summary ~ "a \\"b', 15);
    expect(ctx.kind).toBe('none');
  });

  test('field after AND', () => {
    const ctx = detectContext('project = ERA AND sta', 21);
    expect(ctx.kind).toBe('field');
    expect(ctx.typed).toBe('sta');
  });

  test('field after operator context with trailing space', () => {
    const ctx = detectContext('project = ERA AND ', 18);
    expect(ctx.kind).toBe('field');
    // After "AND " with trailing space, typed is empty — no token
    expect(['', 'AND']).toContain(ctx.typed);
  });

  test('filterPrefix prefers startsWith', () => {
    expect(filterPrefix(['project', 'reporter', 'priority'], 'pro')).toEqual(['project']);
  });
});
