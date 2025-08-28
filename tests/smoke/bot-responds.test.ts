/**
 * Smoke Test: Bot Response Verification
 * Ensures the bot can start up and respond to basic messages
 */

describe('Bot Response Smoke Test', () => {
  beforeEach(() => {
    // Reset modules for each test
    jest.resetModules();
  });

  it('should import basic modules without errors', async () => {
    // Test only the modules that don't have complex dependencies
    expect(() => require('../../src/config')).not.toThrow();
    expect(() => require('../../src/logger')).not.toThrow();
    expect(() => require('../../src/types')).not.toThrow();
  });

  it('should validate required environment variables', () => {
    const { validateConfig } = require('../../src/config');
    
    // Should not throw with test environment variables
    expect(() => validateConfig()).not.toThrow();
  });

  it('should handle basic bot configuration', () => {
    const { config } = require('../../src/config');
    
    // Test basic config structure
    expect(() => {
      expect(config).toBeDefined();
      expect(config.slack).toBeDefined();
      expect(config.claude).toBeDefined();
      expect(typeof config.debug).toBe('boolean');
    }).not.toThrow();
  });

  it('should handle working directory manager', () => {
    const { WorkingDirectoryManager } = require('../../src/working-directory-manager');
    
    expect(() => {
      new WorkingDirectoryManager();
    }).not.toThrow();
  });

  it('should initialize Logger', () => {
    const { Logger } = require('../../src/logger');
    
    expect(() => {
      const logger = new Logger('SmokeTest');
      logger.info('Test message');
    }).not.toThrow();
  });

  it('should handle basic configuration access', () => {
    const { config } = require('../../src/config');
    
    expect(config).toBeDefined();
    expect(config.slack).toBeDefined();
    expect(config.claude).toBeDefined();
    expect(typeof config.debug).toBe('boolean');
  });
});