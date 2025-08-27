import fs from 'fs/promises';
import path from 'path';
import { LocalPermissionConfig, LocalConfigResult, PermissionCheckResult } from './types.js';
import { Logger } from './logger.js';

const logger = new Logger('LocalConfigReader');

const CONFIG_CACHE = new Map<string, { config: LocalConfigResult; timestamp: number; }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CONFIG_SIZE = 1024 * 1024; // 1MB
const CONFIG_TIMEOUT = 5000; // 5 seconds

export class LocalConfigReader {
  private static instance: LocalConfigReader;
  
  static getInstance(): LocalConfigReader {
    if (!LocalConfigReader.instance) {
      LocalConfigReader.instance = new LocalConfigReader();
    }
    return LocalConfigReader.instance;
  }

  async loadLocalPermissions(workingDirectory: string): Promise<LocalConfigResult | null> {
    const cacheKey = path.resolve(workingDirectory);
    
    // Check cache first
    const cached = CONFIG_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      logger.debug(`Using cached config for ${workingDirectory}`);
      return cached.config;
    }

    try {
      const result = await Promise.race([
        this.loadConfigWithTraversal(workingDirectory),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Config loading timeout')), CONFIG_TIMEOUT)
        )
      ]);

      // Cache the result
      if (result) {
        CONFIG_CACHE.set(cacheKey, { config: result, timestamp: Date.now() });
      }

