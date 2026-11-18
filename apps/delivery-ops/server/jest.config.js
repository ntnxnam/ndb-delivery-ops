const base = require('../jest.config.js');
module.exports = {
  ...base,
  roots: ['<rootDir>'],
  // Override paths that were relative to apps/delivery-ops
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../client/src/$1',
    '^@server/(.*)$': '<rootDir>/$1',
    '^axios$': '<rootDir>/../../../node_modules/axios/dist/node/axios.cjs',
    '^axios/(.*)$': '<rootDir>/../../../node_modules/axios/dist/node/axios.cjs',
    '^node-fetch$': '<rootDir>/../__mocks__/node-fetch.js',
    '^@portfolio-delivery-ops/shared$': '<rootDir>/../__mocks__/@portfolio-delivery-ops/shared.js',
  },
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.js'],
};
