import { App } from '@slack/bolt';
import { ClaudeHandler } from './claude-handler';
import { SDKMessage } from '@anthropic-ai/claude-code';
import { Logger } from './logger';
import { WorkingDirectoryManager } from './working-directory-manager';
import { FileHandler, ProcessedFile } from './file-handler';
import { TodoManager, Todo } from './todo-manager';
import { McpManager } from './mcp-manager';
import { permissionServer } from './permission-mcp-server';
import { config } from './config';
import { ErrorAnalyzer } from './error-analyzer';

interface MessageEvent {
  user: string;
  channel: string;
  thread_ts?: string;
  ts: string;
  text?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    filetype: string;
    url_private: string;
    url_private_download: string;
    size: number;
  }>;
}

export class SlackHandler {
  private app: App;
  private claudeHandler: ClaudeHandler;
  private activeControllers: Map<string, AbortController> = new Map();
  private logger = new Logger('SlackHandler');
  private workingDirManager: WorkingDirectoryManager;
  private fileHandler: FileHandler;
  private todoManager: TodoManager;
  private mcpManager: McpManager;
  private todoMessages: Map<string, string> = new Map(); // sessionKey -> messageTs
  private originalMessages: Map<string, { channel: string; ts: string }> = new Map(); // sessionKey -> original message info
  private currentReactions: Map<string, string> = new Map(); // sessionKey -> current emoji
  private botUserId: string | null = null;

  constructor(app: App, claudeHandler: ClaudeHandler, mcpManager: McpManager) {
    this.app = app;
    this.claudeHandler = claudeHandler;
    this.mcpManager = mcpManager;
    this.workingDirManager = new WorkingDirectoryManager();
    this.fileHandler = new FileHandler();
    this.todoManager = new TodoManager();
  }

