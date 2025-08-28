import { Logger } from './logger.js';

export class MessageFormatter {
  private logger = new Logger('MessageFormatter');

  /**
   * Extract text content from SDK message
   */
  extractTextContent(message: any): string | null {
    const content = message.message?.content;
    if (!content || !Array.isArray(content)) return null;

    const textParts = content.filter((part: any) => part.type === 'text' && part.text);
    return textParts.length > 0 ? textParts.map((part: any) => part.text).join('\n') : null;
  }

  /**
   * Format tool use for display
   */
  formatToolUse(content: any[]): string {
    const toolUses = content.filter((part: any) => part.type === 'tool_use');
    if (toolUses.length === 0) return '';

    const formattedTools = toolUses.map((toolUse: any) => {
      const { name, input } = toolUse;
      
      switch (name) {
        case 'Edit':
        case 'MultiEdit':
          return this.formatEditTool(name, input);
        case 'Write':
          return this.formatWriteTool(input);
        case 'Read':
          return this.formatReadTool(input);
        case 'Bash':
          return this.formatBashTool(input);
        case 'TodoWrite':
          return this.handleTodoWrite(input);
        default:
          return this.formatGenericTool(name, input);
      }
    }).filter(Boolean);

    return formattedTools.join('\n\n');
  }

  private formatEditTool(toolName: string, input: any): string {
    const filePath = input?.file_path || input?.notebook_path || 'unknown file';
    
    if (toolName === 'MultiEdit' && input?.edits) {
      return `🔧 **${toolName}**: Making ${input.edits.length} edit(s) to \`${this.truncateString(filePath, 50)}\``;
    } else if (input?.old_string && input?.new_string) {
      return `🔧 **${toolName}**: Editing \`${this.truncateString(filePath, 50)}\``;
    }
    
    return `🔧 **${toolName}**: Modifying \`${this.truncateString(filePath, 50)}\``;
  }

  private formatWriteTool(input: any): string {
    const filePath = input?.file_path || 'unknown file';
    return `📝 **Write**: Creating/updating \`${this.truncateString(filePath, 50)}\``;
  }

  private formatReadTool(input: any): string {
    const filePath = input?.file_path || 'unknown file';
    return `📖 **Read**: Reading \`${this.truncateString(filePath, 50)}\``;
  }

  private formatBashTool(input: any): string {
    const command = input?.command || 'unknown command';
    return `💻 **Bash**: \`${this.truncateString(command, 60)}\``;
  }

  private formatGenericTool(toolName: string, input: any): string {
    return `⚙️ **${toolName}**: ${this.truncateString(JSON.stringify(input), 60)}`;
  }

  private truncateString(str: string, maxLength: number): string {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Handle TodoWrite tool formatting
   */
  handleTodoWrite(input: any): string {
    if (!input?.todos || !Array.isArray(input.todos)) return '';
    return '📋 **Task List Updated**';
  }

  /**
   * Format final message
   */
  formatMessage(text: string, isFinal: boolean): string {
    if (!text) return '';
    
    // Remove any existing status indicators to avoid duplication
    const cleanText = text
      .replace(/^[🤔⚙️✅❌]\s*/, '')
      .trim();
    
    if (isFinal) {
      return cleanText;
    } else {
      return `⚙️ ${cleanText}`;
    }
  }

  /**
   * Get language identifier from file path for syntax highlighting
   */
  getLanguageFromPath(filePath?: string): string {
    if (!filePath) return '';
    
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'rs': 'rust',
      'scala': 'scala',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'ps1': 'powershell',
      'sql': 'sql',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'conf': 'ini',
      'cfg': 'ini',
      'md': 'markdown',
      'markdown': 'markdown',
      'tex': 'latex',
      'r': 'r',
      'R': 'r',
      'vim': 'vim',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'cmake': 'cmake',
      'gradle': 'gradle',
      'maven': 'xml'
    };
    
    return languageMap[ext || ''] || '';
  }

  /**
   * Strip line numbers from content (format: "   123→content")
   */
  stripLineNumbers(content: string): string {
    return content
      .split('\n')
      .map(line => {
        // Match pattern: optional spaces + digits + → + content
        const match = line.match(/^(\s*\d+→)(.*)$/);
        return match ? match[2] : line;
      })
      .join('\n');
  }

  /**
   * Truncate content to a maximum length
   */
  truncateContent(content: string, maxLength: number = 400): { truncated: string; wasTruncated: boolean } {
    if (!content || content.length <= maxLength) {
      return { truncated: content, wasTruncated: false };
    }

    // Try to truncate at the last complete line within the limit
    const lines = content.split('\n');
    let truncated = '';
    let totalLength = 0;

    for (const line of lines) {
      const lineWithNewline = truncated ? '\n' + line : line;
      if (totalLength + lineWithNewline.length <= maxLength - 10) { // Reserve space for "..."
        truncated += lineWithNewline;
        totalLength += lineWithNewline.length;
      } else {
        break;
      }
    }

    // If we couldn't fit even one line, just truncate the first line
    if (!truncated && lines.length > 0) {
      truncated = lines[0].substring(0, maxLength - 10);
    }

    return {
      truncated: truncated + '\n\n*[Content truncated...]*',
      wasTruncated: true
    };
  }
}