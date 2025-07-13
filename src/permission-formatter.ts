export type ApprovalScope = 'tool' | 'action' | 'command';

export interface FormattedPermission {
  title: string;
  description: string;
  scope: ApprovalScope;
  details?: string;
  riskLevel: 'low' | 'medium' | 'high';
  icon: string;
}

export class PermissionFormatter {
  /**
   * Formats a permission request based on tool name and parameters
   */
  static formatPermission(toolName: string, input: any, scope: ApprovalScope = 'action'): FormattedPermission {
    // Extract the base tool name from MCP tool names (e.g., mcp__github__create_issue -> github)
    const baseTool = this.extractBaseTool(toolName);
    
    switch (baseTool) {
      case 'github':
        return this.formatGitHubPermission(toolName, input, scope);
      case 'filesystem':
        return this.formatFilesystemPermission(toolName, input, scope);
      case 'web-search':
        return this.formatWebSearchPermission(toolName, input, scope);
      case 'Bash':
        return this.formatBashPermission(toolName, input, scope);
      default:
        return this.formatGenericPermission(toolName, input, scope);
    }
  }

  private static extractBaseTool(toolName: string): string {
    // Handle MCP tool names like mcp__github__create_issue
    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__');
      return parts[1] || 'unknown';
    }
    return toolName.toLowerCase();
  }

  private static formatGitHubPermission(toolName: string, input: any, scope: ApprovalScope): FormattedPermission {
    const command = input?.command || '';
    
    if (scope === 'tool') {
      return {
        title: 'GitHub CLI Access',
        description: 'Allow Claude to use GitHub CLI for repository operations',
        scope: 'tool',
        riskLevel: 'medium',
        icon: '🐙',
        details: 'This grants access to all GitHub CLI operations including creating issues, PRs, and repository management.'
      };
    }

    if (scope === 'action') {
      if (command.includes('issue create')) {
        return {
          title: 'Create GitHub Issue',
          description: 'Allow Claude to create issues in GitHub repositories',
          scope: 'action',
          riskLevel: 'low',
          icon: '📝',
          details: 'This will create a new issue with the specified title and description.'
        };
      } else if (command.includes('pr create')) {
        return {
          title: 'Create Pull Request',
          description: 'Allow Claude to create pull requests in GitHub repositories',
          scope: 'action',
          riskLevel: 'medium',
          icon: '🔀',
          details: 'This will create a new pull request with changes from the current branch.'
        };
      } else if (command.includes('repo')) {
        return {
          title: 'Repository Management',
          description: 'Allow Claude to manage GitHub repository settings',
          scope: 'action',
          riskLevel: 'high',
          icon: '⚙️',
          details: 'This may modify repository settings, collaborators, or other configuration.'
        };
      } else if (command.includes('issue')) {
        return {
          title: 'GitHub Issues',
          description: 'Allow Claude to manage GitHub issues',
          scope: 'action',
          riskLevel: 'low',
          icon: '🐛',
          details: 'This includes viewing, creating, updating, or closing issues.'
        };
      }
    }

    // Fallback to command-level detail
    return {
      title: 'GitHub CLI Command',
      description: this.truncateCommand(command),
      scope: 'command',
      riskLevel: 'medium',
      icon: '🐙',
      details: `Full command: ${command}`
    };
  }

  private static formatFilesystemPermission(toolName: string, input: any, scope: ApprovalScope): FormattedPermission {
    if (scope === 'tool') {
      return {
        title: 'File System Access',
        description: 'Allow Claude to read and write files in the working directory',
        scope: 'tool',
        riskLevel: 'high',
        icon: '📁',
        details: 'This grants broad file system access for reading, writing, and managing files.'
      };
    }

    if (scope === 'action') {
      const path = input?.path || '';
      if (toolName.includes('read') || input?.operation === 'read') {
        return {
          title: 'Read Files',
          description: `Allow Claude to read files${path ? ` in ${this.shortenPath(path)}` : ''}`,
          scope: 'action',
          riskLevel: 'low',
          icon: '👁️',
          details: `Reading files${path ? ` from: ${path}` : ''}`
        };
      } else if (toolName.includes('write') || input?.operation === 'write') {
        return {
          title: 'Write Files',
          description: `Allow Claude to create/modify files${path ? ` in ${this.shortenPath(path)}` : ''}`,
          scope: 'action',
          riskLevel: 'medium',
          icon: '✏️',
          details: `Writing files${path ? ` to: ${path}` : ''}`
        };
      } else if (toolName.includes('delete') || input?.operation === 'delete') {
        return {
          title: 'Delete Files',
          description: `Allow Claude to delete files${path ? ` in ${this.shortenPath(path)}` : ''}`,
          scope: 'action',
          riskLevel: 'high',
          icon: '🗑️',
          details: `Deleting files${path ? ` from: ${path}` : ''}`
        };
      }
    }

    return {
      title: 'File Operation',
      description: `File system operation: ${toolName}`,
      scope: 'command',
      riskLevel: 'medium',
      icon: '📁',
      details: JSON.stringify(input, null, 2)
    };
  }

  private static formatWebSearchPermission(toolName: string, input: any, scope: ApprovalScope): FormattedPermission {
    if (scope === 'tool') {
      return {
        title: 'Web Search Access',
        description: 'Allow Claude to search the web for information',
        scope: 'tool',
        riskLevel: 'low',
        icon: '🔍',
        details: 'This enables Claude to search for current information online.'
      };
    }

    const query = input?.query || input?.q || '';
    return {
      title: 'Web Search',
      description: query ? `Search for: "${this.truncateText(query, 50)}"` : 'Perform web search',
      scope: scope === 'action' ? 'action' : 'command',
      riskLevel: 'low',
      icon: '🔍',
      details: query ? `Search query: ${query}` : 'Web search operation'
    };
  }

  private static formatBashPermission(toolName: string, input: any, scope: ApprovalScope): FormattedPermission {
    const command = input?.command || '';
    
    if (scope === 'tool') {
      return {
        title: 'Command Line Access',
        description: 'Allow Claude to execute command line operations',
        scope: 'tool',
        riskLevel: 'high',
        icon: '💻',
        details: 'This grants broad access to execute terminal commands.'
      };
    }

    // Analyze command for risk level
    const riskLevel = this.assessBashRiskLevel(command);
    
    return {
      title: 'Execute Command',
      description: `Run: ${this.truncateCommand(command)}`,
      scope: 'command',
      riskLevel,
      icon: '💻',
      details: `Full command: ${command}`
    };
  }

  private static formatGenericPermission(toolName: string, input: any, scope: ApprovalScope): FormattedPermission {
    return {
      title: `${toolName} Tool`,
      description: `Allow Claude to use the ${toolName} tool`,
      scope,
      riskLevel: 'medium',
      icon: '🔧',
      details: JSON.stringify(input, null, 2)
    };
  }

  private static assessBashRiskLevel(command: string): 'low' | 'medium' | 'high' {
    const cmd = command.toLowerCase();
    
    // High risk commands
    if (cmd.includes('rm ') || cmd.includes('delete') || cmd.includes('sudo') || 
        cmd.includes('chmod') || cmd.includes('chown') || cmd.includes('curl') ||
        cmd.includes('wget') || cmd.includes('git push')) {
      return 'high';
    }
    
    // Medium risk commands
    if (cmd.includes('npm install') || cmd.includes('git') || cmd.includes('mv ') ||
        cmd.includes('cp ') || cmd.includes('mkdir') || cmd.includes('touch')) {
      return 'medium';
    }
    
    // Low risk commands (read-only operations)
    return 'low';
  }

  private static truncateCommand(command: string, maxLength: number = 60): string {
    if (command.length <= maxLength) return command;
    return command.substring(0, maxLength) + '...';
  }

  private static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  private static shortenPath(path: string): string {
    if (path.length <= 30) return path;
    const parts = path.split('/');
    if (parts.length > 3) {
      return `.../${parts.slice(-2).join('/')}`;
    }
    return path;
  }

  /**
   * Get default persistence duration based on scope and risk level
   */
  static getPersistenceDuration(scope: ApprovalScope, riskLevel: 'low' | 'medium' | 'high'): number {
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    if (scope === 'tool') {
      return riskLevel === 'high' ? 3 * day : 7 * day; // 3-7 days for tool-level
    } else if (scope === 'action') {
      return riskLevel === 'high' ? 12 * hour : 2 * day; // 12 hours - 2 days for action-level
    } else {
      return riskLevel === 'high' ? 6 * hour : day; // 6-24 hours for command-level
    }
  }
}