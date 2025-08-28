/**
 * Unit Test: WorkingDirectoryManager
 * Tests working directory resolution and management
 */

import * as path from 'path';
import * as os from 'os';

describe('WorkingDirectoryManager', () => {
  let WorkingDirectoryManager: any;
  let manager: any;

  beforeEach(() => {
    jest.resetModules();
    WorkingDirectoryManager = require('../../../src/working-directory-manager').WorkingDirectoryManager;
    manager = new WorkingDirectoryManager();
  });

  describe('constructor', () => {
    it('should create instance without errors', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('setWorkingDirectory', () => {
    it('should set working directory for channel', () => {
      const channelId = 'C1234567890';
      const directory = '/test/directory';
      
      expect(() => {
        manager.setWorkingDirectory(channelId, undefined, undefined, directory);
      }).not.toThrow();
    });

    it('should set working directory for thread', () => {
      const channelId = 'C1234567890';
      const threadTs = '1234567890.123';
      const directory = '/test/thread/directory';
      
      expect(() => {
        manager.setWorkingDirectory(channelId, threadTs, undefined, directory);
      }).not.toThrow();
    });

    it('should handle absolute paths', () => {
      const channelId = 'C1234567890';
      const directory = '/absolute/path/to/project';
      
      expect(() => {
        manager.setWorkingDirectory(channelId, undefined, undefined, directory);
      }).not.toThrow();
    });

    it('should handle relative paths with base directory', () => {
      // Mock BASE_DIRECTORY environment variable
      const originalBaseDir = process.env.BASE_DIRECTORY;
      process.env.BASE_DIRECTORY = '/home/user/projects';
      
      const channelId = 'C1234567890';
      const directory = 'my-project';
      
      expect(() => {
        manager.setWorkingDirectory(channelId, undefined, undefined, directory);
      }).not.toThrow();
      
      // Restore original environment
      if (originalBaseDir) {
        process.env.BASE_DIRECTORY = originalBaseDir;
      } else {
        delete process.env.BASE_DIRECTORY;
      }
    });
  });

  describe('getWorkingDirectory', () => {
    beforeEach(() => {
      // Set up test data
      manager.setWorkingDirectory('C1234567890', undefined, undefined, '/channel/directory');
      manager.setWorkingDirectory('C1234567890', '1234567890.123', undefined, '/thread/directory');
    });

    it('should return thread-specific directory when available', () => {
      const result = manager.getWorkingDirectory('C1234567890', '1234567890.123');
      expect(result).toBe('/thread/directory');
    });

    it('should fallback to channel directory when thread not found', () => {
      const result = manager.getWorkingDirectory('C1234567890', '9999999999.999');
      expect(result).toBe('/channel/directory');
    });

    it('should return undefined when no directory set', () => {
      const result = manager.getWorkingDirectory('C9999999999', undefined);
      expect(result).toBeUndefined();
    });

    it('should handle undefined threadTs', () => {
      const result = manager.getWorkingDirectory('C1234567890', undefined);
      expect(result).toBe('/channel/directory');
    });
  });

  describe('resolveDirectory', () => {
    beforeEach(() => {
      // Mock BASE_DIRECTORY
      process.env.BASE_DIRECTORY = '/home/user/projects';
    });

    afterEach(() => {
      delete process.env.BASE_DIRECTORY;
    });

    it('should return absolute paths unchanged', () => {
      const absolutePath = '/absolute/path/to/project';
      const result = manager.resolveDirectory(absolutePath);
      expect(result).toBe(absolutePath);
    });

    it('should resolve relative paths with base directory', () => {
      const relativePath = 'my-project';
      const result = manager.resolveDirectory(relativePath);
      expect(result).toBe('/home/user/projects/my-project');
    });

    it('should handle paths with ~ (home directory)', () => {
      const homePath = '~/projects/my-project';
      const result = manager.resolveDirectory(homePath);
      expect(result).toBe(path.join(os.homedir(), 'projects/my-project'));
    });

    it('should normalize path separators', () => {
      const pathWithMixedSeparators = '/home/user/projects/../projects/my-project';
      const result = manager.resolveDirectory(pathWithMixedSeparators);
      expect(result).toBe('/home/user/projects/my-project');
    });
  });

  describe('clearWorkingDirectory', () => {
    beforeEach(() => {
      manager.setWorkingDirectory('C1234567890', undefined, undefined, '/test/directory');
    });

    it('should clear channel working directory', () => {
      manager.clearWorkingDirectory('C1234567890');
      const result = manager.getWorkingDirectory('C1234567890');
      expect(result).toBeUndefined();
    });

    it('should clear thread working directory', () => {
      manager.setWorkingDirectory('C1234567890', '1234567890.123', undefined, '/thread/directory');
      manager.clearWorkingDirectory('C1234567890', '1234567890.123');
      
      const threadResult = manager.getWorkingDirectory('C1234567890', '1234567890.123');
      const channelResult = manager.getWorkingDirectory('C1234567890');
      
      expect(threadResult).toBe('/test/directory'); // Should fallback to channel
      expect(channelResult).toBe('/test/directory'); // Channel should still exist
    });
  });

  describe('error handling', () => {
    it('should handle invalid directory paths gracefully', () => {
      expect(() => {
        manager.setWorkingDirectory('C1234567890', undefined, undefined, '');
      }).not.toThrow();
    });

    it('should handle null/undefined inputs', () => {
      expect(() => {
        manager.setWorkingDirectory(null, undefined, undefined, '/test');
      }).not.toThrow();
      
      expect(() => {
        manager.getWorkingDirectory(null, undefined);
      }).not.toThrow();
    });
  });
});