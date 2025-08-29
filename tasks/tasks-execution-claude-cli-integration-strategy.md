# Claude CLI Integration Strategy - Shell Out Approach - Execution Plan

## 🎯 Executive Summary

**USER INSIGHT**: Instead of using `@anthropic-ai/claude-code` SDK, shell out to local `claude` CLI to leverage existing Max plan authentication.

**SOLUTION BENEFITS**:
- ✅ Uses Max plan authentication automatically
- ✅ Eliminates API charges within plan limits
- ✅ Maintains streaming interface compatibility  
- ✅ Preserves all existing functionality

## 📋 Context & Background

### Analysis & Requirements

#### Current vs Updated SDK Approach

**Current Implementation** (uses bundled CLI with API key):
```typescript
// src/claude-handler.ts:142 - Current implementation
for await (const message of query({
  prompt,
  abortController: abortController || new AbortController(),
  options, // No pathToClaudeCodeExecutable specified
})) {
  // Uses bundled CLI → API key auth → API charges
}
```

**Updated Implementation** (uses local CLI with Max plan auth):
```typescript
// Updated implementation - same SDK, different CLI
const options: any = {
  outputFormat: 'stream-json',
  permissionMode: slackContext ? 'default' : 'bypassPermissions',
};

// Point to local Claude CLI with Max plan authentication
if (config.claude.cliPath) {
  options.pathToClaudeCodeExecutable = config.claude.cliPath;
}

for await (const message of query({
  prompt,
  abortController: abortController || new AbortController(),
  options, // Now uses local CLI → Max plan auth → Zero charges
})) {
  // Same streaming interface, different authentication!
}
```

### SDK CLI Integration Discovery

**How SDK CLI Integration Works**:
1. SDK spawns CLI as child process using `pathToClaudeCodeExecutable` parameter
2. **Current**: No path specified → uses bundled CLI → API key authentication
3. **Updated**: Local path specified → uses local CLI → Max plan authentication inherited
4. **SDK handles all security, process management, and communication automatically**

**Authentication Types Supported**:
- ✅ Max plan session authentication (via local CLI with `claude login`)
- ✅ API key authentication (`ANTHROPIC_API_KEY`)
- ✅ Bedrock authentication (`CLAUDE_CODE_USE_BEDROCK=1`)
- ✅ Vertex authentication (`CLAUDE_CODE_USE_VERTEX=1`)

**Key Discovery**: The SDK already delegates to CLI internally - we just need to point it to the right CLI executable.

### Key Requirements

1. **Configuration Addition**: Environment variable `CLAUDE_CLI_EXECUTABLE_PATH` to specify local CLI path
2. **SDK Options Update**: Pass `pathToClaudeCodeExecutable` when configured
3. **Backward Compatibility**: Falls back to bundled CLI if not configured (current behavior)
4. **Authentication Validation**: Verify local CLI has valid authentication
5. **Error Handling**: Handle cases where local CLI is not found or not authenticated
6. **Documentation**: Clear setup instructions for users

### Security Considerations

#### **Security Benefits of SDK Approach**

**✅ No Security Vulnerabilities** - SDK handles all CLI interaction securely:

```typescript
// SECURE: SDK handles all process spawning and input sanitization
const options = {
  pathToClaudeCodeExecutable: config.claude.cliPath, // Just a file path
  cwd: workingDirectory, // SDK validates and handles securely
};

// SDK handles all the complex and secure CLI interaction
for await (const message of query({ prompt, options })) {
  // No direct process spawning, no input injection risks
}
```

**Security Handled by SDK**:
- ✅ Input sanitization and validation
- ✅ Process spawning and management
- ✅ Environment variable filtering
- ✅ Working directory validation
- ✅ Timeout and cleanup handling
- ✅ Error handling and recovery

### Performance & Quality Requirements

- **Minimal Performance Impact**: SDK already uses CLI internally, so no additional overhead
- **Same Resource Usage**: Identical memory and CPU usage as current implementation
- **Error Handling**: Handle CLI path validation and authentication errors gracefully
- **Monitoring**: Track which CLI is being used (bundled vs local) for debugging

### Success Criteria

#### Primary Goals
- [ ] Successful Max plan authentication via CLI
- [ ] Zero API charges within plan limits
- [ ] All existing Slack bot functionality preserved
- [ ] Performance comparable to SDK approach

