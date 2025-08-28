#!/usr/bin/env node

/**
 * Complete Permission Flow Test - Force tool use, approve permissions, verify execution
 */

const { ClaudeHandler } = require('./dist/claude-handler.js');
const { McpManager } = require('./dist/mcp-manager.js');
const { Logger } = require('./dist/logger.js');
const { permissionServer } = require('./dist/permission-mcp-server.js');

const logger = new Logger('FullPermissionFlowTest');

async function testCompleteFlow() {
  logger.info('🔄 Testing COMPLETE Permission Flow: Request → Approve → Execute');
  
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
  
  // Use VERY explicit tool usage prompts to force Claude to use tools
  const testCases = [
    {
      name: 'Force Bash Tool Usage',
      prompt: 'You must use the Bash tool to execute this command: "ls -la". Do not provide a text response - use the Bash tool to run the command and show me the actual output.',
      expectedTool: 'Bash'
    },
    {
      name: 'Force GitHub Tool Usage', 
      prompt: 'You must use the mcp__github tool to create a GitHub issue. The title should be "Test Issue" and body should be "Testing tool execution". Do not explain how to do it - actually execute the GitHub tool now.',
      expectedTool: 'mcp__github'
    },
    {
      name: 'Force File Read Tool',
      prompt: 'You must use the Read tool to read the package.json file. Do not describe what you would do - actually use the Read tool now to read /Users/anichols/code/claude-code-slack-bot/package.json',
      expectedTool: 'Read'
    }
  ];
  
  for (const testCase of testCases) {
    logger.info(`\n🧪 Testing: ${testCase.name}`);
    logger.info(`📝 Directive prompt: ${testCase.prompt.substring(0, 100)}...`);
    
    let permissionRequested = false;
    let permissionApproved = false;
    let toolExecuted = false;
    let executionSucceeded = false;
    let approvalId = null;
    
    try {
      let messageIndex = 0;
      
      for await (const message of claudeHandler.streamQuery(
        testCase.prompt,
        session,
        new AbortController(),
        process.cwd(),
        testContext // WITH Slack context to trigger permissions
      )) {
        messageIndex++;
        
        logger.info(`📨 ${messageIndex}: ${message.type}${message.subtype ? `/${message.subtype}` : ''}${message.name ? ` [${message.name}]` : ''}`);
        
        // Log EVERYTHING about the message to catch hidden tool use
        if (message.type === 'assistant' || message.type === 'user' || message.type === 'tool_use') {
          logger.info(`  🔍 Full message:`, JSON.stringify(message, null, 2).substring(0, 500));
        }
        
        // Check for permission requests
        if (message.name && message.name.includes('permission')) {
          permissionRequested = true;
          logger.info('🔒 PERMISSION REQUEST DETECTED!');
          logger.info('  Tool requesting permission:', message.input?.tool_name || 'unknown');
          logger.info('  Request details:', JSON.stringify(message.input, null, 2));
          
          // Extract approval ID and auto-approve
          if (message.input) {
            // Generate approval ID based on timestamp
            approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            logger.info('🤖 AUTO-APPROVING permission...');
            
            // Simulate the approval process
            try {
              // The permission server should have stored context for this approval
              permissionServer.resolveApproval(approvalId, true); // Approve it
              permissionApproved = true;
              logger.info('✅ Permission approved!', { approvalId });
            } catch (error) {
              logger.error('❌ Failed to approve permission:', error);
            }
          }
        }
        
        // Check for actual tool execution
        if (message.type === 'tool_use' && message.name === testCase.expectedTool) {
          toolExecuted = true;
          logger.info('⚙️ TOOL EXECUTION DETECTED!');
          logger.info('  Tool name:', message.name);
          logger.info('  Tool input:', JSON.stringify(message.input, null, 2));
        }
        
        // Check for successful results
        if (message.type === 'result') {
          if (message.subtype === 'success') {
            executionSucceeded = true;
            logger.info('✅ TOOL EXECUTION SUCCEEDED!');
            if (message.content) {
              logger.info('  Output preview:', typeof message.content === 'string' 
                ? message.content.substring(0, 200) 
                : JSON.stringify(message.content).substring(0, 200));
            }
          } else if (message.subtype === 'error_during_execution') {
            logger.info('❌ TOOL EXECUTION FAILED!');
            logger.info('  Error details:', JSON.stringify(message, null, 2));
          }
        }
        
        // Stop after reasonable number of messages
        if (messageIndex > 20) {
          logger.info('⏹️ Stopping after 20 messages');
          break;
        }
      }
      
      // Report results for this test case
      const result = {
        test: testCase.name,
        permissionRequested,
        permissionApproved,
        toolExecuted,
        executionSucceeded,
        messageCount: messageIndex
      };
      
      logger.info(`\n📊 Results for ${testCase.name}:`);
      logger.info(`  🔒 Permission requested: ${permissionRequested ? '✅' : '❌'}`);
      logger.info(`  ✅ Permission approved: ${permissionApproved ? '✅' : '❌'}`);
      logger.info(`  ⚙️ Tool executed: ${toolExecuted ? '✅' : '❌'}`);
      logger.info(`  🎯 Execution succeeded: ${executionSucceeded ? '✅' : '❌'}`);
      
      // Determine overall status
      if (permissionRequested && permissionApproved && toolExecuted && executionSucceeded) {
        logger.info(`  🏆 OVERALL: COMPLETE SUCCESS`);
      } else if (permissionRequested) {
        logger.info(`  ⚠️ OVERALL: PERMISSION SYSTEM WORKING, BUT TOOL EXECUTION ISSUES`);
      } else {
        logger.info(`  ❌ OVERALL: TOOLS NOT BEING USED`);
      }
      
    } catch (error) {
      logger.error(`💥 Test ${testCase.name} failed:`, error);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  logger.info('\n🏁 Complete permission flow test finished!');
  logger.info('This shows whether:');
  logger.info('1. Claude is using tools when forced');
  logger.info('2. Permission requests are being generated');
  logger.info('3. Permission approvals work');
  logger.info('4. Tool execution actually succeeds after approval');
}

if (require.main === module) {
  testCompleteFlow().catch(error => {
    console.error('Full flow test failed:', error);
    process.exit(1);
  });
}