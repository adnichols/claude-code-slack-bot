import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { ConversationSession } from './types.js';
import { Logger } from './logger.js';
import { McpManager, McpServerConfig } from './mcp-manager.js';
import { ErrorAnalyzer } from './error-analyzer.js';
import { config } from './config.js';
import * as path from 'path';

export class ClaudeHandler {
  private sessions: Map<string, ConversationSession> = new Map();
  private logger = new Logger('ClaudeHandler');
  private mcpManager: McpManager;

  constructor(mcpManager: McpManager) {
    this.mcpManager = mcpManager;
  }

  getSessionKey(userId: string, channelId: string, threadTs?: string): string {
    return `${userId}-${channelId}-${threadTs || 'direct'}`;
  }

  getSession(userId: string, channelId: string, threadTs?: string): ConversationSession | undefined {
    return this.sessions.get(this.getSessionKey(userId, channelId, threadTs));
  }

  createSession(userId: string, channelId: string, threadTs?: string): ConversationSession {
    const session: ConversationSession = {
      userId,
      channelId,
      threadTs,
      isActive: true,
      lastActivity: new Date(),
    };
    this.sessions.set(this.getSessionKey(userId, channelId, threadTs), session);
    return session;
  }

  async *streamQuery(
    prompt: string,
    session?: ConversationSession,
    abortController?: AbortController,
    workingDirectory?: string,
    slackContext?: { channel: string; threadTs?: string; user: string }
  ): AsyncGenerator<SDKMessage, void, unknown> {
    const options: any = {
      outputFormat: 'stream-json',
      permissionMode: slackContext ? 'default' : 'bypassPermissions',
    };

    // Add permission prompt tool if we have Slack context
    if (slackContext) {
      options.permissionPromptToolName = 'mcp__permission-prompt__permission_prompt';
      this.logger.debug('Added permission prompt tool for Slack integration', slackContext);
    }

    if (workingDirectory) {
      options.cwd = workingDirectory;
    }

    // Add MCP server configuration if available
    const mcpServers = this.mcpManager.getServerConfiguration();
    
    // Add permission prompt server if we have Slack context
    if (slackContext) {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      const permissionServer = {
        'permission-prompt': {
          command: 'npx',
          args: ['tsx', path.join(process.cwd(), 'src', 'permission-mcp-server.ts')],
          env: {
            SLACK_BOT_TOKEN: config.slack.botToken,
            SLACK_CONTEXT: JSON.stringify({
              ...slackContext,
              workingDirectory,
              requestId
            })
          }
        }
      };
      
      this.logger.debug('Generated request ID for permission context', { requestId, workingDirectory });
      
      if (mcpServers) {
        options.mcpServers = { ...mcpServers, ...permissionServer };
      } else {
        options.mcpServers = permissionServer;
      }
    } else if (mcpServers && Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }
    
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      // Allow all MCP tools by default, plus built-in tools and permission prompt tool
      const defaultMcpTools = this.mcpManager.getDefaultAllowedTools();
      const builtInTools = ['Bash', 'Edit', 'Read', 'Write', 'Glob', 'Grep']; // Claude Code built-in tools
      
      const allAllowedTools = [...builtInTools, ...defaultMcpTools];
      
      if (slackContext) {
        allAllowedTools.push('mcp__permission-prompt');
      }
      
      if (allAllowedTools.length > 0) {
        options.allowedTools = allAllowedTools;
      }
      
      this.logger.debug('Added MCP configuration to options', {
        serverCount: Object.keys(options.mcpServers).length,
        servers: Object.keys(options.mcpServers),
        allowedTools: allAllowedTools,
        hasSlackContext: !!slackContext,
      });
    }

    if (session?.sessionId) {
      options.resume = session.sessionId;
      this.logger.debug('Resuming session', { sessionId: session.sessionId });
    } else {
      this.logger.debug('Starting new Claude conversation');
    }

    this.logger.debug('Claude query options', {
      permissionMode: options.permissionMode,
      permissionPromptToolName: options.permissionPromptToolName,
      mcpServers: options.mcpServers ? Object.keys(options.mcpServers) : [],
      allowedTools: options.allowedTools,
      hasSlackContext: !!slackContext
    });
    this.logger.info('About to call Claude SDK with:', {
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      workingDirectory,
      mcpServersCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
      mcpServerNames: options.mcpServers ? Object.keys(options.mcpServers) : [],
      allowedTools: options.allowedTools || [],
      slackContext: !!slackContext
    });

