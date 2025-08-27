#!/usr/bin/env node

/**
 * Test script for local configuration reader and integration
 * This tests the Claude settings integration functionality
 */

const { LocalConfigReader } = require('./dist/local-config-reader.js');
const { ClaudeHandler } = require('./dist/claude-handler.js');
const { McpManager } = require('./dist/mcp-manager.js');
const { permissionServer } = require('./dist/permission-mcp-server.js');
const { Logger } = require('./dist/logger.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const logger = new Logger('LocalConfigTest');

class LocalConfigTest {
  constructor() {
    this.mcpManager = new McpManager();
    this.claudeHandler = new ClaudeHandler(this.mcpManager);
    this.testResults = [];
    this.testDir = path.join(os.tmpdir(), `claude-config-test-${Date.now()}`);
    this.localConfigReader = LocalConfigReader.getInstance();
  }

  async runTest() {
    logger.info('🧪 Starting Local Configuration Test Suite');
    
    try {
      // Setup test environment
      await this.setupTestEnvironment();
      
      // Test 1: Basic config loading
      await this.testBasicConfigLoading();
      
      // Test 2: Config validation and security checks
      await this.testConfigValidation();
      
      // Test 3: Directory traversal functionality
      await this.testDirectoryTraversal();
      
      // Test 4: Config merging (team + personal)
      await this.testConfigMerging();
      
      // Test 5: Permission pre-approval functionality
      await this.testPermissionPreApproval();
      
      // Test 6: Cache functionality
      await this.testCacheFunctionality();
      
      // Test 7: Integration with permission system
      await this.testPermissionSystemIntegration();
      
      // Test 8: Error handling and fallback behavior
      await this.testErrorHandling();
      
      // Cleanup and summary
      await this.cleanup();
      this.printTestResults();
      
    } catch (error) {
      logger.error('Test suite failed with error:', error);
      await this.cleanup();
      process.exit(1);
    }
  }

  async setupTestEnvironment() {
    logger.info('🏗️  Setting up test environment');
    
    try {
      // Create test directory structure
      await fs.promises.mkdir(this.testDir, { recursive: true });
      await fs.promises.mkdir(path.join(this.testDir, '.claude'), { recursive: true });
      await fs.promises.mkdir(path.join(this.testDir, 'subproject'), { recursive: true });
      await fs.promises.mkdir(path.join(this.testDir, 'subproject', '.claude'), { recursive: true });
      
      logger.info('✅ Test directory structure created', { testDir: this.testDir });
      
    } catch (error) {
      logger.error('Failed to setup test environment:', error);
      throw error;
    }
  }

  async testBasicConfigLoading() {
    logger.info('📋 Test 1: Basic Configuration Loading');
    
    try {
      // Create a basic config file
      const basicConfig = {
        permissions: {
          autoApprove: ['git status', 'npm install'],
          tools: {
            bash: {
              enabled: true,
              autoApprove: false
            }
          }
        },
        security: {
          maxConfigFileSize: 102400,
          blockedCommands: ['rm -rf']
        }
      };

      const configPath = path.join(this.testDir, '.claude', 'settings.json');
      await fs.promises.writeFile(configPath, JSON.stringify(basicConfig, null, 2));
      
      // Test loading the config
      const result = await this.localConfigReader.loadLocalPermissions(this.testDir);
      
      const success = result && 
                     result.config && 
                     result.config.permissions &&
                     result.source === 'team' &&
                     result.loadedFrom.includes(configPath);

      this.testResults.push({
        test: 'Basic Configuration Loading',
        success,
        details: {
          configLoaded: !!result,
          correctSource: result?.source === 'team',
          hasPermissions: !!result?.config?.permissions,
          loadedFrom: result?.loadedFrom || []
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Basic config loading successful');
      } else {
        logger.error('❌ Basic config loading failed', result);
      }
      
    } catch (error) {
      logger.error('Basic config test failed:', error);
      this.testResults.push({
        test: 'Basic Configuration Loading',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async testConfigValidation() {
    logger.info('🔒 Test 2: Configuration Validation and Security');
    
    try {
      // Test malformed config
      const malformedConfig = {
        permissions: {
          autoApprove: 'invalid_not_array',
          tools: {
            bash: 'invalid_not_object'
          }
        },
        invalidField: 'should be filtered out'
      };

      const configPath = path.join(this.testDir, '.claude', 'settings.json');
      await fs.promises.writeFile(configPath, JSON.stringify(malformedConfig, null, 2));
      
      const result = await this.localConfigReader.loadLocalPermissions(this.testDir);
      
      const success = result && 
                     result.config &&
                     (!result.config.permissions?.autoApprove || result.config.permissions.autoApprove.length === 0) &&
                     (!result.config.invalidField);

      this.testResults.push({
        test: 'Configuration Validation',
        success,
        details: {
          configLoaded: !!result,
          invalidFieldFiltered: !result?.config?.invalidField,
          autoApproveValidated: !result?.config?.permissions?.autoApprove || Array.isArray(result.config.permissions.autoApprove)
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Config validation working correctly');
      } else {
        logger.error('❌ Config validation failed', result?.config);
      }
      
    } catch (error) {
      logger.error('Config validation test failed:', error);
      this.testResults.push({
        test: 'Configuration Validation',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async testDirectoryTraversal() {
    logger.info('🗂️  Test 3: Directory Traversal');
    
    try {
      // Create config in parent directory
      const parentConfig = {
        permissions: {
          autoApprove: ['git status']
        }
      };

      const parentConfigPath = path.join(this.testDir, '.claude', 'settings.json');
      await fs.promises.writeFile(parentConfigPath, JSON.stringify(parentConfig, null, 2));
      
      // Test loading from subdirectory (should find parent config)
      const subprojectDir = path.join(this.testDir, 'subproject');
      const result = await this.localConfigReader.loadLocalPermissions(subprojectDir);
      
      const success = result && 
                     result.config &&
                     result.config.permissions?.autoApprove?.includes('git status') &&
                     result.loadedFrom.includes(parentConfigPath);

      this.testResults.push({
        test: 'Directory Traversal',
        success,
        details: {
          configFound: !!result,
          correctConfig: !!result?.config?.permissions?.autoApprove?.includes('git status'),
          correctPath: result?.loadedFrom?.includes(parentConfigPath)
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Directory traversal working correctly');
      } else {
        logger.error('❌ Directory traversal failed', result);
      }
      
    } catch (error) {
      logger.error('Directory traversal test failed:', error);
      this.testResults.push({
        test: 'Directory Traversal',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async testConfigMerging() {
    logger.info('🔀 Test 4: Configuration Merging (Team + Personal)');
    
    try {
      // Create team config
      const teamConfig = {
        permissions: {
          autoApprove: ['git status', 'npm install'],
          tools: {
            bash: { enabled: true, autoApprove: false }
          }
        }
      };

      // Create personal config (overrides)
      const personalConfig = {
        permissions: {
          autoApprove: ['git commit', 'git push'],
          tools: {
            bash: { autoApprove: true },
            git: { enabled: true }
          }
        }
      };

      await fs.promises.writeFile(
        path.join(this.testDir, '.claude', 'settings.json'), 
        JSON.stringify(teamConfig, null, 2)
      );
      
      await fs.promises.writeFile(
        path.join(this.testDir, '.claude', 'settings.local.json'), 
        JSON.stringify(personalConfig, null, 2)
      );
      
      const result = await this.localConfigReader.loadLocalPermissions(this.testDir);
      
      const success = result && 
                     result.source === 'merged' &&
                     result.config.permissions?.autoApprove?.includes('git status') &&
                     result.config.permissions?.autoApprove?.includes('git commit') &&
                     result.config.permissions?.tools?.bash?.autoApprove === true &&
                     result.config.permissions?.tools?.git?.enabled === true;

      this.testResults.push({
        test: 'Configuration Merging',
        success,
        details: {
          correctSource: result?.source === 'merged',
          teamConfigMerged: !!result?.config?.permissions?.autoApprove?.includes('git status'),
          personalConfigMerged: !!result?.config?.permissions?.autoApprove?.includes('git commit'),
          toolSettingsOverridden: result?.config?.permissions?.tools?.bash?.autoApprove === true
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Config merging working correctly');
      } else {
        logger.error('❌ Config merging failed', result);
      }
      
    } catch (error) {
      logger.error('Config merging test failed:', error);
      this.testResults.push({
        test: 'Configuration Merging',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async testPermissionPreApproval() {
    logger.info('✅ Test 5: Permission Pre-approval');
    
    try {
      // Create config with pre-approved commands
      const config = {
        permissions: {
          autoApprove: ['git status', 'npm install'],
          tools: {
            bash: { 
              enabled: true,
              autoApprove: true
            },
            git: {
              enabled: true,
              commands: ['git log', 'git diff']
            }
          }
        },
        security: {
          blockedCommands: ['rm -rf']
        }
      };

      await fs.promises.writeFile(
        path.join(this.testDir, '.claude', 'settings.json'), 
        JSON.stringify(config, null, 2)
      );
      
      // Test exact command match
      const exactMatch = await this.localConfigReader.isPreApproved('git status', 'git', this.testDir);
      
      // Test tool-level approval
      const toolMatch = await this.localConfigReader.isPreApproved('any command', 'bash', this.testDir);
      
      // Test tool-specific command
      const toolCommandMatch = await this.localConfigReader.isPreApproved('git log', 'git', this.testDir);
      
      // Test blocked command
      const blockedCommand = await this.localConfigReader.isPreApproved('rm -rf /', 'bash', this.testDir);
      
      // Test non-matching command
      const noMatch = await this.localConfigReader.isPreApproved('dangerous command', 'unknown', this.testDir);

      const success = exactMatch.isApproved && 
                     exactMatch.matchType === 'exact' &&
                     toolMatch.isApproved && 
                     toolMatch.matchType === 'tool' &&
                     toolCommandMatch.isApproved &&
                     !blockedCommand.isApproved &&
                     !noMatch.isApproved;

      this.testResults.push({
        test: 'Permission Pre-approval',
        success,
        details: {
          exactMatch: exactMatch.isApproved,
          toolMatch: toolMatch.isApproved,
          toolCommandMatch: toolCommandMatch.isApproved,
          blockedCommandBlocked: !blockedCommand.isApproved,
          noMatchBlocked: !noMatch.isApproved
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Permission pre-approval working correctly');
      } else {
        logger.error('❌ Permission pre-approval failed');
      }
      
    } catch (error) {
      logger.error('Permission pre-approval test failed:', error);
      this.testResults.push({
        test: 'Permission Pre-approval',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async testCacheFunctionality() {
    logger.info('⚡ Test 6: Cache Functionality');
    
    try {
      const config = {
        permissions: {
          autoApprove: ['git status']
        }
      };

      await fs.promises.writeFile(
        path.join(this.testDir, '.claude', 'settings.json'), 
        JSON.stringify(config, null, 2)
      );
      
      // Clear cache first
      this.localConfigReader.clearCache();
      
      // First load (should cache)
      const startTime1 = Date.now();
      const result1 = await this.localConfigReader.loadLocalPermissions(this.testDir);
      const loadTime1 = Date.now() - startTime1;
      
      // Second load (should use cache)
      const startTime2 = Date.now();
      const result2 = await this.localConfigReader.loadLocalPermissions(this.testDir);
      const loadTime2 = Date.now() - startTime2;
      
      // Check cache stats
      const stats = this.localConfigReader.getCacheStats();
      
      const success = result1 && result2 &&
                     loadTime2 < loadTime1 &&
                     stats.size > 0 &&
                     stats.keys.includes(path.resolve(this.testDir));

      this.testResults.push({
        test: 'Cache Functionality',
        success,
        details: {
          bothLoadsSuccessful: !!(result1 && result2),
          cacheImprovedPerformance: loadTime2 < loadTime1,
          cacheSize: stats.size,
          loadTime1: loadTime1,
          loadTime2: loadTime2
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Cache functionality working correctly');
      } else {
        logger.error('❌ Cache functionality failed');
      }
      
    } catch (error) {
      logger.error('Cache functionality test failed:', error);
      this.testResults.push({
        test: 'Cache Functionality',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async testPermissionSystemIntegration() {
    logger.info('🔗 Test 7: Permission System Integration');
    
    try {
      // Create config with auto-approved command
      const config = {
        permissions: {
          autoApprove: ['git status']
        }
      };

      await fs.promises.writeFile(
        path.join(this.testDir, '.claude', 'settings.json'), 
        JSON.stringify(config, null, 2)
      );
      
      // Set up test context with working directory
      const testContext = {
        channel: 'C1234567890',
        threadTs: Date.now().toString(),
        user: 'U1234567890',
        workingDirectory: this.testDir,
        requestId: `test_${Date.now()}`
      };

      // Set environment for permission server
      process.env.SLACK_CONTEXT = JSON.stringify(testContext);
      
      // Create a mock permission request that should be auto-approved
      const testInput = {
        tool_name: 'git',
        input: 'git status'
      };

      let permissionResult = null;
      try {
        // This would normally go through the MCP interface, but we'll test the integration point
        permissionResult = await this.localConfigReader.isPreApproved('git status', 'git', this.testDir);
      } catch (error) {
        logger.debug('Expected behavior - testing integration point');
      }
      
      const success = permissionResult && permissionResult.isApproved && permissionResult.source === 'local-config';

      this.testResults.push({
        test: 'Permission System Integration',
        success,
        details: {
          contextSet: !!process.env.SLACK_CONTEXT,
          permissionChecked: !!permissionResult,
          autoApproved: !!permissionResult?.isApproved,
          correctSource: permissionResult?.source === 'local-config'
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Permission system integration working correctly');
      } else {
        logger.error('❌ Permission system integration failed');
      }
      
    } catch (error) {
      logger.error('Permission system integration test failed:', error);
      this.testResults.push({
        test: 'Permission System Integration',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async testErrorHandling() {
    logger.info('⚠️  Test 8: Error Handling and Fallback');
    
    try {
      // Test with non-existent directory
      const noConfigResult = await this.localConfigReader.loadLocalPermissions('/nonexistent/directory');
      
      // Test with malformed JSON
      const malformedPath = path.join(this.testDir, '.claude', 'settings.json');
      await fs.promises.writeFile(malformedPath, 'invalid json content');
      
      const malformedResult = await this.localConfigReader.loadLocalPermissions(this.testDir);
      
      // Test with oversized file
      const oversizedConfig = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const oversizedPath = path.join(this.testDir, '.claude', 'settings.json');
      await fs.promises.writeFile(oversizedPath, oversizedConfig);
      
      const oversizedResult = await this.localConfigReader.loadLocalPermissions(this.testDir);
      
      const success = noConfigResult === null &&
                     malformedResult === null &&
                     oversizedResult === null;

      this.testResults.push({
        test: 'Error Handling and Fallback',
        success,
        details: {
          noConfigHandled: noConfigResult === null,
          malformedJsonHandled: malformedResult === null,
          oversizedFileHandled: oversizedResult === null
        },
        status: success ? 'PASS' : 'FAIL'
      });

      if (success) {
        logger.info('✅ Error handling working correctly');
      } else {
        logger.error('❌ Error handling failed');
      }
      
    } catch (error) {
      logger.error('Error handling test failed:', error);
      this.testResults.push({
        test: 'Error Handling and Fallback',
        success: false,
        error: error.message,
        status: 'ERROR'
      });
    }
  }

  async cleanup() {
    logger.info('🧹 Cleaning up test environment');
    
    try {
      // Clear cache
      this.localConfigReader.clearCache();
      
      // Remove test directory
      await fs.promises.rm(this.testDir, { recursive: true, force: true });
      
      // Clean up environment
      delete process.env.SLACK_CONTEXT;
      
      logger.info('✅ Cleanup completed');
      
    } catch (error) {
      logger.warn('Cleanup failed (non-critical):', error);
    }
  }

  printTestResults() {
    logger.info('\n📊 LOCAL CONFIG TEST RESULTS');
    logger.info('=' .repeat(50));
    
    this.testResults.forEach((result, index) => {
      const status = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
      logger.info(`${status} Test ${index + 1}: ${result.test}`);
      
      if (result.details) {
        Object.entries(result.details).forEach(([key, value]) => {
          const icon = typeof value === 'boolean' ? (value ? '✅' : '❌') : '📝';
          logger.info(`   ${key}: ${icon} ${value}`);
        });
      }
      
      if (result.error) {
        logger.info(`   Error: ${result.error}`);
      }
      logger.info('');
    });

    const passCount = this.testResults.filter(r => r.status === 'PASS').length;
    const totalCount = this.testResults.length;
    
    logger.info(`📈 Overall Results: ${passCount}/${totalCount} tests passed`);
    
    if (passCount === totalCount) {
      logger.info('🎉 All local config tests passed! System is working correctly.');
    } else {
      logger.info('🔍 Some tests failed. Check the logs above for details.');
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const test = new LocalConfigTest();
  test.runTest().catch(error => {
    console.error('Local config test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { LocalConfigTest };