  async handleMessage(event: MessageEvent, say: any) {
    const { user, channel, thread_ts, ts, text, files } = event;
    
    // Process any attached files
    let processedFiles: ProcessedFile[] = [];
    if (files && files.length > 0) {
      this.logger.info('Processing uploaded files', { count: files.length });
      processedFiles = await this.fileHandler.downloadAndProcessFiles(files);
      
      if (processedFiles.length > 0) {
        await say({
          text: `📎 Processing ${processedFiles.length} file(s): ${processedFiles.map(f => f.name).join(', ')}`,
          thread_ts: thread_ts || ts,
        });
      }
    }

    // If no text and no files, nothing to process
    if (!text && processedFiles.length === 0) return;

    this.logger.debug('Received message from Slack', {
      user,
      channel,
      thread_ts,
      ts,
      text: text ? text.substring(0, 100) + (text.length > 100 ? '...' : '') : '[no text]',
      fileCount: processedFiles.length,
    });

    // Check if this is a working directory command (only if there's text)
    const setDirPath = text ? this.workingDirManager.parseSetCommand(text) : null;
    if (setDirPath) {
      const isDM = channel.startsWith('D');
      const result = this.workingDirManager.setWorkingDirectory(
        channel,
        setDirPath,
        thread_ts,
        isDM ? user : undefined
      );

      if (result.success) {
        const context = thread_ts ? 'this thread' : (isDM ? 'this conversation' : 'this channel');
        await say({
          text: `✅ Working directory set for ${context}: \`${result.resolvedPath}\``,
          thread_ts: thread_ts || ts,
        });
      } else {
        await say({
          text: `❌ ${result.error}`,
          thread_ts: thread_ts || ts,
        });
      }
      return;
    }

    // Check if this is a get directory command (only if there's text)
    if (text && this.workingDirManager.isGetCommand(text)) {
      const isDM = channel.startsWith('D');
      const directory = this.workingDirManager.getWorkingDirectory(
        channel,
        thread_ts,
        isDM ? user : undefined
      );
      const context = thread_ts ? 'this thread' : (isDM ? 'this conversation' : 'this channel');
      
      await say({
        text: this.workingDirManager.formatDirectoryMessage(directory, context),
        thread_ts: thread_ts || ts,
      });
      return;
    }

    // Check if this is an MCP info command (only if there's text)
    if (text && this.isMcpInfoCommand(text)) {
      await say({
        text: this.mcpManager.formatMcpInfo(),
        thread_ts: thread_ts || ts,
      });
      return;
    }

    // Check if this is an MCP reload command (only if there's text)
    if (text && this.isMcpReloadCommand(text)) {
      const reloaded = this.mcpManager.reloadConfiguration();
      if (reloaded) {
        await say({
          text: `✅ MCP configuration reloaded successfully.\n\n${this.mcpManager.formatMcpInfo()}`,
          thread_ts: thread_ts || ts,
        });
      } else {
        await say({
          text: `❌ Failed to reload MCP configuration. Check the mcp-servers.json file.`,
          thread_ts: thread_ts || ts,
        });
      }
      return;
    }

    // Check if we have a working directory set
    const isDM = channel.startsWith('D');
    const workingDirectory = this.workingDirManager.getWorkingDirectory(
      channel,
      thread_ts,
      isDM ? user : undefined
    );

    // Working directory is always required
    if (!workingDirectory) {
      let errorMessage = `⚠️ No working directory available. `;
      
      if (config.baseDirectory) {
        errorMessage += `BASE_DIRECTORY is configured but the path \`${config.baseDirectory}\` is not accessible. `;
        errorMessage += `Please check that the directory exists and is readable, or set a specific working directory using:\n`;
        errorMessage += `\`cwd project-name\` or \`cwd /absolute/path\``;
      } else {
        errorMessage += `No BASE_DIRECTORY is configured. Please set a working directory using:\n\`cwd /path/to/directory\``;
      }
      
      await say({
        text: errorMessage,
        thread_ts: thread_ts || ts,
      });
      return;
    }

    const sessionKey = this.claudeHandler.getSessionKey(user, channel, thread_ts || ts);
    
    // Store the original message info for status reactions
    const originalMessageTs = thread_ts || ts;
    this.originalMessages.set(sessionKey, { channel, ts: originalMessageTs });
    
    // Cancel any existing request for this conversation
    const existingController = this.activeControllers.get(sessionKey);
    if (existingController) {
      this.logger.debug('Cancelling existing request for session', { sessionKey });
      existingController.abort();
    }

    const abortController = new AbortController();
    this.activeControllers.set(sessionKey, abortController);

    let session = this.claudeHandler.getSession(user, channel, thread_ts || ts);
    if (!session) {
      this.logger.debug('Creating new session', { sessionKey });
      session = this.claudeHandler.createSession(user, channel, thread_ts || ts);
    } else {
      this.logger.debug('Using existing session', { sessionKey, sessionId: session.sessionId });
    }

    let currentMessages: string[] = [];
    let statusMessageTs: string | undefined;

    try {
      // Prepare the prompt with file attachments
      const finalPrompt = processedFiles.length > 0 
        ? await this.fileHandler.formatFilePrompt(processedFiles, text || '')
        : text || '';

      this.logger.info('Sending query to Claude Code SDK', { 
        prompt: finalPrompt.substring(0, 200) + (finalPrompt.length > 200 ? '...' : ''), 
        sessionId: session.sessionId,
        workingDirectory,
        fileCount: processedFiles.length,
      });

      // Send initial status message
      const statusResult = await say({
        text: '🤔 *Thinking...*',
        thread_ts: thread_ts || ts,
      });
      statusMessageTs = statusResult.ts;

      // Add thinking reaction to original message (but don't spam if already set)
      await this.updateMessageReaction(sessionKey, '🤔');
      
      // Create Slack context for permission prompts
      const slackContext = {
        channel,
        threadTs: thread_ts,
        user
      };
      
      let slackMessageCount = 0;
      
      for await (const message of this.claudeHandler.streamQuery(finalPrompt, session, abortController, workingDirectory, slackContext)) {
        if (abortController.signal.aborted) break;

        slackMessageCount++;

        // Comprehensive SDK message logging from Slack handler perspective
        this.logger.debug(`Slack Processing SDK Message #${slackMessageCount}`, {
          slackMessageIndex: slackMessageCount,
          type: message.type,
          subtype: (message as any).subtype,
          sessionKey,
          sessionId: session?.sessionId,
          messageStructure: {
            keys: Object.keys(message),
            hasMessage: !!(message as any).message,
            messageKeys: (message as any).message ? Object.keys((message as any).message) : [],
            hasContent: !!(message as any).message?.content,
            contentLength: (message as any).message?.content?.length || 0
          },
          fullMessageSample: JSON.stringify(message, null, 2).substring(0, 1000) + (JSON.stringify(message).length > 1000 ? '...' : '')
        });

        if (message.type === 'assistant') {
          const content = (message as any).message?.content || [];
          
          // Detailed analysis of assistant message content
          this.logger.info('Assistant message content analysis', {
            slackMessageIndex: slackMessageCount,
            sessionKey,
            contentParts: content.map((part: any, idx: number) => ({
              index: idx,
              type: part.type,
              name: part.name,
              id: part.id,
              textPreview: part.text?.substring(0, 100) + (part.text?.length > 100 ? '...' : ''),
              textLength: part.text?.length || 0,
              hasInput: !!part.input
            })),
            totalTextLength: content.filter((p: any) => p.type === 'text').reduce((sum: number, p: any) => sum + (p.text?.length || 0), 0),
            toolUseCount: content.filter((p: any) => p.type === 'tool_use').length,
            textPartCount: content.filter((p: any) => p.type === 'text').length
          });

          // Check if this is a tool use message
          const hasToolUse = message.message.content?.some((part: any) => part.type === 'tool_use');
          
          if (hasToolUse) {
            this.logger.info('Processing tool use message', {
              slackMessageIndex: slackMessageCount,
              sessionKey,
              toolNames: content.filter((p: any) => p.type === 'tool_use').map((p: any) => p.name),
              hasTextAlso: content.some((p: any) => p.type === 'text'),
              textWithToolUse: content.filter((p: any) => p.type === 'text').map((p: any) => p.text?.substring(0, 150))
            });

            // Update status to show working
            if (statusMessageTs) {
              await this.app.client.chat.update({
                channel,
                ts: statusMessageTs,
                text: '⚙️ *Working...*',
              });
            }

            // Update reaction to show working
            await this.updateMessageReaction(sessionKey, '⚙️');

            // Check for TodoWrite tool and handle it specially
            const todoTool = message.message.content?.find((part: any) => 
              part.type === 'tool_use' && part.name === 'TodoWrite'
            );

            if (todoTool) {
              this.logger.info('Processing TodoWrite tool', {
                slackMessageIndex: slackMessageCount,
                sessionKey,
                todoInput: todoTool.input
              });
              await this.handleTodoUpdate(todoTool.input, sessionKey, session?.sessionId, channel, thread_ts || ts, say);
            }

            // For other tool use messages, format them immediately as new messages
            const toolContent = this.formatToolUse(message.message.content);
            if (toolContent) { // Only send if there's content (TodoWrite returns empty string)
              this.logger.info('Sending tool use content to Slack', {
                slackMessageIndex: slackMessageCount,
                sessionKey,
                contentPreview: toolContent.substring(0, 200),
                contentLength: toolContent.length
              });
              await say({
                text: toolContent,
                thread_ts: thread_ts || ts,
              });
            } else {
              this.logger.debug('Tool use generated no visible content', {
                slackMessageIndex: slackMessageCount,
                sessionKey
              });
            }
          } else {
            // Handle regular text content
            const textContent = this.extractTextContent(message);
            this.logger.info('Processing text-only assistant message', {
              slackMessageIndex: slackMessageCount,
              sessionKey,
              hasTextContent: !!textContent,
              textLength: textContent?.length || 0,
              textPreview: textContent?.substring(0, 200) + (textContent && textContent.length > 200 ? '...' : ''),
              currentMessageCount: currentMessages.length
            });

            if (textContent) {
              currentMessages.push(textContent);
              
              // Send each new piece of content as a separate message
              const formatted = this.formatMessage(textContent, false);
              this.logger.debug('Sending formatted text to Slack', {
                slackMessageIndex: slackMessageCount,
                sessionKey,
                originalLength: textContent.length,
                formattedLength: formatted.length,
                formattedPreview: formatted.substring(0, 200)
              });
              
              await say({
                text: formatted,
                thread_ts: thread_ts || ts,
              });
            } else {
              this.logger.debug('No text content extracted from assistant message', {
                slackMessageIndex: slackMessageCount,
                sessionKey,
                messageContent: content
              });
            }
          }
        } else if (message.type === 'result') {
          const resultData = message as any;
          this.logger.info('Result message comprehensive analysis', {
            slackMessageIndex: slackMessageCount,
            sessionKey,
            subtype: message.subtype,
            hasResult: message.subtype === 'success' && !!resultData.result,
            resultLength: resultData.result?.length || 0,
            resultPreview: resultData.result?.substring(0, 300) + (resultData.result?.length > 300 ? '...' : ''),
            totalCost: resultData.total_cost_usd,
            duration: resultData.duration_ms,
            allResultKeys: Object.keys(resultData),
            currentMessageCount: currentMessages.length,
            finalResult: message.subtype === 'success'
          });
          
          if (message.subtype === 'success' && resultData.result) {
            const finalResult = resultData.result;
            const alreadyIncluded = currentMessages.includes(finalResult);
            
            this.logger.info('Processing final result', {
              slackMessageIndex: slackMessageCount,
              sessionKey,
              resultAlreadyIncluded: alreadyIncluded,
              resultComparisonPreviews: currentMessages.map(msg => msg.substring(0, 100)),
              finalResultPreview: finalResult.substring(0, 100)
            });

            if (finalResult && !alreadyIncluded) {
              const formatted = this.formatMessage(finalResult, true);
              this.logger.info('Sending final result to Slack', {
                slackMessageIndex: slackMessageCount,
                sessionKey,
                originalLength: finalResult.length,
                formattedLength: formatted.length
              });
              
              await say({
                text: formatted,
                thread_ts: thread_ts || ts,
              });
            } else if (alreadyIncluded) {
              this.logger.debug('Skipping final result - already sent', {
                slackMessageIndex: slackMessageCount,
                sessionKey
              });
            }
          }
        } else if (message.type === 'user') {
          // Handle user messages containing tool results (file content display)
          await this.handleUserMessage(message, sessionKey, slackMessageCount, channel, thread_ts || ts, say);
        } else {
          // Log any other message types we haven't seen
          this.logger.info('Unexpected message type received', {
            slackMessageIndex: slackMessageCount,
            sessionKey,
            messageType: message.type,
            messageSubtype: (message as any).subtype,
            messageKeys: Object.keys(message),
            fullMessage: JSON.stringify(message, null, 2)
          });
        }
      }

      // Update status to completed
      if (statusMessageTs) {
        await this.app.client.chat.update({
          channel,
          ts: statusMessageTs,
          text: '✅ *Task completed*',
        });
      }

      // Update reaction to show completion
      await this.updateMessageReaction(sessionKey, '✅');

      this.logger.info('Completed processing message', {
        sessionKey,
        messageCount: currentMessages.length,
      });

      // Clean up temporary files
      if (processedFiles.length > 0) {
        await this.fileHandler.cleanupTempFiles(processedFiles);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.logger.error('Error handling message', error);
        
        // Update status to error
        if (statusMessageTs) {
          await this.app.client.chat.update({
            channel,
            ts: statusMessageTs,
            text: '❌ *Error occurred*',
          });
        }

        // Update reaction to show error
        await this.updateMessageReaction(sessionKey, '❌');
        
        // Analyze error and provide actionable feedback
        const actionableError = ErrorAnalyzer.analyzeError(error);
        const errorMessage = ErrorAnalyzer.formatErrorMessage(actionableError);
        
        await say({
          text: errorMessage,
          thread_ts: thread_ts || ts,
        });
        
        // Log detailed error for debugging (only if it's a critical user action)
        if (actionableError.category === 'user_action_required' || actionableError.severity === 'high') {
          this.logger.warn('User action required', {
            error: error.message,
            userAction: actionableError.userAction,
            category: actionableError.category,
            sessionKey
          });
        }
      } else {
        this.logger.debug('Request was aborted', { sessionKey });
        
        // Update status to cancelled
        if (statusMessageTs) {
          await this.app.client.chat.update({
            channel,
            ts: statusMessageTs,
            text: '⏹️ *Cancelled*',
          });
        }

        // Update reaction to show cancellation
        await this.updateMessageReaction(sessionKey, '⏹️');
      }

      // Clean up temporary files in case of error too
      if (processedFiles.length > 0) {
        await this.fileHandler.cleanupTempFiles(processedFiles);
      }
    } finally {
      this.activeControllers.delete(sessionKey);
      
      // Clean up todo tracking if session ended
      if (session?.sessionId) {
        // Don't immediately clean up - keep todos visible for a while
        setTimeout(() => {
          this.todoManager.cleanupSession(session.sessionId!);
          this.todoMessages.delete(sessionKey);
          this.originalMessages.delete(sessionKey);
          this.currentReactions.delete(sessionKey);
        }, 5 * 60 * 1000); // 5 minutes
      }
    }
  }

