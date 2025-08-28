import { App } from '@slack/bolt';
import { Logger } from './logger';
import { Todo } from './todo-manager';

export class ReactionManager {
  private app: App;
  private logger = new Logger('ReactionManager');
  private currentReactions: Map<string, string> = new Map(); // sessionKey -> current emoji
  private originalMessages: Map<string, { channel: string; ts: string }> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Set original message info for a session
   */
  setOriginalMessage(sessionKey: string, channel: string, ts: string): void {
    this.originalMessages.set(sessionKey, { channel, ts });
  }

  /**
   * Update message reaction for a session
   */
  async updateMessageReaction(sessionKey: string, emoji: string): Promise<void> {
    const originalMessage = this.originalMessages.get(sessionKey);
    if (!originalMessage) {
      this.logger.debug('No original message found for reaction update', { sessionKey });
      return;
    }

    const { channel, ts } = originalMessage;
    const currentEmoji = this.currentReactions.get(sessionKey);

    try {
      // Remove previous reaction if it exists and is different
      if (currentEmoji && currentEmoji !== emoji) {
        try {
          await this.app.client.reactions.remove({
            channel,
            timestamp: ts,
            name: currentEmoji,
          });
        } catch (error) {
          this.logger.debug('Could not remove previous reaction', { 
            sessionKey, 
            emoji: currentEmoji, 
            error 
          });
        }
      }

      // Add new reaction if it's different from current
      if (currentEmoji !== emoji) {
        await this.app.client.reactions.add({
          channel,
          timestamp: ts,
          name: emoji,
        });
        
        this.currentReactions.set(sessionKey, emoji);
        this.logger.debug('Updated message reaction', { sessionKey, emoji });
      }
    } catch (error) {
      this.logger.warn('Failed to update message reaction', { 
        sessionKey, 
        emoji, 
        channel, 
        ts,
        error: error instanceof Error ? error.message : error 
      });
    }
  }

  /**
   * Update task progress reaction based on todos
   */
  async updateTaskProgressReaction(sessionKey: string, todos: Todo[]): Promise<void> {
    if (!todos || todos.length === 0) return;

    const totalTasks = todos.length;
    const completedTasks = todos.filter(todo => todo.status === 'completed').length;
    const inProgressTasks = todos.filter(todo => todo.status === 'in_progress').length;

    let emoji: string;
    
    if (completedTasks === totalTasks) {
      emoji = 'white_check_mark'; // ✅ All tasks completed
    } else if (inProgressTasks > 0) {
      emoji = 'gear'; // ⚙️ Tasks in progress
    } else {
      emoji = 'thinking_face'; // 🤔 Planning/pending
    }

    await this.updateMessageReaction(sessionKey, emoji);
  }

  /**
   * Clear reaction for a session
   */
  async clearReaction(sessionKey: string): Promise<void> {
    const originalMessage = this.originalMessages.get(sessionKey);
    const currentEmoji = this.currentReactions.get(sessionKey);
    
    if (!originalMessage || !currentEmoji) return;

    try {
      await this.app.client.reactions.remove({
        channel: originalMessage.channel,
        timestamp: originalMessage.ts,
        name: currentEmoji,
      });
      
      this.currentReactions.delete(sessionKey);
      this.logger.debug('Cleared reaction', { sessionKey, emoji: currentEmoji });
    } catch (error) {
      this.logger.debug('Could not clear reaction', { sessionKey, error });
    }
  }

  /**
   * Clean up old reaction data
   */
  cleanup(sessionKey: string): void {
    this.currentReactions.delete(sessionKey);
    this.originalMessages.delete(sessionKey);
  }

  /**
   * Get current reaction for a session
   */
  getCurrentReaction(sessionKey: string): string | undefined {
    return this.currentReactions.get(sessionKey);
  }

  /**
   * Check if session has original message tracked
   */
  hasOriginalMessage(sessionKey: string): boolean {
    return this.originalMessages.has(sessionKey);
  }
}