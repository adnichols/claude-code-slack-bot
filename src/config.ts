import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { ApprovalScope } from './permission-formatter.js';

dotenv.config();

export const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  claude: {
    useBedrock: process.env.CLAUDE_CODE_USE_BEDROCK === '1',
    useVertex: process.env.CLAUDE_CODE_USE_VERTEX === '1',
    cliPath: process.env.CLAUDE_CLI_EXECUTABLE_PATH || '',
  },
  baseDirectory: process.env.BASE_DIRECTORY || '',
  debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',
  permissions: {
    // Default approval scope: 'tool' | 'action' | 'command'
    defaultScope: (process.env.PERMISSION_DEFAULT_SCOPE as ApprovalScope) || 'action',
    // Whether to show detailed parameters in approval requests
    showDetails: process.env.PERMISSION_SHOW_DETAILS !== 'false',
    // Whether to allow tool-level approvals (broader scope)
    allowToolLevel: process.env.PERMISSION_ALLOW_TOOL_LEVEL !== 'false',
    // Whether to allow command-level approvals (narrower scope)
    allowCommandLevel: process.env.PERMISSION_ALLOW_COMMAND_LEVEL !== 'false',
    // Auto-approve low-risk operations
    autoApproveLowRisk: process.env.PERMISSION_AUTO_APPROVE_LOW_RISK === 'true',
  },
};

/**
 * Get runtime Slack context from environment (used by MCP server)
 */
export function getSlackContext() {
  const slackContextStr = process.env.SLACK_CONTEXT;
  return slackContextStr ? JSON.parse(slackContextStr) : {};
}

function validateCliPath(path: string): void {
  if (path && !existsSync(path)) {
    console.warn(`⚠️ Claude CLI path not found: ${path}`);
    console.warn('Falling back to bundled CLI. To use local CLI:');
    console.warn('1. Install Claude CLI: https://claude.ai/cli');
    console.warn('2. Run: claude login');
    console.warn('3. Set CLAUDE_CLI_EXECUTABLE_PATH to the CLI location');
  }
}

export function validateConfig() {
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'SLACK_SIGNING_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Validate CLI path on startup if configured
if (config.claude.cliPath) {
  validateCliPath(config.claude.cliPath);
}