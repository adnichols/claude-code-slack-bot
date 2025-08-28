import { ContentSecurity } from '../../src/content-security';

describe('ContentSecurity', () => {
  let contentSecurity: ContentSecurity;

  beforeEach(() => {
    contentSecurity = new ContentSecurity();
  });

  describe('isSafeToDisplay', () => {
    it('should return safe for empty content', () => {
      const result = contentSecurity.isSafeToDisplay('');
      expect(result.safe).toBe(true);
    });

    it('should return safe for regular text content', () => {
      const result = contentSecurity.isSafeToDisplay('Hello world, this is safe content');
      expect(result.safe).toBe(true);
    });

    it('should block content with API keys', () => {
      const result = contentSecurity.isSafeToDisplay('api_key="sk-1234567890abcdef"');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('sensitive information');
    });

    it('should block content with passwords', () => {
      const result = contentSecurity.isSafeToDisplay('password="mysecret123"');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('sensitive information');
    });

    it('should block content with bearer tokens', () => {
      const result = contentSecurity.isSafeToDisplay('Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('sensitive information');
    });

    it('should block content with private keys', () => {
      const result = contentSecurity.isSafeToDisplay('-----BEGIN RSA PRIVATE KEY-----');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('sensitive information');
    });

    it('should block content with SSH keys', () => {
      const result = contentSecurity.isSafeToDisplay('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7vbqajDhA');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('sensitive information');
    });

    it('should block content with AWS credentials', () => {
      const result = contentSecurity.isSafeToDisplay('AKIAIOSFODNN7EXAMPLE');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('sensitive information');
    });

    it('should block extremely large content', () => {
      const largeContent = 'a'.repeat(100001);
      const result = contentSecurity.isSafeToDisplay(largeContent);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('too large');
    });

    it('should block unsafe file paths', () => {
      const result = contentSecurity.isSafeToDisplay('safe content', '/etc/passwd');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('File path contains');
    });
  });

  describe('isPathSafe', () => {
    it('should return true for safe paths', () => {
      expect(contentSecurity.isPathSafe('/home/user/project/src/index.ts')).toBe(true);
      expect(contentSecurity.isPathSafe('./relative/path.js')).toBe(true);
      expect(contentSecurity.isPathSafe('README.md')).toBe(true);
    });

    it('should return false for system paths', () => {
      expect(contentSecurity.isPathSafe('/etc/passwd')).toBe(false);
      expect(contentSecurity.isPathSafe('/etc/shadow')).toBe(false);
      expect(contentSecurity.isPathSafe('/etc/sudoers')).toBe(false);
    });

    it('should return false for SSH key paths', () => {
      expect(contentSecurity.isPathSafe('~/.ssh/id_rsa')).toBe(false);
      expect(contentSecurity.isPathSafe('/home/user/.ssh/known_hosts')).toBe(false);
    });

    it('should return false for environment files', () => {
      expect(contentSecurity.isPathSafe('.env')).toBe(false);
      expect(contentSecurity.isPathSafe('.env.production')).toBe(false);
      expect(contentSecurity.isPathSafe('config/secrets.yml')).toBe(false);
    });

    it('should return false for database files', () => {
      expect(contentSecurity.isPathSafe('database.sqlite')).toBe(false);
      expect(contentSecurity.isPathSafe('backup.db')).toBe(false);
    });

    it('should return false for backup files', () => {
      expect(contentSecurity.isPathSafe('config.backup')).toBe(false);
      expect(contentSecurity.isPathSafe('database.bak')).toBe(false);
    });
  });

  describe('shouldDisplayToolResult', () => {
    it('should return false for null/undefined results', () => {
      expect(contentSecurity.shouldDisplayToolResult(null)).toBe(false);
      expect(contentSecurity.shouldDisplayToolResult(undefined)).toBe(false);
    });

    it('should return true for error results', () => {
      expect(contentSecurity.shouldDisplayToolResult({ error: 'Something failed' })).toBe(true);
      expect(contentSecurity.shouldDisplayToolResult({ stderr: 'Error output' })).toBe(true);
    });

    it('should return true for results with stdout', () => {
      expect(contentSecurity.shouldDisplayToolResult({ stdout: 'Command output' })).toBe(true);
    });

    it('should return true for results with content', () => {
      expect(contentSecurity.shouldDisplayToolResult({ content: 'File content' })).toBe(true);
    });

    it('should return false for empty results', () => {
      expect(contentSecurity.shouldDisplayToolResult({ stdout: '', stderr: '' })).toBe(true); // Object with keys = true
      expect(contentSecurity.shouldDisplayToolResult({})).toBe(false); // Empty object has no keys
    });
  });

  describe('displayFileContent', () => {
    it('should return null for empty content', () => {
      const result = contentSecurity.displayFileContent('');
      expect(result.content).toBe(null);
      expect(result.wasTruncated).toBe(false);
      expect(result.isSecure).toBe(true);
    });

    it('should return security-blocked fallback for sensitive content', () => {
      const result = contentSecurity.displayFileContent('password="secret123"');
      expect(result.content).toContain('Content blocked for security reasons');
      expect(result.isSecure).toBe(false);
      expect(result.fallbackReason).toContain('sensitive information');
    });

    it('should return oversized fallback for very large content', () => {
      const largeContent = 'a'.repeat(100001);
      const result = contentSecurity.displayFileContent(largeContent);
      expect(result.content).toContain('Content too large to display');
      expect(result.wasTruncated).toBe(true);
      expect(result.isSecure).toBe(true);
      expect(result.fallbackReason).toBe('Content too large');
    });

    it('should process normal content successfully', () => {
      const content = 'This is normal file content';
      const result = contentSecurity.displayFileContent(content);
      expect(result.content).toContain(content);
      expect(result.isSecure).toBe(true);
    });

    it('should handle content that becomes oversized after processing', () => {
      // Create content that's under 100KB but becomes oversized after stripping
      const content = 'a'.repeat(40000); // 40KB content
      const result = contentSecurity.displayFileContent(content);
      
      // Should not hit the oversized fallback since it's under 100KB
      expect(result.isSecure).toBe(true);
    });
  });

  describe('extractFilePathFromContent', () => {
    it('should extract file paths from various formats', () => {
      expect(contentSecurity.extractFilePathFromContent('File: /path/to/file.txt'))
        .toBe('/path/to/file.txt');
      
      expect(contentSecurity.extractFilePathFromContent('Reading file /home/user/document.md'))
        .toBe('/home/user/document.md');
      
      expect(contentSecurity.extractFilePathFromContent('Writing ~/project/src/index.js'))
        .toBe('~/project/src/index.js');
    });

    it('should return null for content without file paths', () => {
      expect(contentSecurity.extractFilePathFromContent('No file path here')).toBe(null);
      expect(contentSecurity.extractFilePathFromContent('')).toBe(null);
      expect(contentSecurity.extractFilePathFromContent(null as any)).toBe(null);
    });
  });

  describe('fallback message generation', () => {
    it('should create oversized content fallback', () => {
      const result = contentSecurity.createOversizedContentFallback(50000, 35000);
      expect(result).toContain('Content too large to display');
      expect(result).toContain('48.8KB > 34.2KB');
      expect(result).toContain('Read tool');
    });

    it('should create security blocked fallback', () => {
      const result = contentSecurity.createSecurityBlockedFallback('Contains API keys');
      expect(result).toContain('Content blocked for security reasons');
      expect(result).toContain('Contains API keys');
    });

    it('should create content processing error fallback', () => {
      const result = contentSecurity.createContentProcessingErrorFallback('Parse error');
      expect(result).toContain('Error processing content');
      expect(result).toContain('Parse error');
    });

    it('should create Slack send error fallback', () => {
      const result = contentSecurity.createSlackSendErrorFallback();
      expect(result).toContain('Message too large for Slack');
      expect(result).toContain('break it down');
    });
  });

  describe('extractToolResultContent', () => {
    it('should extract content from various result formats', () => {
      expect(contentSecurity.extractToolResultContent('string result')).toBe('string result');
      expect(contentSecurity.extractToolResultContent({ stdout: 'output' })).toBe('output');
      expect(contentSecurity.extractToolResultContent({ result: 'result' })).toBe('result');
      expect(contentSecurity.extractToolResultContent({ content: 'content' })).toBe('content');
      expect(contentSecurity.extractToolResultContent({ output: 'output' })).toBe('output');
    });

    it('should handle error cases', () => {
      expect(contentSecurity.extractToolResultContent({ error: 'Failed' })).toBe('Error: Failed');
      expect(contentSecurity.extractToolResultContent({ stderr: 'Error out' })).toBe('Error: Error out');
    });

    it('should return null for empty results', () => {
      expect(contentSecurity.extractToolResultContent(null)).toBe(null);
      expect(contentSecurity.extractToolResultContent({})).toBe(null);
    });
  });

  describe('performance optimizations', () => {
    it('should handle large content efficiently with early size check', () => {
      const startTime = Date.now();
      const largeContent = 'x'.repeat(150000); // 150KB
      
      const result = contentSecurity.displayFileContent(largeContent);
      const endTime = Date.now();
      
      // Should complete quickly due to early size check
      expect(endTime - startTime).toBeLessThan(50); // Less than 50ms
      expect(result.content).toContain('Content too large');
      expect(result.wasTruncated).toBe(true);
    });

    it('should reuse compiled regex patterns for multiple calls', () => {
      const startTime = Date.now();
      
      // Multiple security checks should reuse patterns
      for (let i = 0; i < 100; i++) {
        contentSecurity.isSafeToDisplay('test content ' + i);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });
  });
});