  private extractTextContent(message: SDKMessage): string | null {
    if (message.type === 'assistant' && message.message.content) {
      const textParts = message.message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text);
      return textParts.join('');
    }
    return null;
  }

  private formatToolUse(content: any[]): string {
    const parts: string[] = [];
    
    for (const part of content) {
      if (part.type === 'text') {
        parts.push(part.text);
      } else if (part.type === 'tool_use') {
        const toolName = part.name;
        const input = part.input;
        
        switch (toolName) {
          case 'Edit':
          case 'MultiEdit':
            parts.push(this.formatEditTool(toolName, input));
            break;
          case 'Write':
            parts.push(this.formatWriteTool(input));
            break;
          case 'Read':
            parts.push(this.formatReadTool(input));
            break;
          case 'Bash':
            parts.push(this.formatBashTool(input));
            break;
          case 'TodoWrite':
            // Handle TodoWrite separately - don't include in regular tool output
            return this.handleTodoWrite(input);
          default:
            parts.push(this.formatGenericTool(toolName, input));
        }
      }
    }
    
    return parts.join('\n\n');
  }

  private formatEditTool(toolName: string, input: any): string {
    const filePath = input.file_path;
    const edits = toolName === 'MultiEdit' ? input.edits : [{ old_string: input.old_string, new_string: input.new_string }];
    
    let result = `📝 *Editing \`${filePath}\`*\n`;
    
    for (const edit of edits) {
      result += '\n```diff\n';
      result += `- ${this.truncateString(edit.old_string, 200)}\n`;
      result += `+ ${this.truncateString(edit.new_string, 200)}\n`;
      result += '```';
    }
    
    return result;
  }

  private formatWriteTool(input: any): string {
    const filePath = input.file_path;
    const preview = this.truncateString(input.content, 300);
    
    return `📄 *Creating \`${filePath}\`*\n\`\`\`\n${preview}\n\`\`\``;
  }

  private formatReadTool(input: any): string {
    return `👁️ *Reading \`${input.file_path}\`*`;
  }

  private formatBashTool(input: any): string {
    return `🖥️ *Running command:*\n\`\`\`bash\n${input.command}\n\`\`\``;
  }

  private formatGenericTool(toolName: string, input: any): string {
    return `🔧 *Using ${toolName}*`;
  }

  private truncateString(str: string, maxLength: number): string {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }

  private handleTodoWrite(input: any): string {
    // TodoWrite tool doesn't produce visible output - handled separately
    return '';
  }

  private async handleTodoUpdate(
    input: any, 
    sessionKey: string, 
    sessionId: string | undefined, 
    channel: string, 
    threadTs: string, 
    say: any
  ): Promise<void> {
    if (!sessionId || !input.todos) {
      return;
    }

    const newTodos: Todo[] = input.todos;
    const oldTodos = this.todoManager.getTodos(sessionId);
    
    // Check if there's a significant change
    if (this.todoManager.hasSignificantChange(oldTodos, newTodos)) {
      // Update the todo manager
      this.todoManager.updateTodos(sessionId, newTodos);
      
      // Format the todo list
      const todoList = this.todoManager.formatTodoList(newTodos);
      
      // Check if we already have a todo message for this session
      const existingTodoMessageTs = this.todoMessages.get(sessionKey);
      
      if (existingTodoMessageTs) {
        // Update existing todo message
        try {
          await this.app.client.chat.update({
            channel,
            ts: existingTodoMessageTs,
            text: todoList,
          });
          this.logger.debug('Updated existing todo message', { sessionKey, messageTs: existingTodoMessageTs });
        } catch (error) {
          this.logger.warn('Failed to update todo message, creating new one', error);
          // If update fails, create a new message
          await this.createNewTodoMessage(todoList, channel, threadTs, sessionKey, say);
        }
      } else {
        // Create new todo message
        await this.createNewTodoMessage(todoList, channel, threadTs, sessionKey, say);
      }

      // Send status change notification if there are meaningful changes
      const statusChange = this.todoManager.getStatusChange(oldTodos, newTodos);
      if (statusChange) {
        await say({
          text: `🔄 *Task Update:*\n${statusChange}`,
          thread_ts: threadTs,
        });
      }

      // Update reaction based on overall progress
      await this.updateTaskProgressReaction(sessionKey, newTodos);
    }
  }

  private async createNewTodoMessage(
    todoList: string, 
    channel: string, 
    threadTs: string, 
    sessionKey: string, 
    say: any
  ): Promise<void> {
    const result = await say({
      text: todoList,
      thread_ts: threadTs,
    });
    
    if (result?.ts) {
      this.todoMessages.set(sessionKey, result.ts);
      this.logger.debug('Created new todo message', { sessionKey, messageTs: result.ts });
    }
  }

  private async updateMessageReaction(sessionKey: string, emoji: string): Promise<void> {
    const originalMessage = this.originalMessages.get(sessionKey);
    if (!originalMessage) {
      return;
    }

    // Convert Unicode emojis to Slack emoji names
    const emojiMap: Record<string, string> = {
      '🤔': 'thinking_face',
      '⚙️': 'gear',
      '✅': 'white_check_mark',
      '❌': 'x',
      '📋': 'clipboard',
      '🔄': 'arrows_counterclockwise',
      '⏹️': 'stop_button'
    };

    const slackEmojiName = emojiMap[emoji] || emoji;

    // Check if we're already showing this emoji
    const currentEmoji = this.currentReactions.get(sessionKey);
    if (currentEmoji === slackEmojiName) {
      this.logger.debug('Reaction already set, skipping', { sessionKey, emoji: slackEmojiName });
      return;
    }

    try {
      // Remove the current reaction if it exists
      if (currentEmoji) {
        try {
          await this.app.client.reactions.remove({
            channel: originalMessage.channel,
            timestamp: originalMessage.ts,
            name: currentEmoji,
          });
          this.logger.debug('Removed previous reaction', { sessionKey, emoji: currentEmoji });
        } catch (error) {
          this.logger.debug('Failed to remove previous reaction (might not exist)', { 
            sessionKey, 
            emoji: currentEmoji,
            error: (error as any).message 
          });
        }
      }

      // Add the new reaction
      await this.app.client.reactions.add({
        channel: originalMessage.channel,
        timestamp: originalMessage.ts,
        name: slackEmojiName,
      });

      // Track the current reaction
      this.currentReactions.set(sessionKey, slackEmojiName);

      this.logger.debug('Updated message reaction', { 
        sessionKey, 
        emoji, 
        previousEmoji: currentEmoji,
        channel: originalMessage.channel, 
        ts: originalMessage.ts 
      });
    } catch (error) {
      this.logger.warn('Failed to update message reaction', error);
    }
  }

  private async updateTaskProgressReaction(sessionKey: string, todos: Todo[]): Promise<void> {
    if (todos.length === 0) {
      return;
    }

    const completed = todos.filter(t => t.status === 'completed').length;
    const inProgress = todos.filter(t => t.status === 'in_progress').length;
    const total = todos.length;

    let emoji: string;
    if (completed === total) {
      emoji = '✅'; // All tasks completed
    } else if (inProgress > 0) {
      emoji = '🔄'; // Tasks in progress
    } else {
      emoji = '📋'; // Tasks pending
    }

    await this.updateMessageReaction(sessionKey, emoji);
  }

  private isMcpInfoCommand(text: string): boolean {
    return /^(mcp|servers?)(\s+(info|list|status))?(\?)?$/i.test(text.trim());
  }

  private isMcpReloadCommand(text: string): boolean {
    return /^(mcp|servers?)\s+(reload|refresh)$/i.test(text.trim());
  }

  private async getBotUserId(): Promise<string> {
    if (!this.botUserId) {
      try {
        const response = await this.app.client.auth.test();
        this.botUserId = response.user_id as string;
      } catch (error) {
        this.logger.error('Failed to get bot user ID', error);
        this.botUserId = '';
      }
    }
    return this.botUserId;
  }

  private async handleChannelJoin(channelId: string, say: any): Promise<void> {
    try {
      // Get channel info
      const channelInfo = await this.app.client.conversations.info({
        channel: channelId,
      });

      const channelName = (channelInfo.channel as any)?.name || 'this channel';
      
      let welcomeMessage = `👋 Hi! I'm Claude Code, your AI coding assistant.\n\n`;
      welcomeMessage += `To get started, I need to know the default working directory for #${channelName}.\n\n`;
      
      if (config.baseDirectory) {
        welcomeMessage += `You can use:\n`;
        welcomeMessage += `• \`cwd project-name\` (relative to base directory: \`${config.baseDirectory}\`)\n`;
        welcomeMessage += `• \`cwd /absolute/path/to/project\` (absolute path)\n\n`;
      } else {
        welcomeMessage += `Please set it using:\n`;
        welcomeMessage += `• \`cwd /path/to/project\` or \`set directory /path/to/project\`\n\n`;
      }
      
      welcomeMessage += `This will be the default working directory for this channel. `;
      welcomeMessage += `You can always override it for specific threads by mentioning me with a different \`cwd\` command.\n\n`;
      welcomeMessage += `Once set, you can ask me to help with code reviews, file analysis, debugging, and more!`;

      await say({
        text: welcomeMessage,
      });

      this.logger.info('Sent welcome message to channel', { channelId, channelName });
    } catch (error) {
      this.logger.error('Failed to handle channel join', error);
    }
  }

  private async handleUserMessage(
    message: any,
    sessionKey: string,
    slackMessageIndex: number,
    channel: string,
    threadTs: string,
    say: any
  ): Promise<void> {
    try {
      this.logger.info('Processing user message with potential tool results', {
        slackMessageIndex,
        sessionKey,
        hasMessage: !!message.message,
        messageKeys: message.message ? Object.keys(message.message) : [],
        hasContent: !!message.message?.content,
        contentLength: message.message?.content?.length || 0
      });

      if (!message.message?.content || !Array.isArray(message.message.content)) {
        this.logger.debug('User message has no content array', { slackMessageIndex, sessionKey });
        return;
      }

      // Look for tool_result content in the message
      let toolResults: any[] = [];
      try {
        toolResults = message.message.content.filter((part: any) => part.type === 'tool_result');
      } catch (filterError: any) {
        this.logger.error('Error filtering tool results from message content', {
          error: filterError.message,
          sessionKey,
          slackMessageIndex
        });
        return; // Exit gracefully on filter error
      }
      
      this.logger.info('Found tool results in user message', {
        slackMessageIndex,
        sessionKey,
        toolResultCount: toolResults.length,
        toolResultIds: toolResults.map((result: any) => result?.tool_use_id).filter(Boolean),
        contentTypes: message.message.content.map((part: any) => part?.type).filter(Boolean)
      });

      // Process each tool result with individual error handling
      for (let i = 0; i < toolResults.length; i++) {
        const toolResult = toolResults[i];
        try {
          await this.processToolResult(toolResult, sessionKey, slackMessageIndex, channel, threadTs, say);
        } catch (toolResultError: any) {
          this.logger.error('Error processing individual tool result', {
            error: toolResultError.message,
            sessionKey,
            slackMessageIndex,
            toolResultIndex: i,
            toolUseId: toolResult?.tool_use_id
          });
          
          // Continue processing other tool results even if one fails
          continue;
        }
        
        // Cleanup tool result reference after processing
        toolResults[i] = null;
      }
      
      // Final cleanup of tool results array
      toolResults.length = 0;
      
    } catch (criticalError: any) {
      this.logger.error('Critical error in handleUserMessage', {
        error: criticalError.message,
        stack: criticalError.stack,
        sessionKey,
        slackMessageIndex
      });
      
      // Last resort cleanup and recovery
      try {
        // Attempt to notify about the error
        await say({
          text: '❌ *Error processing user message with file content.*\n> Please try again or contact support if the issue persists.',
          thread_ts: threadTs,
        });
      } catch (notificationError: any) {
        this.logger.error('Critical: Failed to send error notification in handleUserMessage', {
          error: notificationError.message,
          sessionKey
        });
      }
    }
  }

  private async processToolResult(
    toolResult: any,
    sessionKey: string,
    slackMessageIndex: number,
    channel: string,
    threadTs: string,
    say: any
  ): Promise<void> {
    try {
      this.logger.info('Processing individual tool result', {
        slackMessageIndex,
        sessionKey,
        toolUseId: toolResult.tool_use_id,
        hasContent: !!toolResult.content,
        contentLength: toolResult.content?.length || 0,
        contentPreview: toolResult.content?.substring(0, 200) + (toolResult.content?.length > 200 ? '...' : ''),
        isError: toolResult.is_error
      });

      // Check if this tool result should be displayed (only Read tool results)
      if (!this.shouldDisplayToolResult(toolResult)) {
        this.logger.debug('Skipping tool result display (not a Read tool result)', {
          slackMessageIndex,
          sessionKey,
          toolUseId: toolResult.tool_use_id
        });
        return;
      }

      // Enhanced content processing with formatting and display logic
      if (toolResult.content && typeof toolResult.content === 'string') {
        let displayContent: string | null = null;
        
        try {
          displayContent = this.displayFileContent(toolResult.content, toolResult.tool_use_id);
        } catch (contentError: any) {
          this.logger.error('Error processing file content', {
            error: contentError.message,
            sessionKey,
            toolUseId: toolResult.tool_use_id,
            contentLength: toolResult.content.length
          });
          
          // Graceful fallback for content processing errors
          displayContent = this.createContentProcessingErrorFallback(contentError.message);
        }
        
        if (displayContent) {
          try {
            // Rate limiting for large content to prevent Slack API rate limits
            await this.applyRateLimiting(toolResult.content.length);
            
            await say({
              text: displayContent,
              thread_ts: threadTs,
            });
            
            this.logger.debug('Successfully sent tool result content to Slack', {
              sessionKey,
              toolUseId: toolResult.tool_use_id,
              displayContentLength: displayContent.length
            });
            
          } catch (slackError: any) {
            this.logger.error('Error sending content to Slack', {
              error: slackError.message,
              sessionKey,
              toolUseId: toolResult.tool_use_id
            });
            
            // Attempt to send a simplified error message
            try {
              await say({
                text: this.createSlackSendErrorFallback(),
                thread_ts: threadTs,
              });
            } catch (fallbackError: any) {
              this.logger.error('Critical: Failed to send fallback error message', {
                error: fallbackError.message,
                sessionKey
              });
            }
          }
        }
      }
    } catch (criticalError: any) {
      this.logger.error('Critical error in processToolResult', {
        error: criticalError.message,
        stack: criticalError.stack,
        sessionKey,
        toolUseId: toolResult?.tool_use_id
      });
      
      // Last resort fallback - try to indicate something went wrong
      try {
        await say({
          text: '❌ *An unexpected error occurred while processing file content.*',
          thread_ts: threadTs,
        });
      } catch (lastResortError: any) {
        this.logger.error('Critical: Complete failure in error handling', {
          error: lastResortError.message,
          sessionKey
        });
      }
    }
  }

  private isSafeToDisplay(content: string, filePath?: string): { safe: boolean; reason?: string } {
    // Check file path safety first if provided
    if (filePath && !this.isPathSafe(filePath)) {
      return { safe: false, reason: 'Unsafe file path detected' };
    }

    // Comprehensive credential detection patterns
    const credentialPatterns = [
      // API Keys
      { pattern: /(?:api_key|apikey|api-key)[\s]*[:=][\s]*['"]*([a-zA-Z0-9_-]{20,})['"]*\s*$/im, type: 'API Key' },
      { pattern: /['"](sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,})['"]/g, type: 'Stripe Key' },
      { pattern: /['"](xoxb-[0-9]{11,13}-[0-9]{11,13}-[a-zA-Z0-9]{24})['"]/g, type: 'Slack Bot Token' },
      { pattern: /['"](xoxp-[0-9]{11,13}-[0-9]{11,13}-[a-zA-Z0-9]{24})['"]/g, type: 'Slack User Token' },
      { pattern: /['"](xapp-[0-9]{1}-[A-Z0-9]{11}-[0-9]{12}-[a-f0-9]{64})['"]/g, type: 'Slack App Token' },
      
      // JWT Tokens
      { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, type: 'JWT Token' },
      
      // AWS Credentials
      { pattern: /AKIA[0-9A-Z]{16}/g, type: 'AWS Access Key' },
      { pattern: /(?:aws_secret_access_key|secret_key)[\s]*[:=][\s]*['"]*([a-zA-Z0-9+/]{40})['"]*\s*$/im, type: 'AWS Secret Key' },
      
      // GitHub Tokens
      { pattern: /ghp_[a-zA-Z0-9]{36}/g, type: 'GitHub Personal Access Token' },
      { pattern: /gho_[a-zA-Z0-9]{36}/g, type: 'GitHub OAuth Token' },
      { pattern: /ghu_[a-zA-Z0-9]{36}/g, type: 'GitHub User-to-Server Token' },
      { pattern: /ghs_[a-zA-Z0-9]{36}/g, type: 'GitHub Server-to-Server Token' },
      { pattern: /ghr_[a-zA-Z0-9]{36}/g, type: 'GitHub Refresh Token' },
      
      // Private Keys
      { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gi, type: 'Private Key' },
      { pattern: /-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/gi, type: 'Certificate/Public Key' },
      
      // Database URLs and Connection Strings
      { pattern: /postgres:\/\/[^:\s]+:[^@\s]+@[^\/\s]+\/[^\s]+/gi, type: 'PostgreSQL Connection String' },
      { pattern: /mysql:\/\/[^:\s]+:[^@\s]+@[^\/\s]+\/[^\s]+/gi, type: 'MySQL Connection String' },
      { pattern: /mongodb(\+srv)?:\/\/[^:\s]+:[^@\s]+@[^\/\s]+\/[^\s]+/gi, type: 'MongoDB Connection String' },
      
      // Generic patterns
      { pattern: /(?:password|pwd|pass)[\s]*[:=][\s]*['"]*([a-zA-Z0-9!@#$%^&*()_+-=]{8,})['"]*\s*$/im, type: 'Password' },
      { pattern: /(?:secret|token|key)[\s]*[:=][\s]*['"]*([a-zA-Z0-9_-]{32,})['"]*\s*$/im, type: 'Generic Secret' },
      { pattern: /['"]((?:[0-9a-fA-F]{2}){32,})['"]/g, type: 'Long Hex String' },
    ];

    // Check each pattern against the content
    for (const { pattern, type } of credentialPatterns) {
      if (pattern.test(content)) {
        this.logger.warn('Security: Blocked content containing credentials', { 
          type, 
          contentLength: content.length,
          filePath: filePath || 'unknown'
        });
        return { safe: false, reason: `Content contains ${type}` };
      }
    }

    // Additional heuristics for suspicious content
    const suspiciousPatterns = [
      // Base64 encoded strings that might be credentials (long ones)
      { pattern: /^[A-Za-z0-9+/]{100,}={0,2}$/m, type: 'Long Base64 String' },
      
      // Multiple key-value pairs that look like config
      { pattern: /((?:api_key|secret|token|password|key)[\s]*[:=][\s]*['"]*[a-zA-Z0-9_-]{10,}['"]*\s*){3,}/im, type: 'Multiple Secrets' },
      
      // Environment variable exports with secrets
      { pattern: /export\s+[A-Z_]+(?:SECRET|KEY|TOKEN|PASSWORD)\s*=\s*['"]*[a-zA-Z0-9_-]{10,}['"]*$/im, type: 'Environment Secret Export' }
    ];

    for (const { pattern, type } of suspiciousPatterns) {
      if (pattern.test(content)) {
        this.logger.warn('Security: Blocked suspicious content', { 
          type, 
          contentLength: content.length,
          filePath: filePath || 'unknown'
        });
        return { safe: false, reason: `Content contains ${type}` };
      }
    }

    return { safe: true };
  }

  private isPathSafe(filePath: string): boolean {
    // Directory traversal protection
    const dangerousPatterns = [
      /\.\./g,           // Parent directory traversal
      /\0/g,             // Null bytes
      /[<>|]/g,          // Command injection characters
      /^\/etc\//i,       // System config files
      /^\/proc\//i,      // System process files
      /^\/sys\//i,       // System files
      /^\/dev\//i,       // Device files
      /\.ssh\//i,        // SSH keys
      /\.aws\//i,        // AWS credentials
      /\.env/i,          // Environment files
      /id_rsa|id_dsa|id_ecdsa|id_ed25519/i, // SSH private keys
    ];

    // Check for dangerous patterns
    for (const pattern of dangerousPatterns) {
      if (pattern.test(filePath)) {
        this.logger.warn('Security: Blocked unsafe file path', { 
          filePath,
          pattern: pattern.toString()
        });
        return false;
      }
    }

    // Normalize path to check for encoded traversals
    try {
      const normalized = decodeURIComponent(filePath);
      if (normalized !== filePath && dangerousPatterns.some(pattern => pattern.test(normalized))) {
        this.logger.warn('Security: Blocked encoded unsafe file path', { 
          filePath,
          normalized
        });
        return false;
      }
    } catch (error) {
      // If decoding fails, be conservative and block
      this.logger.warn('Security: Blocked path with decoding error', { filePath });
      return false;
    }

    return true;
  }

  private shouldDisplayToolResult(toolResult: any): boolean {
    // Only display results from Read tool operations
    // The tool_use_id should contain information about which tool was used
    // For now, we'll display all tool results but this can be enhanced
    // to specifically filter for Read tool results if needed
    
    // Check if it's an error result - don't display error content as file content
    if (toolResult.is_error) {
      this.logger.debug('Skipping error tool result', { 
        toolUseId: toolResult.tool_use_id,
        isError: toolResult.is_error
      });
      return false;
    }

    // For Phase 3, display all non-error tool results
    // In the future, this could be enhanced to specifically detect Read tool results
    return true;
  }

  private getLanguageFromPath(filePath?: string): string {
    if (!filePath) return '';
    
    const extension = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      // JavaScript/TypeScript
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      
      // Python
      'py': 'python',
      'pyw': 'python',
      
      // Web technologies
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      
      // Config files
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'toml': 'toml',
      
      // Shell/Scripts
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'ps1': 'powershell',
      
      // Programming languages
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      
      // Markup/Documentation
      'md': 'markdown',
      'markdown': 'markdown',
      'rst': 'rst',
      'tex': 'latex',
      
      // Data formats
      'csv': 'csv',
      'tsv': 'csv',
      'sql': 'sql',
      
      // Other
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'r': 'r',
      'R': 'r'
    };

    return languageMap[extension || ''] || '';
  }

  private stripLineNumbers(content: string): string {
    // First, remove system reminder blocks (which can span multiple lines)
    let cleanContent = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
    
    // Then strip line number prefixes line by line
    return cleanContent
      .split('\n')
      .map(line => {
        // Match line number prefix pattern and remove it
        const match = line.match(/^\s*\d+→(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n')
      .trim(); // Remove extra whitespace
  }

  private truncateContent(content: string, maxLength: number = 400): { truncated: string; wasTruncated: boolean } {
    if (content.length <= maxLength) {
      return { truncated: content, wasTruncated: false };
    }

    // Try to truncate at a smart breakpoint (line ending, sentence ending, word boundary)
    let truncateAt = maxLength;
    
    // Look for line breaks near the limit
    const nearbyNewline = content.lastIndexOf('\n', maxLength);
    if (nearbyNewline > maxLength * 0.7) { // At least 70% of content
      truncateAt = nearbyNewline;
    } else {
      // Look for sentence endings
      const nearbySentenceEnd = Math.max(
        content.lastIndexOf('. ', maxLength),
        content.lastIndexOf('.\n', maxLength),
        content.lastIndexOf(';\n', maxLength)
      );
      if (nearbySentenceEnd > maxLength * 0.8) { // At least 80% of content
        truncateAt = nearbySentenceEnd + 1;
      } else {
        // Look for word boundaries
        const nearbySpace = content.lastIndexOf(' ', maxLength);
        if (nearbySpace > maxLength * 0.9) { // At least 90% of content
          truncateAt = nearbySpace;
        }
      }
    }

    const truncated = content.substring(0, truncateAt).trim();
    return { truncated, wasTruncated: true };
  }

  private displayFileContent(content: string, toolUseId?: string): string | null {
    try {
      if (!content) return null;

      // 50KB memory limit protection - block oversized content early
      const MAX_CONTENT_SIZE = 50 * 1024; // 50KB
      if (content.length > MAX_CONTENT_SIZE) {
        const originalSize = content.length;
        this.logger.warn('Content exceeds size limit', {
          contentLength: originalSize,
          maxSize: MAX_CONTENT_SIZE,
          toolUseId: toolUseId || 'unknown'
        });
        
        // Cleanup reference to large content immediately
        content = '';
        
        return this.createOversizedContentFallback(originalSize, MAX_CONTENT_SIZE);
      }

      this.logger.debug('Displaying file content', {
        contentType: typeof content,
        contentLength: content.length,
        toolUseId: toolUseId || 'unknown'
      });

      // Security validation with cleanup on failure
      let safetyCheck: { safe: boolean; reason?: string };
      try {
        safetyCheck = this.isSafeToDisplay(content);
      } catch (securityError: any) {
        this.logger.error('Security validation failed', {
          error: securityError.message,
          contentLength: content.length,
          toolUseId: toolUseId || 'unknown'
        });
        
        // Cleanup content reference on security error
        content = '';
        
        return this.createSecurityBlockedFallback('Security validation error');
      }
      
      if (!safetyCheck.safe) {
        this.logger.warn('Security: Blocked unsafe content', {
          reason: safetyCheck.reason,
          contentLength: content.length,
          toolUseId: toolUseId || 'unknown'
        });
        
        // Cleanup content reference after security block
        content = '';
        
        return this.createSecurityBlockedFallback(safetyCheck.reason || 'Unknown security issue');
      }

      // Extract file path from content if it looks like a Read tool result
      // This is a heuristic - actual file path extraction would need Claude SDK integration
      const filePath = this.extractFilePathFromContent(content);
      const language = this.getLanguageFromPath(filePath || undefined);
      
      // Strip line numbers from Claude Code Read tool output
      const cleanContent = this.stripLineNumbers(content);
      
      // Truncate content with smart line-break handling
      const { truncated, wasTruncated } = this.truncateContent(cleanContent, 35000);
      
      // Format as code block with language hint if available
      let formattedContent = '';
      if (language) {
        // Slack doesn't support language-specific syntax highlighting in code blocks,
        // but we can include the language as a comment for context
        formattedContent = `\`\`\`\n${truncated}\n\`\`\``;
      } else {
        formattedContent = `\`\`\`\n${truncated}\n\`\`\``;
      }

      // Add truncation indicator
      if (wasTruncated) {
        formattedContent += `\n_... (showing first ${truncated.length} of ${cleanContent.length} characters)_`;
      }

      // Add file path if detected
      let header = '📄 *File Content:*';
      if (filePath) {
        header = `📄 *File Content:* \`${filePath}\``;
      }

      // Cleanup content reference before returning
      content = '';
      
      return `${header}\n${formattedContent}`;
      
    } catch (formatError: any) {
      this.logger.error('Critical error in displayFileContent', {
        error: formatError.message,
        stack: formatError.stack,
        contentLength: content?.length || 0,
        toolUseId: toolUseId || 'unknown'
      });
      
      // Cleanup content reference on error
      content = '';
      
      // Return a safe fallback message
      return this.createContentProcessingErrorFallback(formatError.message);
    }
  }

  private extractFilePathFromContent(content: string): string | null {
    // This is a heuristic to extract file paths from Read tool results
    // In a full implementation, this would come from the Claude SDK context
    
    // Look for common file path patterns at the start of content
    const lines = content.split('\n').slice(0, 3); // Check first 3 lines
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip line numbers or empty lines
      if (!trimmed || /^\d+→/.test(trimmed)) continue;
      
      // Look for path-like strings
      if (trimmed.includes('/') && !trimmed.includes(' ') && trimmed.length > 3) {
        // Basic file path validation
        if (trimmed.startsWith('/') || trimmed.includes('.')) {
          return trimmed;
        }
      }
    }
    
    return null;
  }

  private async applyRateLimiting(contentLength: number): Promise<void> {
    // Rate limiting delays for large content to prevent Slack API rate limits
    if (contentLength > 1000) {
      const delayMs = 500; // 500ms delay for content over 1000 characters
      this.logger.debug('Applying rate limiting delay for large content', {
        contentLength,
        delayMs
      });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  private createOversizedContentFallback(actualSize: number, maxSize: number): string {
    const sizeMB = (actualSize / (1024 * 1024)).toFixed(2);
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
    
    return `📏 *File too large to display*\n> File size: ${sizeMB}MB (max: ${maxSizeMB}MB)\n> File content exceeds size limits and cannot be displayed in Slack.\n> Consider using file sharing or breaking the content into smaller parts.`;
  }

  private createSecurityBlockedFallback(reason: string): string {
    return `🔒 *Content blocked for security*\n> ${reason}\n> File content contains sensitive information that cannot be displayed.`;
  }

  private createContentProcessingErrorFallback(errorMessage: string): string {
    return `⚠️ *Error processing file content*\n> Processing error: ${errorMessage}\n> Unable to format file content for display. The file may contain invalid characters or be corrupted.`;
  }

  private createSlackSendErrorFallback(): string {
    return `📤 *Error sending content to Slack*\n> Unable to display file content due to messaging error.\n> This may be due to content length, formatting issues, or temporary Slack API problems.`;
  }

  private extractToolResultContent(toolResult: any): string | null {
    // Deprecated method - now using displayFileContent for enhanced formatting
    return this.displayFileContent(toolResult.content, toolResult.tool_use_id);
  }

  private formatMessage(text: string, isFinal: boolean): string {
    // Convert markdown code blocks to Slack format
    let formatted = text
      .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
        return '```' + code + '```';
      })
      .replace(/`([^`]+)`/g, '`$1`')
      .replace(/\*\*([^*]+)\*\*/g, '*$1*')
      .replace(/__([^_]+)__/g, '_$1_');

    return formatted;
  }

  setupEventHandlers() {
    // Handle direct messages
    this.app.message(async ({ message, say }) => {
      if (message.subtype === undefined && 'user' in message) {
        this.logger.info('Handling direct message event');
        await this.handleMessage(message as MessageEvent, say);
      }
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, say }) => {
      this.logger.info('Handling app mention event');
      const text = event.text.replace(/<@[^>]+>/g, '').trim();
      await this.handleMessage({
        ...event,
        text,
      } as MessageEvent, say);
    });

    // Handle file uploads in threads
    this.app.event('message', async ({ event, say }) => {
      // Only handle file uploads that are not from bots and have files
      if (event.subtype === 'file_share' && 'user' in event && event.files) {
        this.logger.info('Handling file upload event');
        await this.handleMessage(event as MessageEvent, say);
      }
    });

    // Handle bot being added to channels
    this.app.event('member_joined_channel', async ({ event, say }) => {
      // Check if the bot was added to the channel
      if (event.user === await this.getBotUserId()) {
        this.logger.info('Bot added to channel', { channel: event.channel });
        await this.handleChannelJoin(event.channel, say);
      }
    });

    // Handle permission approval button clicks
    this.app.action('approve_tool', async ({ ack, body, respond }) => {
      await ack();
      const approvalId = (body as any).actions[0].value;
      this.logger.info('Tool approval granted', { approvalId });
      
      permissionServer.resolveApproval(approvalId, true);
      
      await respond({
        response_type: 'ephemeral',
        text: '✅ Tool execution approved'
      });
    });

    // Handle permission denial button clicks
    this.app.action('deny_tool', async ({ ack, body, respond }) => {
      await ack();
      const approvalId = (body as any).actions[0].value;
      this.logger.info('Tool approval denied', { approvalId });
      
      permissionServer.resolveApproval(approvalId, false);
      
      await respond({
        response_type: 'ephemeral',
        text: '❌ Tool execution denied'
      });
    });

    // Cleanup inactive sessions periodically
    setInterval(() => {
      this.logger.debug('Running session cleanup');
      this.claudeHandler.cleanupInactiveSessions();
    }, 5 * 60 * 1000); // Every 5 minutes
  }
}