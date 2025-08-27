#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebClient } from '@slack/web-api';
import { Logger } from './logger.js';
import { PermissionFormatter, ApprovalScope } from './permission-formatter.js';
import { config } from './config.js';
import { localConfigReader } from './local-config-reader.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const logger = new Logger('PermissionMCP');

interface PermissionRequest {
  tool_name: string;
  input: any;
  channel?: string;
  thread_ts?: string;
  user?: string;
}

interface PermissionResponse {
  behavior: 'allow' | 'deny';
  updatedInput?: any;
  message?: string;
}

interface StoredApproval {
  tool_name: string;
  user: string;
  channel: string;
  behavior: 'allow' | 'deny';
  timestamp: number;
  input_hash: string; // Hash of the input parameters for comparison
  scope: ApprovalScope;
  risk_level: 'low' | 'medium' | 'high';
}

class PermissionMCPServer {
  private server: Server;
  private slack: WebClient;
  private pendingApprovals = new Map<string, {
    resolve: (response: PermissionResponse) => void;
    reject: (error: Error) => void;
  }>();
  private persistentApprovals = new Map<string, StoredApproval>(); // Store approvals across requests
  private pendingContext = new Map<string, {
    tool_name: string;
    user: string;
    channel: string;
    input: any;
    formattedPermission?: any;
  }>(); // Store context for pending approvals

