export interface ActionableError {
  message: string;
  userAction?: string;
  category: 'user_action_required' | 'configuration' | 'external_service' | 'internal' | 'permission';
  severity: 'low' | 'medium' | 'high' | 'critical';
  details?: string;
}

export class ErrorAnalyzer {
  static analyzeError(error: any): ActionableError {
    const errorMessage = error.message || error.toString() || 'Unknown error';
    const errorStack = error.stack || '';
    
    // GitHub-related errors
    if (errorMessage.includes('repository has disabled issues')) {
      return {
        message: 'GitHub repository has issues disabled',
        userAction: 'Enable issues in GitHub repository settings, or use a different repository',
        category: 'user_action_required',
        severity: 'medium',
        details: 'Go to your GitHub repository → Settings → Features → Issues and enable the Issues feature'
      };
    }

    if (errorMessage.includes('not found') && errorMessage.includes('repository')) {
      return {
        message: 'GitHub repository not found or access denied',
        userAction: 'Check repository name and ensure you have access permissions',
        category: 'user_action_required',
        severity: 'medium',
        details: 'Verify the repository exists and your GitHub token has appropriate permissions'
      };
    }

    // Authentication errors
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized') || errorMessage.includes('token')) {
      return {
        message: 'Authentication failed',
        userAction: 'Check and update your API tokens or credentials',
        category: 'configuration',
        severity: 'high',
        details: 'Verify your GitHub token, Slack tokens, or other API credentials are valid and not expired'
      };
    }

    // Network/connectivity errors
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('timeout')) {
      return {
        message: 'Network connectivity issue',
        userAction: 'Check your internet connection and try again',
        category: 'external_service',
        severity: 'medium',
        details: 'This may be a temporary network issue or service outage'
      };
    }

    // File system errors
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file')) {
      return {
        message: 'File or directory not found',
        userAction: 'Check file paths and ensure files exist',
        category: 'user_action_required',
        severity: 'medium',
        details: 'Verify the file path is correct and the file exists in the working directory'
      };
    }

    if (errorMessage.includes('EACCES') || errorMessage.includes('permission denied')) {
      return {
        message: 'Permission denied accessing file or directory',
        userAction: 'Check file permissions or run with appropriate privileges',
        category: 'permission',
        severity: 'medium',
        details: 'The bot may not have read/write permissions for the requested file or directory'
      };
    }

    // Git-related errors
    if (errorMessage.includes('not a git repository')) {
      return {
        message: 'Not in a Git repository',
        userAction: 'Initialize a Git repository or navigate to an existing one',
        category: 'user_action_required',
        severity: 'medium',
        details: 'Run `git init` to initialize a new repository or check your working directory'
      };
    }

    if (errorMessage.includes('nothing to commit')) {
      return {
        message: 'No changes to commit',
        userAction: 'Make some changes before attempting to commit',
        category: 'user_action_required',
        severity: 'low',
        details: 'Git has no staged changes or all changes are already committed'
      };
    }

    if (errorMessage.includes('remote repository') && errorMessage.includes('push')) {
      return {
        message: 'Git push failed',
        userAction: 'Check your Git remote configuration and authentication',
        category: 'user_action_required',
        severity: 'medium',
        details: 'Verify the remote repository URL and ensure you have push permissions'
      };
    }

    // Claude Code SDK errors
    if (errorMessage.includes('Claude Code process exited')) {
      return {
        message: 'Claude Code SDK failed',
        userAction: 'Check working directory and Claude Code installation',
        category: 'configuration',
        severity: 'high',
        details: 'This may indicate a configuration issue or problem with the Claude Code SDK'
      };
    }

    // Package/dependency errors
    if (errorMessage.includes('Cannot find module') || errorMessage.includes('MODULE_NOT_FOUND')) {
      return {
        message: 'Missing dependency or module',
        userAction: 'Install missing dependencies with `npm install`',
        category: 'configuration',
        severity: 'medium',
        details: 'A required package or module is not installed'
      };
    }

    // Slack API errors
    if (errorMessage.includes('slack') && (errorMessage.includes('invalid') || errorMessage.includes('expired'))) {
      return {
        message: 'Slack API error',
        userAction: 'Check Slack app configuration and tokens',
        category: 'configuration',
        severity: 'high',
        details: 'Verify Slack bot token, app token, and app permissions are correctly configured'
      };
    }

    // Rate limiting
    if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
      return {
        message: 'API rate limit exceeded',
        userAction: 'Wait a moment and try again',
        category: 'external_service',
        severity: 'low',
        details: 'The service is temporarily limiting requests - this will resolve automatically'
      };
    }

    // Configuration errors
    if (errorMessage.includes('configuration') || errorMessage.includes('config')) {
      return {
        message: 'Configuration error',
        userAction: 'Check your configuration settings',
        category: 'configuration',
        severity: 'medium',
        details: 'Review your .env file and application configuration'
      };
    }

    // Working directory errors
    if (errorMessage.includes('working directory') || errorMessage.includes('BASE_DIRECTORY')) {
      return {
        message: 'Working directory issue',
        userAction: 'Set a valid working directory using `cwd /path/to/directory`',
        category: 'user_action_required',
        severity: 'medium',
        details: 'The current working directory is not accessible or not set'
      };
    }

    // Generic error - no specific action identified
    return {
      message: errorMessage,
      category: 'internal',
      severity: 'medium',
      details: 'This appears to be an internal error that may require developer attention'
    };
  }

  static formatErrorMessage(actionableError: ActionableError): string {
    let message = `🚨 **${this.getSeverityEmoji(actionableError.severity)} ${actionableError.message}**\n\n`;
    
    if (actionableError.userAction) {
      message += `**Action needed:** ${actionableError.userAction}\n\n`;
    }
    
    if (actionableError.details) {
      message += `**Details:** ${actionableError.details}\n\n`;
    }
    
    message += `**Category:** ${this.getCategoryDescription(actionableError.category)}`;
    
    return message;
  }

  private static getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🔵';
      default: return '⚪';
    }
  }

  private static getCategoryDescription(category: string): string {
    switch (category) {
      case 'user_action_required': return 'Action Required';
      case 'configuration': return 'Configuration Issue';
      case 'external_service': return 'External Service';
      case 'permission': return 'Permission Issue';
      case 'internal': return 'Internal Error';
      default: return 'Unknown';
    }
  }
}