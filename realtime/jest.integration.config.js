/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.test.json',
        compiler: '@typescript/typescript6',
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  globalSetup: '<rootDir>/tests/integration/global-setup.mjs',
  // Every file shares one Yhub schema, one Redis and one built dist/, so they run serially.
  maxWorkers: 1,
  testTimeout: 60_000,
  verbose: true,
};
