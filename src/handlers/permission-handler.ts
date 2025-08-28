import { App } from '@slack/bolt';
import { Logger } from '../logger';
import { permissionServer } from '../permission-mcp-server';

export interface SlackPermissionContext {
  channel: string;
  threadTs?: string;
  user: string;
}

export class PermissionHandler {
  private app: App;
  private logger = new Logger('PermissionHandler');

  constructor(app: App) {
    this.app = app;
    this.setupPermissionHandlers();
  }

  /**
   * Create Slack context for permission prompts
   */
  createSlackContext(channel: string, user: string, threadTs?: string): SlackPermissionContext {
    return {
      channel,
      threadTs,
      user
    };
  }

  /**
   * Setup permission-related action handlers
   */
  private setupPermissionHandlers(): void {
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
  }
}