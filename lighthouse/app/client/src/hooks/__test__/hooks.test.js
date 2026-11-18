/**
 * Basic integration test for custom hooks
 * This file tests that hooks can be imported and have correct structure
 */

import { 
  useReleaseVersions,
  useColumnConfig,
  useGanttConfig,
  useCheckpointHistory,
  useEmailForm
} from '../index';

// Note: This is a structure test, not a runtime test
// Runtime tests would require React Testing Library and proper setup

describe('Custom Hooks Structure', () => {
  test('All hooks should be exported', () => {
    expect(useReleaseVersions).toBeDefined();
    expect(useColumnConfig).toBeDefined();
    expect(useGanttConfig).toBeDefined();
    expect(useCheckpointHistory).toBeDefined();
    expect(useEmailForm).toBeDefined();
  });

  test('Hooks should be functions', () => {
    expect(typeof useReleaseVersions).toBe('function');
    expect(typeof useColumnConfig).toBe('function');
    expect(typeof useGanttConfig).toBe('function');
    expect(typeof useCheckpointHistory).toBe('function');
    expect(typeof useEmailForm).toBe('function');
  });
});

