## Relevant Files

- `src/local-config-reader.ts` - New module to read and validate `.claude/settings.json` and `.claude/settings.local.json` files
- `test-local-config.js` - Unit tests for local config reader functionality
- `src/permission-mcp-server.ts` - Enhanced to check local config before prompting (lines 323-346)
- `src/claude-handler.ts` - Modified to pass working directory in SLACK_CONTEXT (lines 63-79)
- `src/types.ts` - Added interfaces for LocalPermissionConfig and related types
- `test-local-config.js` - Integration test script for local config functionality
- `.claude/settings.json` - Example team configuration file (for testing)
- `.claude/settings.local.json.example` - Example personal override file (for testing)

### Notes

- Use existing test scripts pattern (`test-*.js` files) as no formal test framework is configured
- Follow existing patterns: async operations, comprehensive logging, fail-secure design
- Integration points: `checkExistingApproval()` method and SLACK_CONTEXT mechanism

## Tasks

- [x] 1.0 Create Local Configuration Reader Module
  - [x] 1.1 Add LocalPermissionConfig interface to `src/types.ts`
  - [x] 1.2 Create `src/local-config-reader.ts` with async file loading and caching
  - [x] 1.3 Implement `loadLocalPermissions()` function with directory traversal
  - [x] 1.4 Add comprehensive config validation with security checks
  - [x] 1.5 Implement `isPreApproved()` function with exact command matching
  - [x] 1.6 Add performance optimizations: caching, deduplication, timeouts
- [x] 2.0 Integrate Local Config with Permission System
  - [x] 2.1 Add import for local config reader in `permission-mcp-server.ts`
  - [x] 2.2 Extract working directory from SLACK_CONTEXT in `handlePermissionPrompt()`
  - [x] 2.3 Add local config check before existing approval check (lines 323-324)
  - [x] 2.4 Implement auto-approval response with proper logging and risk integration
  - [x] 2.5 Ensure graceful fallback to existing permission flow on any errors
  - [x] 2.6 Verify PermissionFormatter.formatPermission() integration and risk level handling
- [x] 3.0 Enhance Working Directory Context Passing
  - [x] 3.1 Modify `claude-handler.ts` to include `workingDirectory` in SLACK_CONTEXT
  - [x] 3.2 Update permission server environment configuration (lines 68-72)
  - [x] 3.3 Add request ID for tracing and debugging purposes
  - [x] 3.4 Verify context flows correctly through MCP server startup
  - [x] 3.5 Test working directory context flows correctly in development environment
- [x] 4.0 Implement Comprehensive Testing and Validation
  - [x] 4.1 Create unit test script `test-local-config.js` for config loading
  - [x] 4.2 Create security test for malformed configs and path traversal attempts
  - [x] 4.3 Create integration test with mock `.claude/settings.json` files
  - [x] 4.4 Test permission flow with pre-approved vs non-approved commands
  - [x] 4.5 Test error handling and fallback behavior
  - [x] 4.6 Test basic caching behavior
- [x] 5.0 Create Configuration Examples and Documentation
  - [x] 5.1 Create example `.claude/settings.json` for team configuration
  - [x] 5.2 Create example `.claude/settings.local.json` for personal overrides
  - [x] 5.3 Update CLAUDE.md with new local config functionality