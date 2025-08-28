/**
 * Unit Test: Logger
 * Tests the logging utility functionality
 */

describe('Logger', () => {
  let Logger: any;

  beforeEach(() => {
    jest.resetModules();
    Logger = require('../../../src/logger').Logger;
    
    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create logger with component name', () => {
      const logger = new Logger('TestComponent');
      expect(logger).toBeDefined();
    });

    it('should handle empty component name', () => {
      const logger = new Logger('');
      expect(logger).toBeDefined();
    });
  });

  describe('logging methods', () => {
    let logger: any;

    beforeEach(() => {
      logger = new Logger('TestComponent');
    });

    it('should log info messages', () => {
      logger.info('Test info message');
      expect(console.log).toHaveBeenCalled();
    });

    it('should log warn messages', () => {
      logger.warn('Test warn message');
      expect(console.warn).toHaveBeenCalled();
    });

    it('should log error messages', () => {
      logger.error('Test error message');
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle messages with context objects', () => {
      const context = { userId: 'U123', channel: 'C456' };
      logger.info('Test message with context', context);
      expect(console.log).toHaveBeenCalled();
    });

    it('should handle error objects', () => {
      const error = new Error('Test error');
      logger.error('Error occurred', error);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    let logger: any;

    beforeEach(() => {
      logger = new Logger('TestComponent');
    });

    it('should include timestamp in log messages', () => {
      logger.info('Test message');
      
      const logCall = (console.log as jest.Mock).mock.calls[0][0];
      expect(logCall).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp pattern
    });

    it('should include component name in log messages', () => {
      logger.info('Test message');
      
      const logCall = (console.log as jest.Mock).mock.calls[0][0];
      expect(logCall).toContain('TestComponent');
    });

    it('should include log level in messages', () => {
      logger.info('Test message');
      
      const logCall = (console.log as jest.Mock).mock.calls[0][0];
      expect(logCall).toContain('INFO');
    });
  });

  describe('debug mode', () => {
    beforeEach(() => {
      // Reset environment
      delete process.env.DEBUG;
    });

    it('should respect DEBUG environment variable', () => {
      process.env.DEBUG = 'true';
      jest.resetModules();
      const DebugLogger = require('../../../src/logger').Logger;
      
      const logger = new DebugLogger('TestComponent');
      logger.debug('Debug message');
      
      // Debug messages should be logged when DEBUG=true
      expect(console.log).toHaveBeenCalled();
    });

    it('should suppress debug messages when DEBUG is false', () => {
      process.env.DEBUG = 'false';
      jest.resetModules();
      const DebugLogger = require('../../../src/logger').Logger;
      
      const logger = new DebugLogger('TestComponent');
      logger.debug('Debug message');
      
      // Debug messages should be suppressed
      expect(console.log).not.toHaveBeenCalled();
    });
  });
});