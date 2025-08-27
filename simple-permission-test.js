#!/usr/bin/env node

/**
 * Simple Permission Test - Directly test Claude Code integration
 * This mimics exactly what happens when Slack sends a message
 */

const { ClaudeHandler } = require('./dist/claude-handler.js');
const { McpManager } = require('./dist/mcp-manager.js');
const { Logger } = require('./dist/logger.js');

const logger = new Logger('SimplePermissionTest');

async function testPermissionFlow() {
  logger.info('🧪 Starting Simple Permission Test');
  
  // Initialize the same way the main app does
  const mcpManager = new McpManager();
  const claudeHandler = new ClaudeHandler(mcpManager);
  
  // Create test context (simulating Slack message)
  const testContext = {
    channel: 'C1234567890',
    threadTs: Date.now().toString(), 
    user: 'U1234567890'
  };
  
  // Create session
  const session = claudeHandler.createSession(
    testContext.user,
    testContext.channel, 
    testContext.threadTs
  );
  
  logger.info('📋 Test Context:', testContext);
  logger.info('💾 Session created:', { sessionKey: claudeHandler.getSessionKey(testContext.user, testContext.channel, testContext.threadTs) });
  
  // Test prompts that should trigger different tools
  const testCases = [
    {
      name: 'GitHub Issue Creation',
      prompt: 'Create a GitHub issue titled "Test Permission System" with body "Testing if permissions work correctly"',
      expectedTool: 'github'
    },
    {
      name: 'File System Read',
      prompt: 'Read the package.json file in this directory and tell me about the dependencies',
      expectedTool: 'filesystem'
    },
    {
      name: 'Bash Command',
      prompt: 'Run "ls -la" to show the files in this directory',
      expectedTool: 'bash'
    }
  ];
  
  for (const testCase of testCases) {
    logger.info(`\n🔬 Running test: ${testCase.name}`);
    logger.info(`📝 Prompt: ${testCase.prompt}`);
    
    try {
      let messageCount = 0;
      let permissionSeen = false;
      let toolExecuted = false;
      let lastError = null;
      
      // Stream the response and monitor for permissions
      for await (const message of claudeHandler.streamQuery(
        testCase.prompt,
        session,
        new AbortController(),
        process.cwd(),
        testContext
      )) {
        messageCount++;
        
        logger.debug(`📨 Message ${messageCount}:`, {
          type: message.type,
          subtype: message.subtype,
          name: message.name,
          contentPreview: typeof message.content === 'string' ? message.content.substring(0, 100) : 'N/A'
        });
        
        // Check for permission requests
        if (message.name && message.name.includes('permission')) {
          permissionSeen = true;
          logger.info('🔒 PERMISSION REQUEST DETECTED!', {
            toolName: message.name,
            input: message.input,
            formattedCorrectly: message.input && typeof message.input === 'object'
          });
          
          // Log the exact permission request details
          if (message.input) {
            logger.info('📋 Permission Details:', JSON.stringify(message.input, null, 2));
          }
        }
        
        // Check for tool execution
        if (message.name && message.name.includes(testCase.expectedTool)) {
          toolExecuted = true;
          logger.info('⚙️ TOOL EXECUTION DETECTED!', {
            toolName: message.name,
            input: message.input
          });
        }
        
        // Check for errors
        if (message.type === 'error') {
          lastError = message.content;
          logger.error('❌ Error in message stream:', message.content);
        }
        
        // Limit message processing to avoid infinite loops
        if (messageCount > 50) {
          logger.warn('⚠️ Stopping after 50 messages to prevent infinite loop');
          break;
        }
      }
      
      // Results for this test case
      const result = {
        test: testCase.name,
        messageCount,
        permissionSeen,
        toolExecuted,
        lastError,
        status: permissionSeen ? '✅ PASS' : '❌ FAIL'
      };
      
      logger.info(`📊 Test Results for ${testCase.name}:`, result);
      
    } catch (error) {
      logger.error(`💥 Test ${testCase.name} failed with exception:`, error);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  logger.info('\n🏁 Permission test completed!');
  logger.info('Check the logs above to see if permission requests were detected and formatted correctly.');
}

// Add error handling for the test
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the test
if (require.main === module) {
  testPermissionFlow().catch(error => {
    logger.error('Test failed:', error);
    process.exit(1);
  });
}