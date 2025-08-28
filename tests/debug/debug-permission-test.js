#!/usr/bin/env node

/**
 * Debug Permission Test - Focus on one case with maximum logging
 */

const { ClaudeHandler } = require('./dist/claude-handler.js');
const { McpManager } = require('./dist/mcp-manager.js');
const { Logger } = require('./dist/logger.js');

// Force debug mode
process.env.DEBUG = 'true';

const logger = new Logger('DebugPermissionTest');

async function debugSingleTest() {
  logger.info('🔍 Starting Debug Permission Test');
  
  const mcpManager = new McpManager();
  const claudeHandler = new ClaudeHandler(mcpManager);
  
  const testContext = {
    channel: 'C1234567890',
    threadTs: Date.now().toString(),
    user: 'U1234567890'
  };
  
  const session = claudeHandler.createSession(
    testContext.user,
    testContext.channel,
    testContext.threadTs
  );
  
  // Test with simpler Bash commands that should definitely trigger tool use
  const prompt = 'Please execute the command "ls -la" to show me the files in the current directory';
  
  logger.info('🎯 Testing with Bash command execution...');
  logger.info('📝 Prompt:', prompt);
  logger.info('🏗️ Context:', testContext);
  
  try {
    let messageIndex = 0;
    
    // Try without Slack context first to see if tools work at all
    logger.info('🔧 First, testing without Slack context (bypass permissions)...');
    
    for await (const message of claudeHandler.streamQuery(
      prompt,
      session,
      new AbortController(),
      process.cwd(),
      null // No Slack context = bypass permissions
    )) {
      messageIndex++;
      
      // Log every single message in detail
      logger.info(`\n📨 Message ${messageIndex}:`);
      logger.info('  Type:', message.type);
      logger.info('  Subtype:', message.subtype);
      logger.info('  Name:', message.name);
      
      if (message.input) {
        logger.info('  Input:', JSON.stringify(message.input, null, 2));
      }
      
      if (message.content) {
        const contentPreview = typeof message.content === 'string' 
          ? message.content.substring(0, 200) + (message.content.length > 200 ? '...' : '')
          : JSON.stringify(message.content, null, 2).substring(0, 200);
        logger.info('  Content:', contentPreview);
        
        // If this is an assistant message, it might contain information about available tools
        if (message.type === 'assistant' && typeof message.content === 'string' && message.content.includes('tool')) {
          logger.info('  🔧 Possible tool-related content detected!');
        }
        
        // Log full content for error messages
        if (message.type === 'result' && message.subtype === 'error_during_execution') {
          logger.info('  🚨 EXECUTION ERROR - Full content:', JSON.stringify(message, null, 2));
        }
      }
      
      // Check specifically for permission-related messages
      if (message.name) {
        logger.info('  🔍 Tool name analysis:');
        logger.info('    - Contains "permission":', message.name.includes('permission'));
        logger.info('    - Contains "github":', message.name.includes('github'));
        logger.info('    - Contains "mcp":', message.name.includes('mcp'));
        logger.info('    - Full name:', message.name);
      }
      
      // If we see a tool use, log it prominently
      if (message.type === 'tool_use') {
        logger.info('🛠️  TOOL USE DETECTED!');
        logger.info('   Tool Name:', message.name);
        logger.info('   Tool Input:', JSON.stringify(message.input, null, 2));
        
        // Check if this is exactly what we're looking for
        if (message.name === 'mcp__permission-prompt__permission_prompt') {
          logger.info('🎉 FOUND OUR PERMISSION TOOL!');
        }
      }
      
      // Stop after reasonable number of messages
      if (messageIndex > 20) {
        logger.info('⏹️  Stopping after 20 messages to prevent timeout');
        break;
      }
    }
    
    logger.info(`\n✅ Processed ${messageIndex} messages total`);
    
  } catch (error) {
    logger.error('💥 Test failed with error:', error);
    logger.error('Stack trace:', error.stack);
  }
}

if (require.main === module) {
  debugSingleTest().catch(error => {
    console.error('Debug test failed:', error);
    process.exit(1);
  });
}