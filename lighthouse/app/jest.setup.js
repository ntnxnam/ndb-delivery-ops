// Jest setup file
// Global test configuration

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.REACT_APP_ENABLE_RELEASE_VERSIONS = 'true';

// Suppress console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};

