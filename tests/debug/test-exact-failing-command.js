#!/usr/bin/env node

/**
 * Test the exact type of command that was failing for the user
 */

const { ClaudeHandler } = require('./dist/claude-handler.js');
const { McpManager } = require('./dist/mcp-manager.js');
const { Logger } = require('./dist/logger.js');

const logger = new Logger('ExactFailingCommandTest');

async function testExactFailingCommand() {
  logger.info('🎯 Testing EXACT Failing Command Pattern');
  
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
  
  // The exact command pattern you showed that was failing
  const prompt = 'Run this command: cd /Users/anichols/code && rsync -a anichols-start/ week-in-review/';
  
  logger.info('📝 Testing exact failing command pattern:', prompt);
  
  try {
    let messageIndex = 0;
    let permissionRequested = false;
    let toolExecuted = false;
    let executionResult = null;
    
    for await (const message of claudeHandler.streamQuery(
      prompt,
      session,
      new AbortController(),
      process.cwd(),
      testContext
    )) {
      messageIndex++;
      
      logger.info(`\n📨 Message ${messageIndex}: ${message.type}${message.subtype ? `/${message.subtype}` : ''}`);
      
      // Check for tool use in assistant messages
      if (message.type === 'assistant' && message.message && message.message.content) {
        for (const content of message.message.content) {
          if (content.type === 'tool_use' && content.name === 'Bash') {
            toolExecuted = true;
            logger.info('🛠️ BASH TOOL EXECUTION DETECTED!');
            logger.info('  Command:', content.input.command);
            logger.info('  Description:', content.input.description);
            
            // Check if this is a permission-requiring command
            if (content.input.command.includes('rsync') || content.input.command.includes('cd')) {
              logger.info('  🚨 This is a potentially dangerous command that should trigger permissions!');
            }
          }
        }
      }
      
      // Check for permission requests (should be mcp__permission-prompt calls)
      if (message.type === 'assistant' && message.message && message.message.content) {
        for (const content of message.message.content) {
          if (content.type === 'tool_use' && content.name && content.name.includes('permission')) {
            permissionRequested = true;
            logger.info('🔒 PERMISSION REQUEST DETECTED!');
            logger.info('  Permission tool:', content.name);
            logger.info('  Request details:', JSON.stringify(content.input, null, 2));
          }
        }
      }
      
      // Check tool results
      if (message.type === 'user' && message.message && message.message.content) {
        for (const content of message.message.content) {
          if (content.type === 'tool_result') {
            logger.info('📋 TOOL RESULT:');
            logger.info('  Error:', content.is_error);
            logger.info('  Content preview:', typeof content.content === 'string' 
              ? content.content.substring(0, 200) + (content.content.length > 200 ? '...' : '')
              : JSON.stringify(content.content).substring(0, 200));
            
            if (content.is_error) {
              logger.info('  🚨 TOOL EXECUTION FAILED!');
              executionResult = 'failed';
            } else {
              logger.info('  ✅ Tool execution succeeded');
              executionResult = 'succeeded';
            }
          }
        }
      }
      
      if (messageIndex > 10) {
        logger.info('⏹️ Stopping after 10 messages');
        break;
      }
    }
    
    logger.info(`\n📊 FINAL RESULTS:`);
    logger.info(`  🔒 Permission requested: ${permissionRequested ? '✅' : '❌'}`);
    logger.info(`  ⚙️ Bash tool executed: ${toolExecuted ? '✅' : '❌'}`);
    logger.info(`  🎯 Execution result: ${executionResult || 'unknown'}`);
    
    if (!permissionRequested && toolExecuted) {
      logger.info(`\n🚨 PROBLEM IDENTIFIED:`);
      logger.info(`  - Bash tool was executed without permission request`);
      logger.info(`  - This means potentially dangerous commands can run without approval`);
      logger.info(`  - The permission system is NOT working for Bash tools`);
    }
    
    if (toolExecuted && executionResult === 'failed') {
      logger.info(`\n💥 EXECUTION FAILURE:`);
      logger.info(`  - Tool was executed but failed`);
      logger.info(`  - This explains why your rsync command wasn't working`);
    }
    
  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

if (require.main === module) {
  testExactFailingCommand().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}