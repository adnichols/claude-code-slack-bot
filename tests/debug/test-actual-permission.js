#!/usr/bin/env node

/**
 * Test to replicate the exact permission flow you showed me
 */

const { ClaudeHandler } = require('./dist/claude-handler.js');
const { McpManager } = require('./dist/mcp-manager.js');
const { Logger } = require('./dist/logger.js');

const logger = new Logger('ActualPermissionTest');

async function testActualPermission() {
  logger.info('🎯 Testing ACTUAL Permission Flow');
  
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
  
  // Test with the exact type of command you mentioned
  const prompt = 'Create a GitHub issue with title "Make threading optional with config for DM conversations" and body "Enhancement Request: Make threading optional with configuration for DM conversations. Currently, the bot uses threading for all responses, which may not be ideal for all use cases, particularly in DM conversations where threading can make the conversation feel less natural."';
  
  logger.info('📝 Testing with the exact GitHub issue creation that triggered permissions...');
  logger.info('🏗️ Prompt:', prompt);
  
  try {
    let messageIndex = 0;
    let foundPermissionRequest = false;
    
    for await (const message of claudeHandler.streamQuery(
      prompt,
      session,
      new AbortController(),
      process.cwd(),
      testContext // WITH Slack context to trigger permissions
    )) {
      messageIndex++;
      
      // Log key message details
      logger.info(`📨 Message ${messageIndex}: ${message.type}${message.subtype ? `/${message.subtype}` : ''}${message.name ? ` [${message.name}]` : ''}`);
      
      // Look for tool use messages
      if (message.type === 'tool_use') {
        foundPermissionRequest = true;
        logger.info('🛠️ TOOL USE FOUND!');
        logger.info('  Tool Name:', message.name);
        logger.info('  Tool Input:', JSON.stringify(message.input, null, 2));
        
        // Check if this matches the pattern from your screenshot
        if (message.input && message.input.command && typeof message.input.command === 'string') {
          if (message.input.command.includes('gh issue create')) {
            logger.info('🎉 FOUND THE EXACT PATTERN FROM YOUR SCREENSHOT!');
            logger.info('  This is a GitHub issue creation command');
            logger.info('  Command:', message.input.command);
          }
        }
      }
      
      // Look for permission-related messages
      if (message.name && message.name.includes('permission')) {
        foundPermissionRequest = true;
        logger.info('🔒 PERMISSION REQUEST FOUND!');
        logger.info('  Tool:', message.name);
        logger.info('  Input:', JSON.stringify(message.input, null, 2));
      }
      
      // Stop after reasonable messages or if we found what we're looking for
      if (messageIndex > 15 || (foundPermissionRequest && messageIndex > 5)) {
        logger.info('⏹️ Stopping - found permission request or reached limit');
        break;
      }
    }
    
    logger.info(`\n📊 Results:`);
    logger.info(`  Messages processed: ${messageIndex}`);
    logger.info(`  Permission request found: ${foundPermissionRequest ? '✅ YES' : '❌ NO'}`);
    
    if (!foundPermissionRequest) {
      logger.info('\n🤔 No permission request found. This means:');
      logger.info('  1. Claude is not trying to use tools for GitHub operations');
      logger.info('  2. The permission system is not being triggered');
      logger.info('  3. Claude might be responding with text instead of tool use');
    }
    
  } catch (error) {
    logger.error('💥 Test failed:', error);
  }
}

if (require.main === module) {
  testActualPermission().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}