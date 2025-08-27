#!/usr/bin/env node

/**
 * Focus just on Bash tool to see exactly what's happening
 */

const { ClaudeHandler } = require('./dist/claude-handler.js');
const { McpManager } = require('./dist/mcp-manager.js');
const { Logger } = require('./dist/logger.js');

const logger = new Logger('BashOnlyTest');

async function testBashOnly() {
  logger.info('🔨 Testing ONLY Bash Tool with Maximum Logging');
  
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
  
  // Very explicit Bash command
  const prompt = 'Execute: ls -la';
  
  logger.info('📝 Simple Bash prompt:', prompt);
  
  try {
    let messageIndex = 0;
    
    for await (const message of claudeHandler.streamQuery(
      prompt,
      session,
      new AbortController(),
      process.cwd(),
      testContext
    )) {
      messageIndex++;
      
      // Log EVERYTHING
      logger.info(`\n📨 Message ${messageIndex}:`);
      logger.info('  Type:', message.type);
      logger.info('  Subtype:', message.subtype);
      logger.info('  Name:', message.name);
      logger.info('  Full JSON:', JSON.stringify(message, null, 2));
      
      if (messageIndex > 10) {
        logger.info('⏹️ Stopping after 10 messages');
        break;
      }
    }
    
  } catch (error) {
    logger.error('💥 Bash test failed:', error);
  }
}

if (require.main === module) {
  testBashOnly().catch(error => {
    console.error('Bash test failed:', error);
    process.exit(1);
  });
}