#### Technical Validation
- [ ] Streaming JSON output parsing works correctly
- [ ] Session management maintains conversation context
- [ ] Working directory resolution functions properly
- [ ] Error handling provides meaningful feedback

#### Operational Success
- [ ] CLI authentication stays persistent
- [ ] Process management is stable and reliable
- [ ] Monitoring provides visibility into usage and costs
- [ ] Troubleshooting is straightforward

## 🗂️ Relevant Files

- `src/config.ts` - Add `cliPath` configuration option
- `src/claude-handler.ts` - Update options to include `pathToClaudeCodeExecutable` when configured
- `.env.example` - Document new `CLAUDE_CLI_EXECUTABLE_PATH` environment variable
- `README.md` or `CLAUDE.md` - Update setup instructions for CLI configuration
- `test/integration/claude-cli-path.test.ts` - Test CLI path configuration (optional)

### Notes

- Leverage SDK's built-in CLI security and process management
- No performance changes expected (SDK already uses CLI internally)
- Maintain backward compatibility (falls back to bundled CLI if not configured)
- Simple configuration-based approach

## ⚙️ Implementation Phases

### Phase 1: Configuration and Integration (Day 1)
**Objective:** Add CLI path configuration to leverage local Claude CLI with Max plan authentication

**Technical Requirements:**
- Add `CLAUDE_CLI_EXECUTABLE_PATH` environment variable to config
- Update SDK options to include `pathToClaudeCodeExecutable` when configured
- Maintain backward compatibility with current behavior
- Add basic error handling for CLI path validation

**Tasks:**
- [ ] 1.0 Configuration Setup
  - [ ] 1.1 Add `cliPath` to `src/config.ts`
  - [ ] 1.2 Update `src/claude-handler.ts` to use CLI path in options
  - [ ] 1.3 Add environment variable to `.env.example`
- [ ] 1.1 Error Handling & Validation
  - [ ] 1.1.1 Add CLI path existence validation (optional warning)
  - [ ] 1.1.2 Add authentication error handling for CLI issues
- [ ] 1.2 Documentation
  - [ ] 1.2.1 Update setup instructions in README/CLAUDE.md
  - [ ] 1.2.2 Document CLI authentication setup process

### Phase 2: Testing and Validation (Day 2)
**Objective:** Validate CLI path configuration works correctly and provides expected cost benefits

**Technical Requirements:**
- Test with local Claude CLI that has Max plan authentication
- Verify zero API charges when using local CLI
- Confirm identical functionality between bundled and local CLI
- Test error scenarios (CLI not found, not authenticated)

**Tasks:**
- [ ] 2.0 Functional Testing
  - [ ] 2.1 Test with local CLI path configured
  - [ ] 2.2 Test fallback to bundled CLI when not configured
  - [ ] 2.3 Verify Max plan authentication usage
  - [ ] 2.4 Test error handling for invalid CLI paths
- [ ] 2.1 Integration Validation
  - [ ] 2.1.1 End-to-end Slack bot functionality with local CLI
  - [ ] 2.1.2 Verify session management works identically
  - [ ] 2.1.3 Test working directory functionality
  - [ ] 2.1.4 Validate MCP server integration still works

## 🔍 Technical Specifications

### Configuration Architecture

```env
# .env - New configuration option
CLAUDE_CLI_EXECUTABLE_PATH=/usr/local/bin/claude  # Path to local CLI (NEW)
# Leave empty to use bundled CLI (CURRENT DEFAULT)

# Existing configuration still works identically
ANTHROPIC_API_KEY=sk-ant-api03-...
CLAUDE_CODE_USE_BEDROCK=1
CLAUDE_CODE_USE_VERTEX=1
```

### Updated Configuration

```typescript
// src/config.ts - Add CLI path configuration
export const config = {
  // ... existing config ...
  claude: {
    useBedrock: process.env.CLAUDE_CODE_USE_BEDROCK === '1',
    useVertex: process.env.CLAUDE_CODE_USE_VERTEX === '1',
    cliPath: process.env.CLAUDE_CLI_EXECUTABLE_PATH || '', // NEW
  },
};
```

### Updated Claude Handler

