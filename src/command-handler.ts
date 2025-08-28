import { Logger } from './logger';
import { WorkingDirectoryManager } from './working-directory-manager';
import { McpManager } from './mcp-manager';

export interface CommandResult {
  handled: boolean;
  response?: string;
  success?: boolean;
}

export class CommandHandler {
  private logger = new Logger('CommandHandler');
  private workingDirManager: WorkingDirectoryManager;
  private mcpManager: McpManager;

  constructor(workingDirManager: WorkingDirectoryManager, mcpManager: McpManager) {
    this.workingDirManager = workingDirManager;
    this.mcpManager = mcpManager;
  }

  /**
   * Process command and return result
   */
  async processCommand(
    text: string,
    channel: string,
    user: string,
    thread_ts?: string
  ): Promise<CommandResult> {
    if (!text) return { handled: false };

    // Check for working directory command
    const setDirPath = this.workingDirManager.parseSetCommand(text);
    if (setDirPath) {
      return this.handleWorkingDirectoryCommand(setDirPath, channel, user, thread_ts);
    }

    // Check for MCP commands
    if (this.isMcpInfoCommand(text)) {
      return this.handleMcpInfoCommand();
    }

    if (this.isMcpReloadCommand(text)) {
      return this.handleMcpReloadCommand();
    }

    return { handled: false };
  }

  /**
   * Handle working directory command
   */
  private handleWorkingDirectoryCommand(
    setDirPath: string,
    channel: string,
    user: string,
    thread_ts?: string
  ): CommandResult {
    const isDM = channel.startsWith('D');
    const result = this.workingDirManager.setWorkingDirectory(
      channel,
      setDirPath,
      thread_ts,
      isDM ? user : undefined
    );

    if (result.success) {
      const context = thread_ts ? 'this thread' : (isDM ? 'this conversation' : 'this channel');
      return {
        handled: true,
        success: true,
        response: `✅ Working directory set for ${context}: \`${result.resolvedPath}\``
      };
    } else {
      return {
        handled: true,
        success: false,
        response: `❌ ${result.error}`
      };
    }
  }

  /**
   * Handle MCP info command
   */
  private handleMcpInfoCommand(): CommandResult {
    const servers = this.mcpManager.getServerConfiguration();
    
    if (!servers || Object.keys(servers).length === 0) {
      return {
        handled: true,
        success: true,
        response: '🔧 **MCP Servers**: No MCP servers configured.\n\nTo add servers, create or update `mcp-servers.json` in the project root.'
      };
    }

    const serverList = Object.entries(servers)
      .map(([name, config]: [string, any]) => `• **${name}** (${config.command || 'unknown'})`)
      .join('\n');

    return {
      handled: true,
      success: true,
      response: `🔧 **MCP Servers Configured**:\n${serverList}\n\nUse \`mcp reload\` to reload configuration.`
    };
  }

  /**
   * Handle MCP reload command
   */
  private handleMcpReloadCommand(): CommandResult {
    try {
      this.mcpManager.reloadConfiguration();
      this.logger.info('MCP configuration reloaded via command');
      return {
        handled: true,
        success: true,
        response: '✅ MCP configuration reloaded successfully.'
      };
    } catch (error) {
      this.logger.error('Failed to reload MCP configuration', error);
      return {
        handled: true,
        success: false,
        response: `❌ Failed to reload MCP configuration: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Check if text is MCP info command
   */
  private isMcpInfoCommand(text: string): boolean {
    const trimmed = text.toLowerCase().trim();
    return trimmed === 'mcp' || trimmed === 'mcp info' || trimmed === 'mcp list';
  }

  /**
   * Check if text is MCP reload command
   */
  private isMcpReloadCommand(text: string): boolean {
    const trimmed = text.toLowerCase().trim();
    return trimmed === 'mcp reload' || trimmed === 'reload mcp';
  }

  /**
   * Generate channel join welcome message
   */
  getChannelJoinMessage(): string {
    const supportedFiles = [
      'Images: jpg/jpeg, png, gif, webp, svg, bmp, tiff',
      'Text files: txt, md, json, js, ts, py, java, etc.',
      'Documents: pdf, docx (limited support)',
      'Code files: most programming languages'
    ];

    return '👋 **Hi there! I\'m Claude Code, your AI coding assistant.**\n\n' +
           '**Getting Started:**\n' +
           '• Set a working directory: `cwd /path/to/project` or `cwd project-name`\n' +
           '• Ask me questions: `@Claude Code help me debug this error`\n' +
           '• Upload files for analysis (I support many formats)\n' +
           '• Use threads for focused conversations\n\n' +
           '**Supported File Types:**\n' +
           supportedFiles.map(type => `• ${type}`).join('\n') + '\n\n' +
           '**Special Commands:**\n' +
           '• `mcp` - View configured MCP servers\n' +
           '• `mcp reload` - Reload MCP configuration\n\n' +
           '**Working Directory:**\n' +
           'Please set a working directory to get started. This helps me understand your project context.\n' +
           '`cwd /absolute/path/to/project` or `cwd relative-project-name`';
  }
}