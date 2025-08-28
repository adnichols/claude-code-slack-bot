import { Logger } from './logger.js';
import { MessageFormatter } from './message-formatter.js';
import * as path from 'path';

export interface ContentSecurityResult {
  safe: boolean;
  reason?: string;
}

export interface DisplayableContent {
  content: string | null;
  wasTruncated: boolean;
  isSecure: boolean;
  fallbackReason?: string;
}

export class ContentSecurity {
  private logger = new Logger('ContentSecurity');
  private formatter = new MessageFormatter();
  
  private readonly MAX_CONTENT_LENGTH = 35000; // 35KB limit
  private readonly FALLBACK_TRUNCATE_LENGTH = 400;

  // Pre-compiled regex patterns for better performance
  private readonly sensitivePatterns = [
    // API Keys and tokens
    /(?:api[_-]?key|access[_-]?token|secret[_-]?key|private[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}['\"]/i,
    /(?:bearer|token)\s+[a-zA-Z0-9_-]{20,}/i,
    
    // Database credentials
    /(?:password|pwd|pass)\s*[:=]\s*['\"][^'\"]{3,}['\"]/i,
    /(?:username|user|uid)\s*[:=]\s*['\"][^'\"]{3,}['\"]/i,
    
    // URLs with credentials
    /https?:\/\/[^:]+:[^@]+@/i,
    
    // Private keys
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i,
    /-----BEGIN\s+ENCRYPTED\s+PRIVATE\s+KEY-----/i,
    
    // SSH keys
    /ssh-(?:rsa|dss|ecdsa|ed25519)\s+[A-Za-z0-9+\/=]+/i,
    
    // Common secret formats
    /['\"][a-zA-Z0-9_-]{32,}['\"].*(?:secret|key|token|password)/i,
    
    // AWS/Cloud credentials
    /AKIA[0-9A-Z]{16}/,
    /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]/i,
  ];

  private readonly sensitivePathPatterns = [
    // System directories
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    /\/etc\/hosts/,
    /\/etc\/sudoers/,
    
    // SSH keys
    /\.ssh\/id_[a-z]+/,
    /\.ssh\/known_hosts/,
    /\.ssh\/authorized_keys/,
    
    // Environment and config files that might contain secrets
    /\.env$/,
    /\.env\./,
    /config\/secrets/,
    /\.aws\/credentials/,
    /\.docker\/config\.json/,
    
    // Database files
    /\.sqlite$/,
    /\.db$/,
    /\.sql$/,
    
    // Private directories
    /\/\.git\/config/,
    /\/\.git\/hooks/,
    /\/node_modules\/.*\.key/,
    
    // Backup files that might contain sensitive data
    /\.backup$/,
    /\.bak$/,
    /\.old$/,
    /\.orig$/,
    
    // Log files that might contain sensitive data
    /\/logs\/.*\.log/,
    /\.log$/,
  ];

  /**
   * Check if content is safe to display in Slack
   */
  isSafeToDisplay(content: string, filePath?: string): ContentSecurityResult {
    if (!content) return { safe: true };

    // Early exit for extremely large content (performance optimization)
    if (content.length > 100000) { // 100KB
      return { 
        safe: false, 
        reason: 'Content is too large to display safely' 
      };
    }

    // Check for potentially sensitive patterns using pre-compiled regex
    for (const pattern of this.sensitivePatterns) {
      if (pattern.test(content)) {
        this.logger.warn('Blocked potentially sensitive content', {
          filePath,
          pattern: pattern.toString(),
          contentLength: content.length
        });
        return { 
          safe: false, 
          reason: 'Content may contain sensitive information (API keys, passwords, or credentials)' 
        };
      }
    }

    // Check file path safety
    if (filePath && !this.isPathSafe(filePath)) {
      return { 
        safe: false, 
        reason: 'File path contains potentially sensitive information' 
      };
    }

    return { safe: true };
  }

  /**
   * Check if file path is safe to display
   */
  isPathSafe(filePath: string): boolean {
    const normalizedPath = path.normalize(filePath).toLowerCase();
    return !this.sensitivePathPatterns.some(pattern => pattern.test(normalizedPath));
  }

  /**
   * Determine if tool result should be displayed
   */
  shouldDisplayToolResult(toolResult: any): boolean {
    if (!toolResult || typeof toolResult !== 'object') return false;

    // Always show error results
    if (toolResult.error || toolResult.stderr) return true;

    // Show results with meaningful content
    if (toolResult.stdout && toolResult.stdout.trim()) return true;
    if (toolResult.result && toolResult.result.trim && toolResult.result.trim()) return true;
    if (toolResult.content && typeof toolResult.content === 'string' && toolResult.content.trim()) return true;

    // Show structured data
    if (typeof toolResult === 'object' && Object.keys(toolResult).length > 0) return true;

    return false;
  }

  /**
   * Process and display file content safely (optimized)
   */
  displayFileContent(content: string, toolUseId?: string): DisplayableContent {
    if (!content || content.trim() === '') {
      return {
        content: null,
        wasTruncated: false,
        isSecure: true
      };
    }

    // Performance optimization: Check size before expensive operations
    if (content.length > 100000) { // 100KB safety limit
      this.logger.info('Content blocked for size', {
        actualSize: content.length,
        toolUseId
      });
      
      return {
        content: this.createOversizedContentFallback(content.length, 100000),
        wasTruncated: true,
        isSecure: true,
        fallbackReason: 'Content too large'
      };
    }

    const strippedContent = this.formatter.stripLineNumbers(content);
    const securityCheck = this.isSafeToDisplay(strippedContent);

    if (!securityCheck.safe) {
      this.logger.warn('Content blocked for security reasons', {
        reason: securityCheck.reason,
        toolUseId,
        contentLength: content.length
      });
      
      return {
        content: this.createSecurityBlockedFallback(securityCheck.reason!),
        wasTruncated: false,
        isSecure: false,
        fallbackReason: securityCheck.reason
      };
    }

    // Check size limits after stripping
    if (strippedContent.length > this.MAX_CONTENT_LENGTH) {
      this.logger.info('Content oversized after processing', {
        actualSize: strippedContent.length,
        maxSize: this.MAX_CONTENT_LENGTH,
        toolUseId
      });
      
      return {
        content: this.createOversizedContentFallback(strippedContent.length, this.MAX_CONTENT_LENGTH),
        wasTruncated: true,
        isSecure: true,
        fallbackReason: 'Content too large'
      };
    }

    // Truncate for display
    const { truncated, wasTruncated } = this.formatter.truncateContent(strippedContent, this.FALLBACK_TRUNCATE_LENGTH);

    return {
      content: truncated,
      wasTruncated,
      isSecure: true
    };
  }

  /**
   * Extract file path from content string
   */
  extractFilePathFromContent(content: string): string | null {
    if (!content) return null;

    // Common patterns for file paths in tool outputs
    const pathPatterns = [
      /(?:File|file|Path|path):\s*([^\n\r\s]+)/i,
      /(?:Reading|reading|Writing|writing|Creating|creating)\s+(?:file\s+)?([^\n\r\s]+)/i,
      /(?:^|\s)([\/~][^\n\r\s]*\.[a-zA-Z0-9]+)/,
      /(?:^|\s)([a-zA-Z]:[^\n\r\s]*\.[a-zA-Z0-9]+)/, // Windows paths
    ];

    for (const pattern of pathPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Create fallback message for oversized content
   */
  createOversizedContentFallback(actualSize: number, maxSize: number): string {
    return `📄 *Content too large to display (${(actualSize / 1024).toFixed(1)}KB > ${(maxSize / 1024).toFixed(1)}KB limit)*\n\n` +
           `The output was successful but too large for Slack. You can:\n` +
           `• Use the Read tool to view specific sections\n` +
           `• Ask me to summarize the key points\n` +
           `• Request specific information from the output`;
  }

  /**
   * Create fallback message for security-blocked content
   */
  createSecurityBlockedFallback(reason: string): string {
    return `🔒 *Content blocked for security reasons*\n\n` +
           `Reason: ${reason}\n\n` +
           `The operation completed but the output contains potentially sensitive information ` +
           `and cannot be displayed in Slack for security reasons.`;
  }

  /**
   * Create fallback message for processing errors
   */
  createContentProcessingErrorFallback(errorMessage: string): string {
    return `⚠️ *Error processing content*\n\n` +
           `Error: ${errorMessage}\n\n` +
           `The operation may have completed, but there was an issue displaying the results.`;
  }

  /**
   * Create fallback message for Slack send errors
   */
  createSlackSendErrorFallback(): string {
    return `📤 *Message too large for Slack*\n\n` +
           `The response was successful but too large to send. ` +
           `Please ask me to break it down or summarize the key points.`;
  }

  /**
   * Extract tool result content safely
   */
  extractToolResultContent(toolResult: any): string | null {
    if (!toolResult) return null;

    // Handle different result formats
    if (typeof toolResult === 'string') return toolResult;
    if (toolResult.stdout) return toolResult.stdout;
    if (toolResult.result) return toolResult.result;
    if (toolResult.content) return toolResult.content;
    if (toolResult.output) return toolResult.output;

    // Handle error cases
    if (toolResult.error) return `Error: ${toolResult.error}`;
    if (toolResult.stderr) return `Error: ${toolResult.stderr}`;

    return null;
  }
}