      return result;
    } catch (error) {
      logger.error('Error loading local config:', error);
      return null;
    }
  }

  private async loadConfigWithTraversal(startDir: string): Promise<LocalConfigResult | null> {
    const loadedFrom: string[] = [];
    let teamConfig: LocalPermissionConfig = {};
    let personalConfig: LocalPermissionConfig = {};
    
    let currentDir = path.resolve(startDir);
    const maxLevels = 10; // Prevent infinite traversal
    let levels = 0;

    // Traverse up the directory tree looking for .claude directories
    while (levels < maxLevels) {
      const claudeDir = path.join(currentDir, '.claude');
      
      try {
        const stats = await fs.stat(claudeDir);
        if (stats.isDirectory()) {
          // Try to load team settings
          const teamSettingsPath = path.join(claudeDir, 'settings.json');
          const teamConfigResult = await this.loadConfigFile(teamSettingsPath);
          if (teamConfigResult) {
            teamConfig = this.mergeConfigs(teamConfig, teamConfigResult);
            loadedFrom.push(teamSettingsPath);
          }

          // Try to load personal settings (overrides team settings)
          const personalSettingsPath = path.join(claudeDir, 'settings.local.json');
          const personalConfigResult = await this.loadConfigFile(personalSettingsPath);
          if (personalConfigResult) {
            personalConfig = this.mergeConfigs(personalConfig, personalConfigResult);
            loadedFrom.push(personalSettingsPath);
          }
        }
      } catch (error) {
        // Directory doesn't exist or not accessible, continue
      }

      // Move up one directory level
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached root directory
      }
      currentDir = parentDir;
      levels++;
    }

    if (loadedFrom.length === 0) {
      return null;
    }

    // Merge configs with personal overriding team
    const finalConfig = this.mergeConfigs(teamConfig, personalConfig);
    
    // Determine source type
    let source: 'team' | 'personal' | 'merged';
    if (loadedFrom.some(p => p.includes('settings.local.json')) && loadedFrom.some(p => p.includes('settings.json'))) {
      source = 'merged';
    } else if (loadedFrom.some(p => p.includes('settings.local.json'))) {
      source = 'personal';
    } else {
      source = 'team';
    }

    return {
      config: finalConfig,
      source,
      loadedFrom
    };
  }

  private async loadConfigFile(filePath: string): Promise<LocalPermissionConfig | null> {
    try {
      // Security check: file size
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_CONFIG_SIZE) {
        logger.warn(`Config file too large: ${filePath} (${stats.size} bytes)`);
        return null;
      }

      // Security check: file path
      if (!this.isValidConfigPath(filePath)) {
        logger.warn(`Invalid config path: ${filePath}`);
        return null;
      }

      const content = await fs.readFile(filePath, 'utf8');
      const config = JSON.parse(content) as LocalPermissionConfig;
      
      // Validate and sanitize config
      const validatedConfig = this.validateConfig(config);
      
      logger.debug(`Loaded config from ${filePath}`);
      return validatedConfig;
      
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Error loading config from ${filePath}:`, error);
      }
      return null;
    }
  }

  private validateConfig(config: any): LocalPermissionConfig {
    const validatedConfig: LocalPermissionConfig = {};

    // Validate permissions section
    if (config.permissions && typeof config.permissions === 'object') {
      validatedConfig.permissions = {};
      
      // Validate autoApprove array
      if (Array.isArray(config.permissions.autoApprove)) {
        validatedConfig.permissions.autoApprove = config.permissions.autoApprove
          .filter((cmd: any) => typeof cmd === 'string' && cmd.length > 0)
          .slice(0, 100); // Limit to 100 commands
      }

      // Validate tools section
      if (config.permissions.tools && typeof config.permissions.tools === 'object') {
        validatedConfig.permissions.tools = {};
        
        Object.entries(config.permissions.tools).forEach(([toolName, toolConfig]: [string, any]) => {
          if (typeof toolName === 'string' && toolConfig && typeof toolConfig === 'object') {
            const validatedTool: any = {};
            
            if (typeof toolConfig.enabled === 'boolean') {
              validatedTool.enabled = toolConfig.enabled;
            }
            
            if (typeof toolConfig.autoApprove === 'boolean') {
              validatedTool.autoApprove = toolConfig.autoApprove;
            }
            
            if (Array.isArray(toolConfig.commands)) {
              validatedTool.commands = toolConfig.commands
                .filter((cmd: any) => typeof cmd === 'string' && cmd.length > 0)
                .slice(0, 50); // Limit to 50 commands per tool
            }
            
            validatedConfig.permissions!.tools![toolName] = validatedTool;
          }
        });
      }
    }

    // Validate security section
    if (config.security && typeof config.security === 'object') {
      validatedConfig.security = {};
      
      if (typeof config.security.maxConfigFileSize === 'number' && config.security.maxConfigFileSize > 0) {
        validatedConfig.security.maxConfigFileSize = Math.min(config.security.maxConfigFileSize, MAX_CONFIG_SIZE);
      }
      
      if (Array.isArray(config.security.allowedPaths)) {
        validatedConfig.security.allowedPaths = config.security.allowedPaths
          .filter((p: any) => typeof p === 'string' && p.length > 0)
          .slice(0, 20); // Limit to 20 paths
      }
      
      if (Array.isArray(config.security.blockedCommands)) {
        validatedConfig.security.blockedCommands = config.security.blockedCommands
          .filter((cmd: any) => typeof cmd === 'string' && cmd.length > 0)
          .slice(0, 100); // Limit to 100 blocked commands
      }
    }

    return validatedConfig;
  }

  private isValidConfigPath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    
    // Must end with settings.json or settings.local.json in a .claude directory
    if (!resolved.includes('/.claude/settings') || !resolved.endsWith('.json')) {
      return false;
    }
    
    // Security check: prevent path traversal
    if (resolved.includes('..') || resolved.includes('~')) {
      return false;
    }
    
    return true;
  }

  private mergeConfigs(base: LocalPermissionConfig, override: LocalPermissionConfig): LocalPermissionConfig {
    const merged: LocalPermissionConfig = JSON.parse(JSON.stringify(base));
    
    if (override.permissions) {
      merged.permissions = merged.permissions || {};
      
      if (override.permissions.autoApprove) {
        merged.permissions.autoApprove = [
          ...(merged.permissions.autoApprove || []),
          ...override.permissions.autoApprove
        ];
      }
      
      if (override.permissions.tools) {
        merged.permissions.tools = merged.permissions.tools || {};
        Object.entries(override.permissions.tools).forEach(([toolName, toolConfig]) => {
          merged.permissions!.tools![toolName] = {
            ...merged.permissions!.tools![toolName],
            ...toolConfig
          };
        });
      }
    }
    
    if (override.security) {
      merged.security = {
        ...merged.security,
        ...override.security
      };
    }
    
    return merged;
  }

  async isPreApproved(command: string, tool: string, workingDirectory: string): Promise<PermissionCheckResult> {
    const configResult = await this.loadLocalPermissions(workingDirectory);
    
    if (!configResult) {
      return {
        isApproved: false,
        source: 'none'
      };
    }

    const config = configResult.config;
    
    // Check security blocklist first
    if (config.security?.blockedCommands?.some(blocked => command.includes(blocked))) {
      logger.warn(`Command blocked by security config: ${command}`);
      return {
        isApproved: false,
        source: 'local-config',
        matchType: 'pattern',
        configPath: configResult.loadedFrom[0]
      };
    }

    // Check exact command match in global autoApprove list
    if (config.permissions?.autoApprove?.includes(command)) {
      logger.info(`Command pre-approved (exact match): ${command}`);
      return {
        isApproved: true,
        source: 'local-config',
        matchType: 'exact',
        configPath: configResult.loadedFrom[0]
      };
    }

    // Check tool-specific configuration
    const toolConfig = config.permissions?.tools?.[tool];
    if (toolConfig) {
      // Check if tool is explicitly disabled
      if (toolConfig.enabled === false) {
        logger.info(`Tool disabled by config: ${tool}`);
        return {
          isApproved: false,
          source: 'local-config',
          matchType: 'tool',
          configPath: configResult.loadedFrom[0]
        };
      }

      // Check tool-level auto-approval
      if (toolConfig.autoApprove === true) {
        logger.info(`Tool auto-approved: ${tool}`);
        return {
          isApproved: true,
          source: 'local-config',
          matchType: 'tool',
          configPath: configResult.loadedFrom[0]
        };
      }

      // Check specific commands for this tool
      if (toolConfig.commands?.includes(command)) {
        logger.info(`Command pre-approved for tool ${tool}: ${command}`);
        return {
          isApproved: true,
          source: 'local-config',
          matchType: 'exact',
          configPath: configResult.loadedFrom[0]
        };
      }
    }

    return {
      isApproved: false,
      source: 'none'
    };
  }

  clearCache(): void {
    CONFIG_CACHE.clear();
    logger.debug('Local config cache cleared');
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: CONFIG_CACHE.size,
      keys: Array.from(CONFIG_CACHE.keys())
    };
  }
}

export const localConfigReader = LocalConfigReader.getInstance();