    try {
      let messageCount = 0;
      let pendingToolUses: Map<string, { toolName: string, timestamp: number }> = new Map();
      
      for await (const message of query({
        prompt,
        abortController: abortController || new AbortController(),
        options,
      })) {
        messageCount++;
        
        // Comprehensive message structure logging
        this.logger.debug(`SDK Message #${messageCount}`, {
          messageIndex: messageCount,
          type: message.type,
          subtype: (message as any).subtype,
          fullMessage: JSON.stringify(message, null, 2),
          messageKeys: Object.keys(message),
          timestamp: new Date().toISOString()
        });

        if (message.type === 'system' && message.subtype === 'init') {
          if (session) {
            session.sessionId = message.session_id;
            this.logger.info('Session initialized', { 
              sessionId: message.session_id,
              model: (message as any).model,
              tools: (message as any).tools?.length || 0,
              messageIndex: messageCount,
            });
          }
        }

        // Track tool use patterns for understanding tool result delivery
        if (message.type === 'assistant' && (message as any).message?.content) {
          const content = (message as any).message.content;
          
          // Log detailed assistant message structure
          this.logger.debug('Assistant message analysis', {
            messageIndex: messageCount,
            contentLength: content.length,
            contentTypes: content.map((part: any) => part.type),
            hasToolUse: content.some((part: any) => part.type === 'tool_use'),
            hasText: content.some((part: any) => part.type === 'text'),
            textParts: content.filter((part: any) => part.type === 'text').map((part: any) => ({
              text: part.text?.substring(0, 200) + (part.text?.length > 200 ? '...' : ''),
              length: part.text?.length || 0
            })),
            toolUseParts: content.filter((part: any) => part.type === 'tool_use').map((part: any) => ({
              name: part.name,
              id: part.id,
              hasInput: !!part.input
            }))
          });

          // Track tool uses to understand result patterns
          const toolUses = content.filter((part: any) => part.type === 'tool_use');
          for (const toolUse of toolUses) {
            if (toolUse.id && toolUse.name) {
              pendingToolUses.set(toolUse.id, {
                toolName: toolUse.name,
                timestamp: Date.now()
              });
              this.logger.info('Tool use tracked', {
                messageIndex: messageCount,
                toolId: toolUse.id,
                toolName: toolUse.name,
                pendingCount: pendingToolUses.size
              });
            }
          }

          // Check if this message contains text that might be tool results
          const textParts = content.filter((part: any) => part.type === 'text');
          if (textParts.length > 0 && pendingToolUses.size > 0) {
            this.logger.info('Potential tool result delivery', {
              messageIndex: messageCount,
              textPartCount: textParts.length,
              pendingToolsCount: pendingToolUses.size,
              pendingToolNames: Array.from(pendingToolUses.values()).map(t => t.toolName),
              textSamples: textParts.map((part: any, idx: number) => ({
                index: idx,
                preview: part.text?.substring(0, 150) + (part.text?.length > 150 ? '...' : ''),
                length: part.text?.length || 0
              }))
            });
          }
        }

        // Check for any unexpected message types that might indicate tool results
        if (!['assistant', 'user', 'result', 'system'].includes(message.type)) {
          this.logger.info('UNEXPECTED: Found unknown message type', {
            messageIndex: messageCount,
            type: message.type,
            fullMessage: JSON.stringify(message, null, 2)
          });
        }

        // Log result messages comprehensively
        if (message.type === 'result') {
          this.logger.info('Result message analysis', {
            messageIndex: messageCount,
            subtype: message.subtype,
            hasResult: message.subtype === 'success' && !!(message as any).result,
            resultPreview: (message as any).result?.substring(0, 200) + ((message as any).result?.length > 200 ? '...' : ''),
            totalCost: (message as any).total_cost_usd,
            duration: (message as any).duration_ms,
            allKeys: Object.keys(message)
          });
          
          // Clear pending tool tracking on completion
          if (pendingToolUses.size > 0) {
            this.logger.info('Clearing pending tool uses on result', {
              messageIndex: messageCount,
              clearedCount: pendingToolUses.size,
              toolNames: Array.from(pendingToolUses.values()).map(t => t.toolName)
            });
            pendingToolUses.clear();
          }
        }

        yield message;
      }
    } catch (error) {
      this.logger.error('Error in Claude query', error);
      
      // Analyze the error to provide better context
      const actionableError = ErrorAnalyzer.analyzeError(error);
      
      // If it's a user action required error, add context to the error
      if (actionableError.category === 'user_action_required' || actionableError.category === 'configuration') {
        const enhancedError = new Error(actionableError.message);
        (enhancedError as any).userAction = actionableError.userAction;
        (enhancedError as any).category = actionableError.category;
        (enhancedError as any).severity = actionableError.severity;
        (enhancedError as any).details = actionableError.details;
        throw enhancedError;
      }
      
      throw error;
    }
  }

  cleanupInactiveSessions(maxAge: number = 30 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > maxAge) {
        this.sessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} inactive sessions`);
    }
  }
}