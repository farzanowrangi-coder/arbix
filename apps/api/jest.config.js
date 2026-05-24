module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '@arbix/shared': '<rootDir>/../../packages/shared/src',
    '@arbix/odds-engine': '<rootDir>/../../packages/odds-engine/src',
  },
  setupFilesAfterFramework: ['<rootDir>/src/__tests__/setup.ts'],
};