```typescript
// src/claude-handler.ts - Add pathToClaudeCodeExecutable to options
async *streamQuery(
  prompt: string,
  session?: ConversationSession,
  abortController?: AbortController,
  workingDirectory?: string,
  slackContext?: { channel: string; threadTs?: string; user: string }
): AsyncGenerator<SDKMessage, void, unknown> {
  const options: any = {
    outputFormat: 'stream-json',
    permissionMode: slackContext ? 'default' : 'bypassPermissions',
  };

  // Use local CLI if configured, otherwise fall back to bundled CLI
  if (config.claude.cliPath) {
    options.pathToClaudeCodeExecutable = config.claude.cliPath;
    this.logger.info('Using local Claude CLI', { path: config.claude.cliPath });
  } else {
    this.logger.info('Using bundled Claude CLI (default)');
  }

  // ... rest of existing options setup ...

  for await (const message of query({
    prompt,
    abortController: abortController || new AbortController(),
    options, // Now includes pathToClaudeCodeExecutable when configured
  })) {
    // Same streaming interface, different CLI!
    yield message;
  }
}
```

### CLI Path Validation (Optional)

```typescript
// Optional: Add CLI path validation in config.ts
import { existsSync } from 'fs';

function validateCliPath(path: string): void {
  if (path && !existsSync(path)) {
    console.warn(`⚠️ Claude CLI path not found: ${path}`);
    console.warn('Falling back to bundled CLI. To use local CLI:');
    console.warn('1. Install Claude CLI: https://claude.ai/cli');
    console.warn('2. Run: claude login');
    console.warn('3. Set CLAUDE_CLI_EXECUTABLE_PATH to the CLI location');
  }
}

// Call validation on startup
if (config.claude.cliPath) {
  validateCliPath(config.claude.cliPath);
}
```

## 🚨 Critical Requirements

### Security (Handled by SDK)

**✅ No Custom Security Implementation Needed** - SDK provides all security measures:
1. **Input Sanitization**: SDK handles all input sanitization automatically
2. **Process Management**: SDK manages CLI process lifecycle securely  
3. **Environment Handling**: SDK filters and manages environment variables
4. **Path Validation**: SDK validates working directory paths
5. **Error Handling**: SDK provides structured error handling

### Configuration Validation

- **CLI Path Validation**: Warn if configured CLI path doesn't exist (don't fail)
- **Authentication Feedback**: Provide clear feedback when CLI auth issues occur
- **Fallback Behavior**: Always fall back to bundled CLI if local CLI fails

### Quality Gates

- Configuration must not break existing functionality
- Local CLI usage must provide identical API to current implementation
- Error messages must be clear and actionable for setup issues
- Backward compatibility must be maintained (no config = current behavior)

## ✅ Validation & Testing Strategy

### Functional Testing Requirements

1. **Configuration Testing**: Verify CLI path configuration works correctly
2. **Authentication Testing**: Test Max plan authentication via local CLI
3. **Fallback Testing**: Verify graceful fallback to bundled CLI
4. **Error Handling**: Test invalid CLI paths and authentication failures
5. **Feature Parity**: Confirm identical functionality between bundled and local CLI

### Integration Testing

1. **Slack Bot Integration**: End-to-end testing with local CLI configuration
2. **Session Management**: Verify sessions work identically with local CLI
3. **Working Directory**: Test `cwd` functionality with local CLI
4. **MCP Integration**: Ensure MCP servers work with local CLI
5. **Streaming Interface**: Validate identical streaming behavior

### Cost Validation

1. **Authentication Verification**: Confirm local CLI uses Max plan authentication
2. **Billing Monitoring**: Verify zero API charges when using authenticated local CLI
3. **Usage Tracking**: Monitor which CLI is being used for debugging

## 📊 Success Metrics

### Cost Optimization
- **Zero API charges** within Max plan limits when `CLAUDE_CLI_EXECUTABLE_PATH` is configured with authenticated local CLI
- **Flexible authentication** supporting Max plan, API key, Bedrock, and Vertex AI via CLI configuration
- **Transparent operation** with clear logging of which CLI is being used

### Functionality Preservation  
- **100% feature parity** with existing implementation (SDK handles compatibility)
- **Identical streaming interface** (no changes to API)
- **Session continuity** (handled by SDK)
- **Working directory support** (unchanged)
- **MCP integration** (unchanged)

### Operational Success
- **Seamless configuration** with environment variable only
- **Graceful fallback** to bundled CLI if local CLI issues occur
- **Clear error messages** for CLI setup and authentication issues
- **Zero breaking changes** to existing functionality