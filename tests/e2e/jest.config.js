module.exports = {
  maxWorkers: 1,
  testTimeout: 600_000,
  // The Breez Spark Node SDK keeps handles open after disconnect(); without this the run never exits.
  forceExit: true,
  verbose: true,
  reporters: ['detox/runners/jest/reporter'],
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  testEnvironment: 'detox/runners/jest/testEnvironment',
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.spec.js'],
  transform: {
    '\\.[jt]sx?$': ['ts-jest'],
  },
};
