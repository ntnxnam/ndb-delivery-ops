module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/server'],
  testPathIgnorePatterns: [
    '/node_modules/',
    // All client/src tests use JSX/ESM (import syntax, @testing-library/react, etc.)
    // and must be run via `cd client && npm test` (react-scripts, Babel+JSX transform).
    // The top-level Jest config is CJS-only and cannot handle these files.
    'client/src'
  ],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'server/**/*.js',
    'client/src/**/*.js',
    '!**/node_modules/**',
    '!**/build/**',
    '!**/__tests__/**',
    '!**/*.test.js',
    '!**/*.spec.js'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/client/src/$1',
    '^@server/(.*)$': '<rootDir>/server/$1',
    // axios v1.x ships an ESM index.js; redirect to bundled CJS build
    '^axios$': '<rootDir>/server/node_modules/axios/dist/node/axios.cjs',
    '^axios/(.*)$': '<rootDir>/server/node_modules/axios/dist/node/axios.cjs',
    // node-fetch v3 is pure ESM; use a CJS stub in tests
    '^node-fetch$': '<rootDir>/__mocks__/node-fetch.js',
    // @portfolio-delivery-ops/shared is "type":"module" (pure ESM); use a CJS stub in tests
    '^@portfolio-delivery-ops/shared$': '<rootDir>/__mocks__/@portfolio-delivery-ops/shared.js'
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};

