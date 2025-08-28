export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  coverageThreshold: {
    global: { 
      functions: 80, 
      lines: 80, 
      branches: 75, 
      statements: 80 
    }
  },
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  
  // File patterns
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.test.js'
  ],
  
  // Coverage settings
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts', // Entry point - difficult to test
    '!src/types.ts'  // Type definitions only
  ],
  
  // Module resolution
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true
    }],
  },
  
  // Module name mapping for ES modules
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  
  // No external mocks needed with native fetch
  
  // Performance and memory
  maxWorkers: '50%', // Limit concurrent workers
  cache: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  
  // Verbose output for safety verification
  verbose: true,
  
  // Fail fast on first test failure for safety
  bail: 1,
  
  // Error handling
  errorOnDeprecated: true,
  
  // Timeout for individual tests
  testTimeout: 10000,
  
  // Clear mocks between tests for isolation
  clearMocks: true,
  restoreMocks: true,
};