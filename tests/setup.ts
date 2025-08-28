/**
 * Jest Test Setup
 * Global test configuration and setup for the Claude Code Slack Bot test suite
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DEBUG = 'false'; // Reduce noise during testing

// Mock environment variables for tests
process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.SLACK_APP_TOKEN = 'xapp-test-token';
process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
process.env.ANTHROPIC_API_KEY = 'test-api-key';

// Global test timeout
jest.setTimeout(30000);

// Export module to allow global augmentation
export {};

// Test utilities
(global as any).testUtils = {
  createMockSlackEvent: (overrides = {}) => ({
    user: 'U1234567890',
    channel: 'C1234567890',
    ts: Date.now().toString(),
    text: 'test message',
    ...overrides
  }),
  
  createMockUser: (overrides = {}) => ({
    id: 'U1234567890',
    name: 'testuser',
    real_name: 'Test User',
    ...overrides
  }),
  
  waitForAsync: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
};

// Console override for cleaner test output
const originalConsole = console;
global.console = {
  ...console,
  // Suppress info/debug during tests unless DEBUG=true
  info: process.env.DEBUG === 'true' ? originalConsole.info : () => {},
  debug: process.env.DEBUG === 'true' ? originalConsole.debug : () => {},
  log: process.env.DEBUG === 'true' ? originalConsole.log : () => {},
  // Keep warnings and errors
  warn: originalConsole.warn,
  error: originalConsole.error
};

// Cleanup after each test
afterEach(() => {
  // Clear any timers
  jest.clearAllTimers();
  
  // Reset modules to ensure test isolation
  jest.resetModules();
});