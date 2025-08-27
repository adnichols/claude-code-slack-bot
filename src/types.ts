export interface ConversationSession {
  userId: string;
  channelId: string;
  threadTs?: string;
  sessionId?: string;
  isActive: boolean;
  lastActivity: Date;
  workingDirectory?: string;
}

export interface WorkingDirectoryConfig {
  channelId: string;
  threadTs?: string;
  userId?: string;
  directory: string;
  setAt: Date;
}

export interface LocalPermissionConfig {
  permissions?: {
    autoApprove?: string[];
    tools?: {
      [toolName: string]: {
        enabled?: boolean;
        autoApprove?: boolean;
        commands?: string[];
      };
    };
  };
  security?: {
    maxConfigFileSize?: number;
    allowedPaths?: string[];
    blockedCommands?: string[];
  };
}

export interface LocalConfigResult {
  config: LocalPermissionConfig;
  source: 'team' | 'personal' | 'merged';
  loadedFrom: string[];
}

export interface PermissionCheckResult {
  isApproved: boolean;
  source: 'local-config' | 'existing-approval' | 'none';
  matchType?: 'exact' | 'tool' | 'pattern';
  configPath?: string;
}