  constructor() {
    this.server = new Server(
      {
        name: "permission-prompt",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.setupHandlers();
    this.loadPersistedApprovals();
  }

  private createInputHash(input: any): string {
    // Create a deterministic hash of the input parameters
    const inputString = JSON.stringify(input, Object.keys(input).sort());
    return crypto.createHash('sha256').update(inputString).digest('hex').substring(0, 16);
  }

  private getApprovalKey(tool_name: string, user: string, channel: string, input_hash: string): string {
    return `${tool_name}:${user}:${channel}:${input_hash}`;
  }

  private loadPersistedApprovals(): void {
    // Load approvals from temp file (they persist for the session)
    const approvalFile = path.join(os.tmpdir(), 'claude_slack_bot_approvals.json');
    try {
      if (fs.existsSync(approvalFile)) {
        const data = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
        this.persistentApprovals = new Map(Object.entries(data));
        logger.debug('Loaded persistent approvals', { count: this.persistentApprovals.size });
      }
    } catch (error) {
      logger.debug('Failed to load persistent approvals', { error });
    }
  }

  private savePersistedApprovals(): void {
    // Save approvals to temp file
    const approvalFile = path.join(os.tmpdir(), 'claude_slack_bot_approvals.json');
    try {
      const data = Object.fromEntries(this.persistentApprovals);
      fs.writeFileSync(approvalFile, JSON.stringify(data));
      logger.debug('Saved persistent approvals', { count: this.persistentApprovals.size });
    } catch (error) {
      logger.error('Failed to save persistent approvals', { error });
    }
  }

  private checkExistingApproval(tool_name: string, user: string, channel: string, input: any, scope: ApprovalScope): StoredApproval | null {
    // For broader scopes, check if we have any matching approvals at the same or broader level
    const possibleScopes = this.getScopeHierarchy(scope);
    
    for (const checkScope of possibleScopes) {
      const scopeKey = this.getScopeKey(tool_name, checkScope, input);
      const approvalKey = this.getApprovalKey(tool_name, user, channel, scopeKey);
      
      const existing = this.persistentApprovals.get(approvalKey);
      if (existing) {
        // Check if approval is still valid based on scope-specific duration
        const maxAge = PermissionFormatter.getPersistenceDuration(existing.scope, existing.risk_level);
        if (Date.now() - existing.timestamp > maxAge) {
          this.persistentApprovals.delete(approvalKey);
          this.savePersistedApprovals();
          continue;
        }
        return existing;
      }
    }

    return null;
  }

  private getScopeHierarchy(requestedScope: ApprovalScope): ApprovalScope[] {
    // Return scopes in order of preference (broader scopes first)
    switch (requestedScope) {
      case 'command':
        return ['tool', 'action', 'command'];
      case 'action':
        return ['tool', 'action'];
      case 'tool':
        return ['tool'];
      default:
        return ['action'];
    }
  }

  private getScopeKey(tool_name: string, scope: ApprovalScope, input: any): string {
    switch (scope) {
      case 'tool':
        // Tool-level: just the base tool name
        const baseTool = tool_name.startsWith('mcp__') ? tool_name.split('__')[1] : tool_name;
        return `tool:${baseTool}`;
      case 'action':
        // Action-level: tool + action type (e.g., github:create_issue)
        const actionType = this.extractActionType(tool_name, input);
        return `action:${actionType}`;
      case 'command':
        // Command-level: full input hash
        return `command:${this.createInputHash(input)}`;
      default:
        return `action:${tool_name}`;
    }
  }

  private extractActionType(tool_name: string, input: any): string {
    if (tool_name.includes('github')) {
      const command = input?.command || '';
      if (command.includes('issue create')) return 'github:create_issue';
      if (command.includes('pr create')) return 'github:create_pr';
      if (command.includes('issue')) return 'github:manage_issues';
      if (command.includes('repo')) return 'github:manage_repo';
      return 'github:general';
    }
    
    if (tool_name.includes('filesystem')) {
      if (tool_name.includes('read')) return 'filesystem:read';
      if (tool_name.includes('write')) return 'filesystem:write';
      if (tool_name.includes('delete')) return 'filesystem:delete';
      return 'filesystem:general';
    }
    
    return tool_name;
  }

  private getRiskEmoji(riskLevel: string): string {
    switch (riskLevel) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }

  private getScopeEmoji(scope: ApprovalScope): string {
    switch (scope) {
      case 'tool': return '🔧';
      case 'action': return '⚙️';
      case 'command': return '📝';
      default: return '❓';
    }
  }

  private getScopeButtons(currentScope: ApprovalScope, approvalId: string): any[] {
    const scopeButtons = [];
    
    // Add tool-level button if allowed and not current scope
    if (config.permissions.allowToolLevel && currentScope !== 'tool') {
      scopeButtons.push({
        type: "button",
        text: {
          type: "plain_text",
          text: "🔧 Approve Tool"
        },
        action_id: "approve_tool_scope",
        value: `${approvalId}:tool`
      });
    }
    
    // Add command-level button if allowed and not current scope
    if (config.permissions.allowCommandLevel && currentScope !== 'command') {
      scopeButtons.push({
        type: "button",
        text: {
          type: "plain_text",
          text: "📝 Approve Command"
        },
        action_id: "approve_command_scope",
        value: `${approvalId}:command`
      });
    }
    
    return scopeButtons;
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "permission_prompt",
            description: "Request user permission for tool execution via Slack button",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: {
                  type: "string",
                  description: "Name of the tool requesting permission",
                },
                input: {
                  type: "object",
                  description: "Input parameters for the tool",
                },
                channel: {
                  type: "string",
                  description: "Slack channel ID",
                },
                thread_ts: {
                  type: "string",
                  description: "Slack thread timestamp",
                },
                user: {
                  type: "string",
                  description: "User ID requesting permission",
                },
              },
              required: ["tool_name", "input"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "permission_prompt") {
        // Validate the request parameters match PermissionRequest interface
        const args = request.params.arguments;
        if (!args || typeof args !== 'object' || !('tool_name' in args) || !('input' in args)) {
          throw new Error('Invalid permission request: missing required fields tool_name or input');
        }
        return await this.handlePermissionPrompt(args as unknown as PermissionRequest);
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  private async handlePermissionPrompt(params: PermissionRequest) {
    const { tool_name, input } = params;
    
    logger.info('Permission prompt called!', { tool_name, input });
    
    // Get Slack context from environment (passed by Claude handler)
    const slackContextStr = process.env.SLACK_CONTEXT;
    const slackContext = slackContextStr ? JSON.parse(slackContextStr) : {};
    const { channel, threadTs: thread_ts, user, workingDirectory, requestId } = slackContext;
    
    logger.info('Slack context for permission', { channel, thread_ts, user, workingDirectory, requestId });
    
    // Format the permission request
    const formattedPermission = PermissionFormatter.formatPermission(tool_name, input, config.permissions.defaultScope);
    
    // Auto-approve low-risk operations if configured
    if (config.permissions.autoApproveLowRisk && formattedPermission.riskLevel === 'low') {
      logger.info('Auto-approving low-risk operation', { tool_name, user, riskLevel: formattedPermission.riskLevel });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              behavior: 'allow',
              message: 'Auto-approved (low risk operation)'
            })
          }
        ]
      };
    }
    
    // Check local config for pre-approval first
    if (workingDirectory) {
      try {
        const commandStr = typeof input === 'string' ? input : JSON.stringify(input);
        const localConfigResult = await localConfigReader.isPreApproved(commandStr, tool_name, workingDirectory);
        
        if (localConfigResult.isApproved) {
          logger.info('Auto-approved by local config', { 
            tool_name, 
            user, 
            workingDirectory,
            matchType: localConfigResult.matchType,
            configPath: localConfigResult.configPath,
            requestId
          });
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  behavior: 'allow',
                  message: `Auto-approved by local config (${localConfigResult.matchType} match)`
                })
              }
            ]
          };
        } else if (localConfigResult.source === 'local-config' && !localConfigResult.isApproved) {
          // Explicitly blocked by local config
          logger.warn('Explicitly blocked by local config', { 
            tool_name, 
            user, 
            workingDirectory,
            matchType: localConfigResult.matchType,
            configPath: localConfigResult.configPath,
            requestId
          });
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  behavior: 'deny',
                  message: `Blocked by local config (${localConfigResult.matchType} match)`
                })
              }
            ]
          };
        }
      } catch (error) {
        logger.error('Error checking local config, falling back to normal permission flow', { error, workingDirectory, tool_name, requestId });
        // Continue to existing approval check on error (fail-secure)
      }
    }
    
    // Check for existing approval
    const existingApproval = this.checkExistingApproval(tool_name, user, channel, input, formattedPermission.scope);
    if (existingApproval) {
      logger.debug('Using existing approval', { 
        tool_name, 
        user, 
        behavior: existingApproval.behavior,
        scope: existingApproval.scope,
        age: Date.now() - existingApproval.timestamp 
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              behavior: existingApproval.behavior,
              message: `Using previous approval (${existingApproval.behavior})`
            })
          }
        ]
      };
    }
    
    // Generate unique approval ID for new approval
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store context for this approval (including formatted permission for later storage)
    this.pendingContext.set(approvalId, {
      tool_name,
      user,
      channel,
      input,
      formattedPermission
    });
    
    // Create approval message with buttons
    const riskEmoji = this.getRiskEmoji(formattedPermission.riskLevel);
    const scopeEmoji = this.getScopeEmoji(formattedPermission.scope);
    
    let mainText = `🔐 *Permission Request*\n\n${formattedPermission.icon} **${formattedPermission.title}**\n${formattedPermission.description}\n\n${riskEmoji} Risk Level: ${formattedPermission.riskLevel}\n${scopeEmoji} Scope: ${formattedPermission.scope}`;
    
    // Add details if enabled and available
    if (config.permissions.showDetails && formattedPermission.details) {
      mainText += `\n\n*Details:*\n${formattedPermission.details}`;
    }
    
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: mainText
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✅ Approve"
            },
            style: "primary",
            action_id: "approve_tool",
            value: approvalId
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "❌ Deny"
            },
            style: "danger",
            action_id: "deny_tool",
            value: approvalId
          },
          // Add "Show Details" button if details are available but not shown
          ...((!config.permissions.showDetails && formattedPermission.details) ? [{
            type: "button",
            text: {
              type: "plain_text",
              text: "🔍 Show Details"
            },
            action_id: "show_details",
            value: approvalId
          }] : []),
          // Add scope selection buttons if multiple scopes are allowed
          ...(this.getScopeButtons(formattedPermission.scope, approvalId))
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Requested by: <@${user}> | Tool: ${tool_name}`
          }
        ]
      }
    ];

    try {
      // Send approval request to Slack
      const result = await this.slack.chat.postMessage({
        channel: channel || user || 'general',
        thread_ts: thread_ts,
        blocks,
        text: `Permission request for ${tool_name}` // Fallback text
      });

      // Wait for user response
      const response = await this.waitForApproval(approvalId);
      
      // Update the message to show the result
      if (result.ts) {
        await this.slack.chat.update({
          channel: result.channel!,
          ts: result.ts,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🔐 *Permission Request* - ${response.behavior === 'allow' ? '✅ Approved' : '❌ Denied'}\n\nTool: \`${tool_name}\`\n\n*Tool Parameters:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
              }
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `${response.behavior === 'allow' ? 'Approved' : 'Denied'} by user | Tool: ${tool_name}`
                }
              ]
            }
          ],
          text: `Permission ${response.behavior === 'allow' ? 'approved' : 'denied'} for ${tool_name}`
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response)
          }
        ]
      };
    } catch (error) {
      logger.error('Error handling permission prompt:', error);
      
      // Default to deny if there's an error
      const response: PermissionResponse = {
        behavior: 'deny',
        message: 'Error occurred while requesting permission'
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response)
          }
        ]
      };
    }
  }

  private async waitForApproval(approvalId: string): Promise<PermissionResponse> {
    const approvalFile = path.join(os.tmpdir(), `approval_${approvalId}.json`);
    
    return new Promise((resolve, reject) => {
      // Store the promise resolvers for backwards compatibility
      this.pendingApprovals.set(approvalId, { resolve, reject });
      
      // Poll for approval file
      const pollInterval = setInterval(() => {
        try {
          if (fs.existsSync(approvalFile)) {
            const approvalData = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
            
            // Clean up
            clearInterval(pollInterval);
            clearTimeout(timeoutHandle);
            this.pendingApprovals.delete(approvalId);
            this.pendingContext.delete(approvalId);
            
            try {
              fs.unlinkSync(approvalFile);
            } catch (error) {
              logger.debug('Failed to delete approval file', { approvalFile, error });
            }
            
            resolve(approvalData);
          }
        } catch (error) {
          logger.debug('Error polling approval file', { approvalFile, error });
        }
      }, 100); // Poll every 100ms
      
      // Set timeout (5 minutes)
      const timeoutHandle = setTimeout(() => {
        clearInterval(pollInterval);
        
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId);
          
          // Clean up context
          this.pendingContext.delete(approvalId);
          
          // Clean up approval file if it exists
          try {
            if (fs.existsSync(approvalFile)) {
              fs.unlinkSync(approvalFile);
            }
          } catch (error) {
            logger.debug('Failed to delete timeout approval file', { approvalFile, error });
          }
          
          resolve({
            behavior: 'deny',
            message: 'Permission request timed out'
          });
        }
      }, 5 * 60 * 1000);
    });
  }

  // Method to be called by Slack handler when button is clicked
  public resolveApproval(approvalId: string, approved: boolean, updatedInput?: any) {
    const approvalFile = path.join(os.tmpdir(), `approval_${approvalId}.json`);
    const response: PermissionResponse = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: updatedInput || undefined,
      message: approved ? 'Approved by user' : 'Denied by user'
    };
    
    // Get stored context and save persistent approval
    const context = this.pendingContext.get(approvalId);
    if (context) {
      const { tool_name, user, channel, input, formattedPermission } = context;
      const scope = formattedPermission?.scope || config.permissions.defaultScope;
      const riskLevel = formattedPermission?.riskLevel || 'medium';
      
      const scopeKey = this.getScopeKey(tool_name, scope, input);
      const approvalKey = this.getApprovalKey(tool_name, user, channel, scopeKey);
      
      const storedApproval: StoredApproval = {
        tool_name,
        user,
        channel,
        behavior: approved ? 'allow' : 'deny',
        timestamp: Date.now(),
        input_hash: scopeKey,
        scope,
        risk_level: riskLevel
      };
      
      this.persistentApprovals.set(approvalKey, storedApproval);
      this.savePersistedApprovals();
      
      // Clean up context
      this.pendingContext.delete(approvalId);
      
      logger.info('Stored persistent approval', { 
        tool_name, 
        user, 
        behavior: storedApproval.behavior,
        scope,
        riskLevel,
        approvalKey 
      });
    }
    
    // Write approval to file for inter-process communication
    try {
      fs.writeFileSync(approvalFile, JSON.stringify(response));
      logger.debug('Wrote approval to file', { approvalId, approved, approvalFile });
    } catch (error) {
      logger.error('Failed to write approval file', { approvalId, approvalFile, error });
    }
    
    // Also resolve in-process for backwards compatibility
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      this.pendingApprovals.delete(approvalId);
      pending.resolve(response);
    }
  }

  // Utility method to clear stored approvals (for debugging/admin)
  public clearStoredApprovals(): void {
    this.persistentApprovals.clear();
    this.savePersistedApprovals();
    logger.info('Cleared all stored approvals');
  }

  // Utility method to list stored approvals (for debugging)
  public listStoredApprovals(): StoredApproval[] {
    return Array.from(this.persistentApprovals.values());
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Permission MCP server started');
  }
}

// Export singleton instance for use by Slack handler
export const permissionServer = new PermissionMCPServer();

// Run if this file is executed directly
if (require.main === module) {
  permissionServer.run().catch((error) => {
    logger.error('Permission MCP server error:', error);
    process.exit(1);
  });
}