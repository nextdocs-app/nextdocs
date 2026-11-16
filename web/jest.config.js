// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  // Prevent Jest from clearing module cache between tests
  resetModules: false,
  coverageDirectory: 'coverage',
  coverageReporters: ['lcov', 'text-summary'],
  // Without this Jest reports only files a test imported, so an untested module
  // silently disappears from coverage instead of showing up as 0%.
  collectCoverageFrom: ['**/*.{ts,tsx}', '!**/*.d.ts', '!**/.next/**', '!**/tests/**'],
};

module.exports = createJestConfig(customJestConfig);
